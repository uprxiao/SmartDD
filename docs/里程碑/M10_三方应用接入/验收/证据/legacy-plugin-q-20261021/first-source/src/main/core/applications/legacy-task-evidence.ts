import {constants,closeSync,fstatSync,lstatSync,openSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative} from 'node:path';
import {z} from 'zod';
import {parseDocument} from 'yaml';
import {ApplicationError} from '@shared/applications';
import {treeHash} from '../capabilities/assets';
import {canonicalJson,digest} from './manifest';

// The M4 schema is deliberately unchanged. A valid shape alone is not migration proof.
export const legacyRuntimeMetadata=z.object({runId:z.uuid(),projectId:z.string().min(1).max(128),configVersion:z.number().int().nonnegative(),configHash:z.string().regex(/^[a-f0-9]{64}$/),manifestPath:z.string().min(1).max(4096),auditPath:z.string().min(1).max(4096),skills:z.array(z.object({skillId:z.string(),name:z.string(),versionId:z.string(),version:z.string(),hash:z.string().regex(/^[a-f0-9]{64}$/),path:z.string(),enabled:z.boolean(),loaded:z.literal('unverified')}).strict()).max(64),mcp:z.array(z.object({name:z.string(),loaded:z.literal('unverified')}).strict()).max(16),selfCheck:z.object({status:z.enum(['pending','passed','failed']),issues:z.array(z.string().max(256)).max(256),at:z.number().nullable()}).strict()}).strict();
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const legacyManifestSchema=z.object({schemaVersion:z.literal(1),projectId:z.string(),configVersion:z.number().int().nonnegative(),configHash:hash,runId:z.uuid(),files:z.record(z.string(),hash),requiredEnv:z.array(z.string()).max(512),pathEnv:z.record(z.string(),z.string()),pythonModules:z.array(z.string()).max(64),commands:z.array(z.string()).max(64),readablePaths:z.array(z.string()).max(256)}).strict();
export interface LegacySkillVersion {id:string;skillId:string;name:string;version:string;hash:string}
export interface LegacyTaskIdentity {taskId:string;projectId:string;runner:'claude-code'|'codex'}
export interface LegacyTaskEvidence extends Readonly<LegacyTaskIdentity> {
 readonly schema:'m4-task-evidence-v1';readonly snapshotHash:string;readonly evidenceHash:string;readonly manifestHash:string;
 readonly runRoot:string;readonly runtimeHash:string;readonly runtimePath:string;readonly pluginRoot:string|null;readonly pluginName:string|null;
 readonly skills:readonly {readonly skillId:string;readonly versionId:string;readonly hash:string;readonly enabled:boolean;readonly projectionPath:string;readonly nativeName:string|null;readonly sourceHash:string}[];
 readonly mcp:readonly {readonly name:string;readonly protocolMajor:1;readonly runtimeHash:string}[];
}
export type LegacyTaskInspection={state:'unknown';code:'LEGACY_MANIFEST_MISSING'}|{state:'verified';evidence:LegacyTaskEvidence};
interface Observation {path:string;sha256:string;device:number;inode:number;size:number;mode:number;mtimeMs:number;ctimeMs:number}
interface Proof {identity:LegacyTaskIdentity;snapshot:string;observationsHash:string;pluginSource:{manifest:Buffer;rootMarker:Buffer;files:Record<string,Buffer>}|null}
const fail=(message:string):never=>{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED',message);};
/** Read-only migration preflight. It neither changes history nor authorizes an Agent run.
 * The original manifest is mandatory: configHash is not the original runtime code hash.
 * Retain exact paths/names/bytes, including a Skill name that differs from its directory.
 */
export class LegacyTaskEvidenceReader {
 private readonly proofs=new WeakMap<LegacyTaskEvidence,Proof>();
 private readonly root:string;private readonly home:string;
 constructor(root:string,home:string,private readonly version:(id:string)=>LegacySkillVersion|undefined){this.root=realpathSync(root);this.home=realpathSync(home);}
 inspect(identity:LegacyTaskIdentity,value:unknown):LegacyTaskInspection{
  const parsed=legacyRuntimeMetadata.safeParse(value);
  if(!['claude-code','codex'].includes(identity.runner)||!parsed.success||!id.test(identity.taskId)||!id.test(identity.projectId)||parsed.data.projectId!==identity.projectId)throw new ApplicationError('SNAPSHOT_CORRUPT','原M4任务快照格式或归属不同');
  const snapshot=parsed.data,runRoot=join(this.root,'runs',identity.projectId,identity.taskId,snapshot.runId),manifestPath=join(runRoot,'manifest.json');
  if(snapshot.manifestPath!==manifestPath||snapshot.auditPath!==join(this.root,'resource-audit',identity.projectId,identity.taskId+'.jsonl'))fail('原M4快照的受管路径不同，不能沿任意路径寻找历史');
  const observations:Observation[]=[];let bytes=0;let runMarker:Buffer|null=null;
  const read=(path:string,anchor=this.root):Buffer=>{
   this.within(anchor,path);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const before=fstatSync(fd);if(!before.isFile()||before.nlink!==1||(before.mode&0o111)!==0||before.size>4*1024*1024||bytes+before.size>32*1024*1024||observations.length>=4096)fail('原M4文件类型、完整性或读取预算不符');
    const buffer=Buffer.alloc(before.size+1);let length=0;while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count;}const data=buffer.subarray(0,length),after=fstatSync(fd);if(data.length!==before.size||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)fail('原M4文件在核对中发生变化');
    bytes+=data.length;observations.push({path,sha256:digest(data),device:before.dev,inode:before.ino,size:before.size,mode:before.mode,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs});return data;
   }finally{closeSync(fd);}
  };
  const tree=(directory:string,anchor=this.root):Record<string,Buffer>=>{
   this.within(anchor,join(directory,'.smartdd-owned.json'));const files:Record<string,Buffer>=Object.create(null);let visited=0;
   const walk=(dir:string,depth:number)=>{if(depth>32||++visited>4096)fail('原M4目录层级或文件数超过预算');for(const name of readdirSync(dir)){const path=join(dir,name),stat=lstatSync(path);if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))fail('原M4目录包含链接或特殊文件');if(stat.isDirectory())walk(path,depth+1);else files[relative(directory,path)]=read(path,anchor);}};walk(directory,0);
   const marker=files['.smartdd-owned.json'];if(!marker)fail('原M4目录缺少归属标记');let owner;try{owner=JSON.parse(marker.toString('utf8'));}catch{fail('原M4归属标记损坏');}
   if(owner.owner!=='SmartDD'||owner.schema!==1||Object.keys(owner).length!==2)fail('原M4目录不属于旧受管格式');if(directory===runRoot)runMarker=Buffer.from(marker);delete files['.smartdd-owned.json'];return files;
  };
  try{
   this.within(this.root,manifestPath);
   try{lstatSync(manifestPath);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{state:'unknown',code:'LEGACY_MANIFEST_MISSING'};throw error;}
   const runFiles=tree(runRoot),raw=runFiles['manifest.json'];if(!raw)fail('原M4启动清单缺失');const manifest=legacyManifestSchema.parse(JSON.parse(raw.toString('utf8')));
   if(manifest.projectId!==snapshot.projectId||manifest.configVersion!==snapshot.configVersion||manifest.configHash!==snapshot.configHash||manifest.runId!==snapshot.runId)fail('原M4启动清单与任务快照不一致');
   const paths=Object.keys(manifest.files);if(!paths.length||paths.length>4096)fail('原M4清单文件集合无效');
   const runtimeRoots=new Set(paths.filter(p=>p.startsWith(this.root+'/runtime/')).map(p=>join(this.root,'runtime',relative(join(this.root,'runtime'),p).split('/')[0])));
   if(runtimeRoots.size!==1)fail('无法从原清单唯一确定原M4运行代码');const runtimePath=[...runtimeRoots][0],runtimeHash=basename(runtimePath);if(!hash.safeParse(runtimeHash).success)fail('原M4运行代码摘要无效');
   const strings=(files:Record<string,Buffer>)=>Object.fromEntries(Object.entries(files).map(([name,data])=>{const text=data.toString('utf8');if(!Buffer.from(text).equals(data))fail('原M4文本资源字节不完整');return[name,text];}));
   const runtimeFiles=tree(runtimePath);if(treeHash(strings(runtimeFiles))!==runtimeHash)fail('原M4运行代码完整摘要不同');
   const expected:Record<string,Buffer>={};for(const[name,data]of Object.entries(runtimeFiles))expected[join(runtimePath,name)]=data;
   const knownRun=new Set(['context.json',...(identity.runner==='claude-code'?['plugin/.claude-plugin/plugin.json']:[]),...(identity.runner==='claude-code'&&snapshot.mcp.length?['mcp.json']:[])]);
   const pathEnv:Record<string,string>={SMARTDD_PROJECT_CONTEXT:join(runRoot,'context.json'),SMARTDD_RESOURCE_AUDIT:snapshot.auditPath,SMARTDD_PROJECT_ID:identity.projectId,SMARTDD_CONFIG_VERSION:String(snapshot.configVersion)};
   for(const [key,name]of [['PROJECT_DB_CONFIG','databases.json'],['REMOTE_SERVERS_CONFIG','servers.json']])if(key in manifest.pathEnv){pathEnv[key]=join(runRoot,name);knownRun.add(name);}
   if(canonicalJson(pathEnv)!==canonicalJson(manifest.pathEnv)||Object.keys(pathEnv).some(key=>!manifest.requiredEnv.includes(key))||manifest.requiredEnv.some(key=>!/^SMARTDD_[A-Z0-9_]+$/.test(key)&&!['PROJECT_DB_CONFIG','REMOTE_SERVERS_CONFIG'].includes(key))||manifest.pythonModules.some(name=>!['pymysql','psycopg2'].includes(name))||manifest.commands.some(name=>name!=='ssh'))fail('原M4配置或依赖契约与受管入口不同');
   const seen=new Set<string>();const skills:LegacyTaskEvidence['skills'][number][]=[];
   for(const skill of snapshot.skills){
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(skill.skillId)||seen.has(skill.skillId)||skill.versionId!==skill.skillId+':'+skill.hash)fail('原M4标准Skill身份冲突');seen.add(skill.skillId);
    const version=this.version(skill.versionId);if(!version||version.id!==skill.versionId||version.skillId!==skill.skillId||version.hash!==skill.hash||version.name!==skill.name||version.version!==skill.version)fail('原M4标准Skill版本记录不一致');
    const source=tree(join(this.root,'packages',skill.skillId,skill.hash));if(treeHash(strings(source))!==skill.hash)fail('原M4标准Skill源包摘要不同');
    let nativeName:string|null=null;
    if(skill.enabled){
     const path=identity.runner==='codex'?join(this.home,'.agents','skills',`smartdd-${skill.skillId}-${skill.hash.slice(0,16)}`,'SKILL.md'):join(runRoot,'plugin','skills',skill.skillId,'SKILL.md');
     if(skill.path!==path)fail('原M4标准Skill路径与原生身份不同');
     const entry=source['SKILL.md'];if(!entry)fail('原M4标准Skill缺少入口');const front=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(entry.toString('utf8'));if(!front)return fail('原M4标准Skill元数据缺失');const document=parseDocument(front[1],{uniqueKeys:true,logLevel:'silent'}),originalName=document.get('name');if(document.errors.length||typeof originalName!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(originalName))return fail('原M4标准Skill原生名称无效');nativeName=originalName;
     const projection=identity.runner==='codex'?tree(dirname(path),this.home):Object.fromEntries(Object.entries(runFiles).filter(([p])=>p.startsWith('plugin/skills/'+skill.skillId+'/')).map(([p,b])=>[p.slice(('plugin/skills/'+skill.skillId+'/').length),b]));
     if(canonicalJson(Object.keys(projection).sort())!==canonicalJson(Object.keys(source).sort())||Object.entries(source).some(([p,b])=>!projection[p]?.equals(b)))fail('原M4投影完整字节与原源包不同');for(const[p,b]of Object.entries(source)){expected[join(dirname(path),p)]=b;if(identity.runner==='claude-code')knownRun.add('plugin/skills/'+skill.skillId+'/'+p);}
    }else if(skill.path!=='')fail('原M4禁用Skill含无法确认的投影路径');
    skills.push(Object.freeze({skillId:skill.skillId,versionId:skill.versionId,hash:skill.hash,enabled:skill.enabled,projectionPath:skill.path,nativeName,sourceHash:skill.hash}));
   }
   if(new Set(skills.filter(s=>s.enabled).map(s=>s.nativeName)).size!==skills.filter(s=>s.enabled).length)fail('原M4原生Skill名称冲突');
   const pluginRoot=identity.runner==='claude-code'&&skills.some(s=>s.enabled)?join(runRoot,'plugin'):null;
   if(pluginRoot){const metadata=runFiles['plugin/.claude-plugin/plugin.json'];if(!metadata)fail('原M4插件身份缺失');const plugin=JSON.parse(metadata.toString('utf8'));if(plugin.name!=='smartdd'||plugin.version!=='1.0.0')fail('原M4插件命名空间不同');}
   if(!runFiles['context.json'])fail('原M4项目上下文缺失');const context=JSON.parse(runFiles['context.json'].toString('utf8'));if(context.schemaVersion!==1||context.projectId!==snapshot.projectId||context.configVersion!==snapshot.configVersion||context.configHash!==snapshot.configHash||canonicalJson(context.skills)!==canonicalJson(snapshot.skills.filter(s=>s.enabled).map(({name,path,version})=>({name,path,version}))))fail('原M4项目上下文与任务能力不同');
   const expectedRunPaths=Object.keys(runFiles).filter(p=>!['manifest.json','self-check.json'].includes(p));if(expectedRunPaths.length!==knownRun.size||expectedRunPaths.some(p=>!knownRun.has(p)))fail('原M4运行目录出现未声明的能力或文件');
   for(const name of expectedRunPaths)expected[join(runRoot,name)]=runFiles[name];
   if(canonicalJson(paths.sort())!==canonicalJson(Object.keys(expected).sort())||Object.entries(expected).some(([p,b])=>manifest.files[p]!==digest(b)))fail('原M4清单完整文件集合或字节不符');
   if(snapshot.mcp.length>1||snapshot.mcp.some(m=>!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(m.name)))fail('原M4上下文桥身份不属于已知契约');
   if(snapshot.mcp.length&&identity.runner==='claude-code'){
    const rawMcp=runFiles['mcp.json'];if(!rawMcp)fail('原M4上下文桥注册缺失');const config=JSON.parse(rawMcp.toString('utf8')),expectedMcp={mcpServers:{[snapshot.mcp[0].name]:{command:'python3',args:[join(runtimePath,'context_mcp.py'),join(runRoot,'context.json')]}}};if(canonicalJson(config)!==canonicalJson(expectedMcp))fail('原M4上下文桥名称或执行代码不同');
   }
   const snapshotBytes=canonicalJson(snapshot),observationsHash=digest(canonicalJson(observations)),identityData={schema:'m4-task-evidence-v1' as const,taskId:identity.taskId,projectId:identity.projectId,runner:identity.runner,snapshotHash:digest(snapshotBytes),manifestHash:digest(raw),runRoot,runtimeHash,runtimePath,pluginRoot,pluginName:pluginRoot?'smartdd':null,skills:Object.freeze(skills),mcp:Object.freeze(snapshot.mcp.map(m=>Object.freeze({name:m.name,protocolMajor:1 as const,runtimeHash})))};
   const evidence=Object.freeze({...identityData,evidenceHash:digest(canonicalJson({identity:identityData,observationsHash}))});this.proofs.set(evidence,{identity:{...identity},snapshot:snapshotBytes,observationsHash,pluginSource:pluginRoot?{manifest:Buffer.from(raw),rootMarker:Buffer.from(runMarker!),files:Object.fromEntries(Object.entries(runFiles).filter(([name])=>name.startsWith('plugin/')).map(([name,data])=>[name.slice(7),Buffer.from(data)]))}:null});return{state:'verified',evidence};
  }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原M4证据缺失、损坏或无法核验，保留原记录');}
 }
 /** Exact original bytes from this reader's live proof; JSON clones grant no capture authority. */
 capturePlugin(evidence:LegacyTaskEvidence):{manifest:Buffer;rootMarker:Buffer;files:Record<string,Buffer>}|null{
  const proof=this.proofs.get(evidence);if(!proof||!this.verify(evidence))fail('原M4插件来源证明已失效，不能留存');
  const source=proof!.pluginSource;return source?{manifest:Buffer.from(source.manifest),rootMarker:Buffer.from(source.rootMarker),files:Object.fromEntries(Object.entries(source.files).map(([name,data])=>[name,Buffer.from(data)]))}:null;
 }
 verify(evidence:LegacyTaskEvidence):boolean{
  const proof=this.proofs.get(evidence);if(!proof)return false;
  try{const current=this.inspect(proof.identity,JSON.parse(proof.snapshot));return current.state==='verified'&&current.evidence.evidenceHash===evidence.evidenceHash;}catch{return false;}
 }
 private within(anchor:string,path:string):void{
  if(!isAbsolute(path)||!path.startsWith(anchor+'/')||join(anchor,relative(anchor,path))!==path)fail('原M4文件越过已确认根目录');
  const parts=relative(anchor,path).split('/');let current=anchor;for(let i=0;i<parts.length-1;i++){current=join(current,parts[i]);try{const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())fail('原M4父目录包含链接或非目录');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}}
 }
}
