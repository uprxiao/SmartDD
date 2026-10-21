import {constants,closeSync,fstatSync,lstatSync,openSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import type {AgentLoadRequest} from '@shared/agent-adapters';
import {canonicalJson,digest} from './manifest';
import {assertDiscoveryPath} from './legacy-discovery';
import {verifyOwnedBundle} from './owned-bundle';
import type {ResourceStore} from './resource-store';
type Entry=NonNullable<AgentLoadRequest['catalog']>['entries'][number];
const recovery=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','共享发现目录的当前占用或加载依据已变化');
function boundedJson(home:string,path:string,max=4*1024*1024):Record<string,unknown>{
 try{assertDiscoveryPath(home,path);const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>max)throw recovery();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const before=fstatSync(fd),bytes=readFileSync(fd),after=fstatSync(fd),current=lstatSync(path);if(before.dev!==st.dev||before.ino!==st.ino||before.size!==st.size||bytes.length!==st.size||after.ctimeMs!==before.ctimeMs||after.mtimeMs!==before.mtimeMs||after.size!==before.size||current.dev!==before.dev||current.ino!==before.ino||current.ctimeMs!==before.ctimeMs)throw recovery();const value=JSON.parse(bytes.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw recovery();return value;}finally{closeSync(fd);}
 }catch{throw recovery();}
}
/** Physical ownership only.No source readiness or execution grant is inferred. */
export function verifyModernDiscoveryProjection(entry:Entry,home:string):void{
 if(entry.format)throw new ApplicationError('HOST_INCOMPATIBLE','旧投影沿用原格式核验，不参与新格式排除');
 if(entry.path!==join(home,'.agents/skills',entry.nativeName,'SKILL.md'))throw new ApplicationError('OWNERSHIP_CONFLICT','投影越过实际发现根');
 try{const marker=boundedJson(home,join(dirname(entry.path),'.willyou-owned-bundle.json'),4096);if(marker.schema!==1||marker.storeId!==entry.storeId||marker.hash!==entry.projectionHash)throw Error('unknown owner');}
 catch{throw new ApplicationError('OWNERSHIP_CONFLICT','原投影路径当前不具有原受管归属');}
 const manifest=verifyOwnedBundle(dirname(entry.path),entry.projectionHash,entry.storeId);
 if(manifest.metadata.kind!=='codex-agent-projection-v1'||manifest.metadata.homeId!==digest(home)||manifest.metadata.nativeName!==entry.nativeName||manifest.metadata.sourceHash!==entry.sourceHash)throw new ApplicationError('HASH_MISMATCH','原投影内容或原生身份不同');
}
/** Explicit host-only omission of physically unverified modern entries.The raw
 * catalog and its generation stay complete;user paths are neither disabled nor
 * adopted.App authority still comes exclusively from the owned C run scope. */
export function validateNativeDiscoveryExclusions(store:ResourceStore,input:AgentLoadRequest,selectedPaths:readonly string[]):Set<string>{
 const proof=input.catalogExclusions;if(!proof)return new Set();const catalog=input.catalog,home=input.native.home,homeId=digest(home);
 if(input.snapshot.runner!=='codex'||input.snapshot.legacyBinding||!catalog||proof.generation!==catalog.generation||digest(canonicalJson({homeId,entries:catalog.entries}))!==catalog.generation)throw recovery();
 const root=join(home,'.agents/smartdd-runtime'),marker=boundedJson(home,join(root,'.willyou-catalog-root.json'),4096),raw=boundedJson(home,join(root,'catalog.json'));
 if(marker.schema!==1||marker.owner!=='SmartDD'||marker.homeId!==homeId||marker.initialized!==true||raw.schema!==1||raw.homeId!==homeId||raw.generation!==catalog.generation||canonicalJson(raw.entries)!==canonicalJson(catalog.entries))throw recovery();
 const run=store.sqlite.prepare('SELECT task_id,project_id,runner,owner_instance_id,owner_pid,owner_started_at,pty_id,state,revocation_state FROM capability_runs WHERE run_id=?').get(input.runId) as {task_id:string;project_id:string;runner:string;owner_instance_id:string;owner_pid:number;owner_started_at:string;pty_id:string;state:string;revocation_state:string}|undefined;
 if(!run||run.task_id!==input.snapshot.taskId||run.project_id!==input.snapshot.projectId||run.runner!=='codex'||run.owner_pid!==process.pid||!['preparing','prepared','active'].includes(run.state)||run.revocation_state!=='open')throw recovery();
 const consumer=boundedJson(home,join(root,'catalog-consumers',store.storeId+'-'+input.runId+'.json'),16384),owner=consumer.owner as Record<string,unknown>|undefined;
 if(consumer.schema!==1||consumer.homeId!==homeId||consumer.generation!==catalog.generation||consumer.runner!=='codex'||consumer.runId!==input.runId||consumer.ptyId!==run.pty_id||!['preparing','active'].includes(String(consumer.phase))||!owner||owner.storeId!==store.storeId||owner.uFingerprint!==digest(dirname(store.root))||owner.instanceId!==run.owner_instance_id||owner.pid!==run.owner_pid||owner.startedAt!==run.owner_started_at)throw recovery();
 const paths=new Set(proof.paths);
 for(const path of paths){const entry=catalog.entries.find(e=>e.path===path);if(!entry||entry.format||selectedPaths.includes(path))throw new ApplicationError('SCOPE_DENIED','不能排除旧格式、未知路径或本轮启用的受管Skill');let unavailable=false;try{verifyModernDiscoveryProjection(entry,home);}catch(error){if(error instanceof ApplicationError&&['HASH_MISMATCH','OWNERSHIP_CONFLICT'].includes(error.code))unavailable=true;else throw error;}if(!unavailable)throw new ApplicationError('RESOURCE_STATE_CHANGED','原目录已恢复受管归属，须重新准备而非扩大本轮加载');}
 return paths;
}
