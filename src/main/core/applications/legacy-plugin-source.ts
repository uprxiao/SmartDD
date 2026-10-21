import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {join,relative} from 'node:path';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {canonicalJson,digest} from './manifest';
import {ownedBundle,writeOwnedBundle,OWNED_BUNDLE_MARKER} from './owned-bundle';
import {legacyManifestSchema,LegacyTaskEvidenceReader,type LegacyTaskEvidence} from './legacy-task-evidence';
import type {ResourceRecord,ResourceStore} from './resource-store';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),path=z.string().min(1).max(4096).refine(p=>p.startsWith('/')&&!/[\x00\r\n]/.test(p));
const metadataSchema=z.object({kind:z.literal('m4-legacy-plugin-source-v1'),taskId:id,projectId:id,sourceSnapshotHash:hash,manifestHash:hash,runRoot:path,pluginRoot:path,pluginName:z.literal('smartdd'),skills:z.array(z.object({skillId:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),hash}).strict()).min(1).max(64)}).strict();
export type LegacyPluginOrigin=z.infer<typeof metadataSchema>;
export const legacyPluginResourceId=(taskId:string,manifestHash:string)=>`legacy-plugin-source:${id.parse(taskId)}:${hash.parse(manifestHash)}`;
export function legacyPluginOrigin(evidence:LegacyTaskEvidence):LegacyPluginOrigin{
 if(evidence.runner!=='claude-code'||!evidence.pluginRoot||evidence.pluginName!=='smartdd')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原任务没有已证明的Claude插件来源');
 return metadataSchema.parse({kind:'m4-legacy-plugin-source-v1',taskId:evidence.taskId,projectId:evidence.projectId,sourceSnapshotHash:evidence.snapshotHash,manifestHash:evidence.manifestHash,runRoot:evidence.runRoot,pluginRoot:evidence.pluginRoot,pluginName:evidence.pluginName,skills:evidence.skills.filter(s=>s.enabled).map(s=>({skillId:s.skillId,hash:s.hash}))});
}
const fail=(message:string):never=>{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED',message);};
/** Bounded, no-follow reads of a private archive or original static tree. Never writes T/H. */
function readArchive(root:string):Record<string,Buffer>{
 if(realpathSync(root)!==root)return fail('原插件来源目录含未登记别名');const files:Record<string,Buffer>=Object.create(null);let count=0,total=0,visited=0;
 const walk=(dir:string,depth:number)=>{const stat=lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||depth>32||++visited>4096)fail('原插件来源目录不完整');const names=readdirSync(dir);if(!names.length)fail('原插件来源含未声明的空目录');for(const name of names){const p=join(dir,name),st=lstatSync(p);if(st.isSymbolicLink()||!st.isFile()&&!st.isDirectory())fail('原插件来源含链接或特殊文件');if(st.isDirectory()){walk(p,depth+1);continue;}if(++count>4098||st.nlink!==1||(st.mode&0o111)!==0||st.size>4*1024*1024||(total+=st.size)>32*1024*1024)fail('原插件来源超过读取预算或归属不符');const fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=fstatSync(fd);if(before.dev!==st.dev||before.ino!==st.ino||before.size!==st.size||before.ctimeMs!==st.ctimeMs)fail('原插件来源在读取前变化');const buffer=Buffer.alloc(st.size+1);let length=0;while(length<buffer.length){const n=readSync(fd,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}const after=fstatSync(fd);if(length!==st.size||after.size!==st.size||after.dev!==st.dev||after.ino!==st.ino||after.ctimeMs!==st.ctimeMs||after.mtimeMs!==st.mtimeMs)fail('原插件来源在读取中变化');files[relative(root,p)]=buffer.subarray(0,length);}finally{closeSync(fd);}}};walk(root,0);return files;
}
function checkPayload(origin:LegacyPluginOrigin,files:Readonly<Record<string,Buffer>>,storeRoot:string){
 const manifestBytes=files['origin/manifest.json'],markerBytes=files['origin/root-marker.json'];if(!manifestBytes||!markerBytes||digest(manifestBytes)!==origin.manifestHash)fail('原插件清单依据缺失或不同');
 const manifest=legacyManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8'))),marker=JSON.parse(markerBytes.toString('utf8')),runRoot=join(storeRoot,'runs',origin.projectId,origin.taskId,manifest.runId);
 if(manifest.projectId!==origin.projectId||origin.runRoot!==runRoot||origin.pluginRoot!==join(runRoot,'plugin')||marker.owner!=='SmartDD'||marker.schema!==1||Object.keys(marker).sort().join(',')!=='owner,schema')fail('原插件路径或原根标记不同');
 const expected=Object.entries(manifest.files).filter(([p])=>p.startsWith(origin.pluginRoot+'/')).map(([p,sha256])=>({path:'plugin/'+p.slice(origin.pluginRoot.length+1),sha256}));
 const names=['origin/manifest.json','origin/root-marker.json',...expected.map(f=>f.path)].sort();if(!expected.length||canonicalJson(Object.keys(files).sort())!==canonicalJson(names)||expected.some(f=>!files[f.path]||digest(files[f.path])!==f.sha256))fail('原插件完整文件集或字节不同');
 const plugin=JSON.parse(files['plugin/.claude-plugin/plugin.json']?.toString('utf8')??'null');if(!plugin||plugin.name!=='smartdd'||plugin.version!=='1.0.0')fail('原插件命名空间不同');
 return{pluginFiles:Object.fromEntries(expected.map(f=>[f.path.slice(7),Buffer.from(files[f.path])])),rootMarker:Buffer.from(markerBytes),manifest:Buffer.from(manifestBytes)};
}
/** C source retention only; no old-owner exit proof, alias registration, repair or launch authority. */
export class LegacyPluginSources {
 constructor(private readonly store:ResourceStore){}
 private readAt(directory:string,expectedHash:string,origin:LegacyPluginOrigin){
  try{const all=readArchive(directory),record=JSON.parse(all['bundle.json']?.toString('utf8')??'null'),marker=JSON.parse(all[OWNED_BUNDLE_MARKER]?.toString('utf8')??'null');if(!record||!marker||marker.schema!==1||marker.storeId!==this.store.storeId||marker.hash!==expectedHash||Object.keys(marker).sort().join(',')!=='hash,schema,storeId')return fail('原插件留存归属不同');const metadata=metadataSchema.parse(record.metadata);if(canonicalJson(metadata)!==canonicalJson(origin))return fail('原插件留存绑定另一原依据');delete all['bundle.json'];delete all[OWNED_BUNDLE_MARKER];const rebuilt=ownedBundle(metadata,all);if(rebuilt.hash!==expectedHash||canonicalJson(rebuilt.manifest)!==canonicalJson(record))return fail('原插件留存完整摘要不同');return checkPayload(metadata,all,this.store.root);}catch(error){if(error instanceof ApplicationError)throw error;return fail('原插件留存缺失、损坏或不可核验');}
 }
 async retain(reader:LegacyTaskEvidenceReader,evidence:LegacyTaskEvidence):Promise<ResourceRecord|null>{
  const source=reader.capturePlugin(evidence);if(!source)return null;const origin=legacyPluginOrigin(evidence),files={'origin/manifest.json':source.manifest,'origin/root-marker.json':source.rootMarker,...Object.fromEntries(Object.entries(source.files).map(([p,b])=>['plugin/'+p,b]))};checkPayload(origin,files,this.store.root);const bundle=ownedBundle(origin,files),dependencies=evidence.skills.filter(s=>s.enabled).map(s=>'standard-skill:'+s.skillId+':'+s.hash);
  return this.store.publish({resourceId:legacyPluginResourceId(evidence.taskId,evidence.manifestHash),kind:'legacy-plugin-source',contentHash:bundle.hash,relativePath:'legacy/plugins/'+bundle.hash,dependencies,materialize:dir=>writeOwnedBundle(dir,bundle,this.store.storeId),verify:dir=>{this.readAt(dir,bundle.hash,origin);}});
 }
 /** Byte verification only. Matching original static paths do not prove that a
  * native process exited, grant ownership, repair paths or permit activation.
  */
 verifyOriginalPlugin(resource:ResourceRecord,origin:LegacyPluginOrigin):void{
  const source=this.verify(resource,origin),actual=readArchive(origin.runRoot),expected={'.smartdd-owned.json':source.rootMarker,...Object.fromEntries(Object.entries(source.pluginFiles).map(([p,b])=>['plugin/'+p,b]))};
  if(canonicalJson(Object.keys(actual).sort())!==canonicalJson(Object.keys(expected).sort())||Object.entries(expected).some(([p,b])=>!actual[p]?.equals(b)))fail('原静态插件路径含不同字节、临时配置或未知内容，保留原路径');
 }
 verify(resource:ResourceRecord,origin:LegacyPluginOrigin){
  if(resource.resourceId!==legacyPluginResourceId(origin.taskId,origin.manifestHash)||resource.kind!=='legacy-plugin-source'||resource.ownerStoreId!==this.store.storeId||resource.pathScope!=='C'||resource.relativePath!=='legacy/plugins/'+resource.contentHash||resource.state!=='ready'||resource.integrity!=='valid')return fail('原插件来源登记不属于此历史');
  const dependencies=(this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(resource.resourceId) as {dependency_id:string}[]).map(d=>d.dependency_id);const result=this.readAt(this.store.directory(resource),resource.contentHash,origin);
  const skills=Object.keys(result.pluginFiles).filter(p=>/^skills\/[^/]+\/SKILL\.md$/.test(p)).map(p=>p.split('/')[1]).sort(),expected=origin.skills.map(s=>'standard-skill:'+s.skillId+':'+s.hash).sort();if(canonicalJson(skills)!==canonicalJson(origin.skills.map(s=>s.skillId).sort())||canonicalJson(dependencies)!==canonicalJson(expected))return fail('原插件来源依赖缺失或不同');return result;
 }
}
