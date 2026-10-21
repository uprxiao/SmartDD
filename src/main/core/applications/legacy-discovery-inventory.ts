import {lstatSync,readdirSync,constants,openSync,readFileSync,closeSync,fstatSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {canonicalJson} from './manifest';
import {assertDiscoveryPath,legacyDiscoveryEntry,verifyLegacyDiscoveryEntry} from './legacy-discovery';
import {LegacyCapabilityResourceAdopter,readLegacyOwnedTree} from './legacy-resource-adopter';
import {DiscoveryCatalog,type DiscoveryProjectionSource} from './discovery-catalog';
import type {ResourceStore} from './resource-store';

function present(path:string){try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
/** Import only existing original paths backed by this data root's full version
 * records and C bytes. Never invent an owner for a foreign/unrecognised tree,
 * recreate an unselected missing version, or modify user Skill content. */
export class LegacyDiscoveryInventory{
 constructor(private readonly store:ResourceStore,private readonly catalog:DiscoveryCatalog){}
 async sources(signal?:AbortSignal):Promise<DiscoveryProjectionSource[]>{
  const home=this.catalog.home,root=join(home,'.agents/skills');
  if(!present(root))return[];assertDiscoveryPath(home,root);
  const names=readdirSync(root);if(names.length>12000)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','共享Skill目录超过盘点预算');
  const versions=this.store.sqlite.prepare('SELECT id,skill_id AS skillId,hash FROM skill_versions ORDER BY id').all() as {id:string;skillId:string;hash:string}[];
  if(versions.length>4096)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','历史Skill版本超过盘点预算');
  const known=new Set(versions.map(v=>legacyDiscoveryEntry(this.store.storeId,home,v.skillId,v.hash).nativeName)),registered=new Set((await this.catalog.snapshot()).entries.map(e=>e.nativeName));
  for(const name of names){
   if(known.has(name)||registered.has(name)||!/^smartdd-[a-z][a-z0-9-]{0,63}-[a-f0-9]{16}$/.test(name))continue;
   const path=join(root,name),dir=lstatSync(path),marker=join(path,'.smartdd-owned.json');
   if(!dir.isDirectory()||dir.isSymbolicLink()||!present(marker))continue;
   assertDiscoveryPath(home,marker);const st=lstatSync(marker);if(!st.isFile()||st.nlink!==1||st.size>4096)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','其他历史Skill的归属暂不能核验');
   const fd=openSync(marker,constants.O_RDONLY|constants.O_NOFOLLOW);let owner:{owner?:string;schema?:number};
   try{const before=fstatSync(fd),bytes=readFileSync(fd),after=fstatSync(fd);if(before.dev!==st.dev||before.ino!==st.ino||before.size!==st.size||after.ctimeMs!==before.ctimeMs||after.size!==before.size)throw Error('changed marker');owner=JSON.parse(bytes.toString('utf8'));if(!owner||typeof owner!=='object'||Array.isArray(owner))throw Error('unknown owner marker');}catch{throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','其他历史Skill的归属暂不能核验');}finally{closeSync(fd);}
   if(owner.owner==='SmartDD'&&owner.schema===1)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','存在没有本数据根完整来源的历史Skill，保留原目录');
  }
  const result=new Map<string,DiscoveryProjectionSource>(),reader=new LegacyCapabilityResourceAdopter(this.store);
  for(const version of versions){
   if(signal?.aborted)throw new ApplicationError('CANCELED','已取消历史Skill盘点');
   const entry=legacyDiscoveryEntry(this.store.storeId,home,version.skillId,version.hash);
   if(version.id!==`${version.skillId}:${version.hash}`)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原Skill版本身份不同');
   if(!names.includes(entry.nativeName))continue;
   const target=dirname(entry.path);assertDiscoveryPath(home,target);const projection=verifyLegacyDiscoveryEntry(entry,home).files,sourcePath=join(this.store.root,'packages',version.skillId,version.hash),source=(assertDiscoveryPath(this.store.root,sourcePath),readLegacyOwnedTree(sourcePath,version.hash));
   if(canonicalJson({...source})!==canonicalJson({...projection}))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','历史Skill目录与完整原来源不同');
   const prior=result.get(entry.nativeName);if(prior&&prior.sourceHash!==entry.sourceHash)throw new ApplicationError('OWNERSHIP_CONFLICT','不同原版本占用同一Skill目录，不能重命名或改签');
   const resource=await reader.adoptStandard(version.skillId,version.hash);
   result.set(entry.nativeName,{format:'legacy-tree-v1',nativeName:entry.nativeName,sourceHash:version.hash,sourceResourceId:resource.resourceId,files:Object.fromEntries(Object.entries(source).map(([p,t])=>[p,Buffer.from(t)])),executables:new Set()});
  }
  return[...result.values()];
 }
 async prepare(signal?:AbortSignal){try{return await this.catalog.publishOrRecover(await this.sources(signal),{signal});}catch(error){if(!(error instanceof ApplicationError)&&['ENOENT','ENOTDIR','EACCES','EPERM','ELOOP'].includes((error as NodeJS.ErrnoException).code??''))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','历史Skill目录暂不可核验，保留原路径');throw error;}}
}
