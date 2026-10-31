import {writeSync} from 'node:fs';
import {join} from 'node:path';
import {openDbClient} from '../../../../db/client';
import {acquireDatabaseAccess} from '../../../../db/database-access-gate';
import {ResourceStore} from '../../resource-store';
import {MacProcessIdentityReader} from '../../process-identity';
import {activateBuiltinDistribution} from '../../activation-startup';
async function main(){
 const [root,source,helper,checkpoint]=process.argv.slice(2),client=openDbClient(join(root,'state.sqlite')),lease=await acquireDatabaseAccess(root,'maintenance');
 const store=new ResourceStore(client.sqlite,root,phase=>{if(phase===checkpoint){writeSync(1,JSON.stringify({phase,pid:process.pid})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}},{processes:new MacProcessIdentityReader(helper)});
 try{await activateBuiltinDistribution(store,lease,source);}finally{client.close();lease.release();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
