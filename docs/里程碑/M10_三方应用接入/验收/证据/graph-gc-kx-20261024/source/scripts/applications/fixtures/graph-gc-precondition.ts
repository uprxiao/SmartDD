// Non-tested synthetic setup; the App itself must perform cleanup/cancel/recovery.
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {PackageRegistry} from '../../../src/main/core/applications/package-registry';
import {RuntimeRegistry} from '../../../src/main/core/applications/runtime-registry';
import {DiscoveryCatalog} from '../../../src/main/core/applications/discovery-catalog';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
import {applicationNativeSkillName} from '../../../src/shared/application-session';
import {applicationSkillContentHash} from '../../../src/main/core/applications/session-registry';
import {projectSkillName} from '../../../src/main/core/applications/session-projector';
async function main(){
 const userData=realpathSync(process.argv[2]),home=realpathSync(process.argv[3]),helper=process.argv[4],mode=process.argv[5];
 if(!userData.startsWith('/private/tmp/willyou-m10-graph-app-')||!userData.endsWith('/userdata')||!home.startsWith(userData.slice(0,-9))||!helper.startsWith('/private/tmp/willyou-m10-'))throw Error('Only this private driver fixture is allowed');
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),db=new Database(join(userData,'smartdd.db'));db.pragma('foreign_keys=ON');
 try{
  const processes=new MacProcessIdentityReader(helper),store=new ResourceStore(db,userData,undefined,{processes}),registry=new PackageRegistry(store,'graph-gc-private-fixture'),active=registry.active('zentao');if(!active)throw Error('App bootstrap required');
  const current=registry.get(active.packageHash),manifest=structuredClone(current.manifest);manifest.version='0.9.0';manifest.description='Synthetic unused GC graph '+mode;
  if(mode==='normal-last'){const runtime=store.get('runtime:'+manifest.runtime.hash),source=JSON.parse(readFileSync(join(store.directory(runtime),'runtime.json'),'utf8')),files=Object.fromEntries(source.files.map((f:{path:string})=>[f.path,readFileSync(join(store.directory(runtime),f.path))]));files[source.bridgeEntry]=Buffer.concat([files[source.bridgeEntry],Buffer.from('\n// isolated unused runtime fixture\n')]);manifest.runtime.hash=(await new RuntimeRegistry(store).install({id:source.id,protocolMajor:source.protocolMajor,bridgeEntry:source.bridgeEntry,files})).contentHash;}
  const files=Object.fromEntries(manifest.files.map(f=>[f.path,readFileSync(join(store.root,current.relativePath,f.path))])),old=await registry.install({manifest,files});
  const sources=manifest.skills.map(skill=>{const nativeName=applicationNativeSkillName(manifest.appId,skill.id,old.packageHash),prefix=skill.path+'/';return{nativeName,sourceHash:applicationSkillContentHash(manifest,skill.path),sourceResourceId:old.resourceId,files:Object.fromEntries(manifest.files.filter(f=>f.path.startsWith(prefix)).map(f=>{const name=f.path.slice(prefix.length),bytes=files[f.path];return[name,name==='SKILL.md'?projectSkillName(bytes,nativeName):bytes];})),executables:new Set(manifest.files.filter(f=>f.path.startsWith(prefix)&&f.executable).map(f=>f.path.slice(prefix.length)))};});
  const catalog=await new DiscoveryCatalog(store,home,processes).publish(sources);if(registry.active('zentao')?.packageHash!==current.packageHash)throw Error('Default must remain unchanged');
  console.log(JSON.stringify({layer:'synthetic unused package/runtime/H projections, actual registry and native kernel identity; no historical CLI session',storeId:store.storeId,oldHash:old.packageHash,currentHash:current.packageHash,oldRuntime:manifest.runtime.hash,currentRuntime:current.manifest.runtime.hash,oldRelativePath:old.relativePath,catalog}));
 }finally{db.close();}
}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
