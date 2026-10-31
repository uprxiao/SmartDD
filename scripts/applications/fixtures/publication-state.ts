// PG I prerequisite: original registry/publisher, exact own unused package.
// Pauses are after durable registered/materialized checkpoints, outside C.
import Database from 'better-sqlite3';
import {readFileSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {PackageRegistry} from '../../../src/main/core/applications/package-registry';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
import {validateBundle,type ApplicationBundle} from '../../../src/main/core/applications/manifest';
async function main(){
 const[userData,helper,mode]=process.argv.slice(2),root=dirname(userData);
 if(realpathSync(userData)!==userData||!userData.startsWith('/private/tmp/willyou-m10-publication-ui-')||!userData.endsWith('/userdata')||!['publish','recover'].includes(mode)||!helper.startsWith('/private/tmp/willyou-m10-')||!helper.endsWith('/native/willyou-process-identity'))throw Error('Only this recorded private publication fixture is allowed');
 const db=new Database(join(userData,'smartdd.db'));db.pragma('foreign_keys=ON');const processes=new MacProcessIdentityReader(helper);let expectedHash='';
 const store=new ResourceStore(db,userData,mode==='publish'?at=>{
  if(!['registered','materialized'].includes(at))return;
  const resource=store.get('app:'+expectedHash),operation=db.prepare('SELECT * FROM capability_resource_operations WHERE operation_id=?').get(resource.operationId) as {plan_json:string};
  const plan=JSON.parse(operation.plan_json);if(plan.pid!==process.pid||plan.hash!==expectedHash||processes.read(process.pid)?.startedAt!==plan.host?.startedAt)throw Error('Own publisher kernel identity mismatch');
  const receipt={phase:at,pid:process.pid,hash:expectedHash,state:resource.state,operationId:resource.operationId,host:plan.host,at:new Date().toISOString()};writeFileSync(join(root,'publisher-'+at+'.json'),JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify(receipt)+'\n');
  const release=join(root,'publisher-'+at+'-release'),deadline=performance.now()+15000;
  while(!existsSync(release)){if(performance.now()>=deadline)throw Error('Own publisher gate deadline');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
  if(readFileSync(release,'utf8').trim()==='fail')throw Error('PG_OWNED_PUBLICATION_FAILURE');
 }:undefined,{processes}),packages=new PackageRegistry(store,'PG-private-publication');
 try{
  let source:ApplicationBundle;
  if(mode==='publish'){
   const active=packages.active('zentao');if(!active)throw Error('Original App bootstrap required');const current=packages.get(active.packageHash),manifest=structuredClone(current.manifest);manifest.version='0.9.0';manifest.description='Private unused PG publication-state fixture; never activated or executed';source={manifest,files:Object.fromEntries(manifest.files.map(f=>[f.path,readFileSync(join(store.root,current.relativePath,f.path))]))};expectedHash=validateBundle(source).packageHash;writeFileSync(join(root,'publication-source.json'),JSON.stringify({expectedHash,manifest,files:Object.fromEntries(Object.entries(source.files).map(([n,b])=>[n,b.toString('base64')]))})+'\n',{flag:'wx',mode:0o600});
   await packages.install(source);throw Error('Expected explicit materialized failure was not requested');
  }else{
   const saved=JSON.parse(readFileSync(join(root,'publication-source.json'),'utf8'));source={manifest:saved.manifest,files:Object.fromEntries(Object.entries(saved.files).map(([n,b])=>[n,Buffer.from(String(b),'base64')]))};expectedHash=validateBundle(source).packageHash;if(expectedHash!==saved.expectedHash)throw Error('Original private source changed');const original=store.get('app:'+expectedHash),operationId=original.operationId;if(!operationId||original.state!=='recovery-required')throw Error('Only original failed publication may recover');await packages.recoverInstall(source,operationId);const after=store.get(original.resourceId);if(after.state!=='ready'||after.operationId!==operationId)throw Error('Recovery changed original operation identity');process.stdout.write(JSON.stringify({phase:'recovered',hash:expectedHash,operationId,state:after.state,pid:process.pid,at:new Date().toISOString()})+'\n');
  }
 }finally{db.close();}
}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
