import {writeSync} from 'node:fs';
import {join} from 'node:path';
import {openDbClient} from '../../../../db/client';
import {acquireDatabaseAccess} from '../../../../db/database-access-gate';
import {ResourceStore} from '../../resource-store';
import {MacProcessIdentityReader} from '../../process-identity';
import {PackageRegistry} from '../../package-registry';
import {activateBuiltinDistribution} from '../../activation-startup';
async function main(){
 const [root,source,helper,checkpoint]=process.argv.slice(2),client=openDbClient(join(root,'smartdd.db')),lease=await acquireDatabaseAccess(root,'maintenance');
 if(checkpoint==='activation-transaction'){
  const original=PackageRegistry.prototype.activateSet;
  PackageRegistry.prototype.activateSet=function(requests,maintenance){
   if(!maintenance)throw new Error('maintenance required');
   return original.call(this,requests,{...maintenance,recordCommit:result=>{maintenance.recordCommit(result);writeSync(1,JSON.stringify({phase:checkpoint,pid:process.pid})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}});
  };
 }
 if(checkpoint==='activation-committed'){
  const original=ResourceStore.prototype.use;
  ResourceStore.prototype.use=function<T>(resourceId:string,kind:string,owner:string,action:(directory:string)=>T|Promise<T>,options?:{identity?:{pid:number;startedAt:string}}):Promise<T>{
   return original.call(this,resourceId,kind,owner,async directory=>{const result=await action(directory);if(kind==='application-activation'){writeSync(1,JSON.stringify({phase:checkpoint,pid:process.pid})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return result;},options) as Promise<T>;
  };
 }
 const store=new ResourceStore(client.sqlite,root,phase=>{if(phase===checkpoint){writeSync(1,JSON.stringify({phase,pid:process.pid})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}},{processes:new MacProcessIdentityReader(helper)});
 try{await activateBuiltinDistribution(store,lease,source);}finally{client.close();lease.release();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
