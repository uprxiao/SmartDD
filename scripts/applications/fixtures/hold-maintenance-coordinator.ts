// Fault fixture: hold only this private C coordinator. No business DB write or
// handler replacement. Release is bounded and uses the original kernel gate.
import {existsSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {withCoordinatorLock} from '../../../src/main/core/applications/coordinator-lock';

async function main(){
 const userData=realpathSync(process.argv[2]),root=dirname(userData),ready=process.argv[3],release=process.argv[4];
 if(!userData.startsWith('/private/tmp/willyou-m10-maintenance-ui-')||!userData.endsWith('/userdata')||ready!==join(root,'maintenance-c-ready.json')||release!==join(root,'maintenance-c-release'))throw Error('Only this recorded private maintenance test root is allowed');
 await withCoordinatorLock(join(userData,'capabilities/locks'),'resource',async()=>{
  writeFileSync(ready,JSON.stringify({pid:process.pid,phase:'holding-private-C',at:new Date().toISOString()})+'\n');const deadline=performance.now()+20000;
  while(!existsSync(release)){if(performance.now()>=deadline)throw Error('Private gate release deadline expired');await new Promise(done=>setTimeout(done,20));}
 });
 console.log(JSON.stringify({pid:process.pid,phase:'released-own-gate',at:new Date().toISOString()}));
}
void main().catch(error=>{console.error(String(error));process.exitCode=1;});
