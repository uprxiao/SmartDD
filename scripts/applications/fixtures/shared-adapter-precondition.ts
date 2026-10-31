// Non-tested own unused dependency graph, not a native/history projection.
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {PackageRegistry} from '../../../src/main/core/applications/package-registry';
import {AgentAdapterRegistry} from '../../../src/main/core/applications/agent-adapter-registry';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
import {ownedBundle,writeOwnedBundle,verifyOwnedBundle} from '../../../src/main/core/applications/owned-bundle';
async function main(){
 const u=realpathSync(process.argv[2]),helper=realpathSync(process.argv[3]);if(!u.startsWith('/private/tmp/willyou-m10-adapter-gc-')||!u.endsWith('/userdata')||!helper.startsWith('/private/tmp/willyou-m10-'))throw Error('Own adapter fixture only');
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),db=new Database(join(u,'smartdd.db'));db.pragma('foreign_keys=ON');
 try{
  if(db.prepare('SELECT count(*) n FROM tasks').get().n||db.prepare('SELECT count(*) n FROM capability_session_snapshots').get().n||db.prepare("SELECT count(*) n FROM capability_resource_leases WHERE state<>'released'").get().n)throw Error('Unused fresh graph only');
  const store=new ResourceStore(db,u,undefined,{processes:new MacProcessIdentityReader(helper)}),packages=new PackageRegistry(store,'ne-private-unused-graph'),adapters=new AgentAdapterRegistry(store),originalAdapter=db.prepare("SELECT adapter_hash FROM capability_agent_adapters WHERE agent_id='codex' AND version='1.0.0'").get();if(!originalAdapter)throw Error('Original App bootstrap required');const base=adapters.verify(originalAdapter.adapter_hash),metadata={...base.metadata,version:'1.9.0'},files=Object.fromEntries(base.manifest.files.map(f=>[f.path,readFileSync(join(store.directory(base.resource),f.path))]));const entry=files[metadata.entry].toString('utf8'),old="exports.version = '1.0.0';";if(entry.split(old).length!==2)throw Error('Exact original version export required');files[metadata.entry]=Buffer.from(entry.replace(old,"exports.version = '1.9.0';")+'\n// NE private unused adapter sample; no CLI invoked.\n');const adapter=await adapters.install(metadata,files);adapters.verify(adapter.hash);
  const active=packages.active('zentao');if(!active)throw Error('Original default required');const current=packages.get(active.packageHash),consumers=[];
  for(const[index,label]of ['a','b'].entries()){
   const manifest=structuredClone(current.manifest);manifest.version='0.8.'+(6+index);manifest.description='NE private unused shared adapter consumer '+label;const fileBytes=Object.fromEntries(manifest.files.map(f=>[f.path,readFileSync(join(store.root,current.relativePath,f.path))])),pkg=await packages.install({manifest,files:fileBytes}),taskId='ne-unused-'+label,bundle=ownedBundle({kind:'claude-session-projection',taskId,selectionHash:pkg.packageHash,fixture:'NE unused static source,not actual Claude delivery',sources:[{resourceId:pkg.resourceId},{resourceId:adapter.resource.resourceId}]},{'entry.txt':Buffer.from('NE private consumer '+label+'\n')}),projection=await store.publish({resourceId:'claude-projection-source:'+taskId+':'+bundle.hash,kind:'claude-projection-source',contentHash:bundle.hash,relativePath:'projection-sources/claude/'+taskId+'/views/'+bundle.hash,dependencies:[pkg.resourceId,adapter.resource.resourceId],materialize:dir=>writeOwnedBundle(dir,bundle,store.storeId),verify:dir=>{verifyOwnedBundle(dir,bundle.hash,store.storeId);}});consumers.push({label,package:pkg,projection});
  }
  if(packages.active('zentao')?.packageHash!==current.packageHash)throw Error('Default changed');console.log(JSON.stringify({storeId:store.storeId,adapter:{hash:adapter.hash,metadata:adapter.metadata,resource:adapter.resource,manifest:adapter.manifest},consumers,default:current,runtime:store.get('runtime:'+current.manifest.runtime.hash),layer:'Synthetic unused two declared owned projection consumers;original registry/store;0CLI/history;not actual Codex projection dependency evidence'}));
 }finally{db.close();}
}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
