import {acquireDatabaseAccess} from '../database-access-gate';
const mode=process.argv[3];
if(mode!=='shared'&&mode!=='maintenance')throw new Error('fixture mode');
void acquireDatabaseAccess(process.argv[2],mode).then(lease=>{
 lease.assertHeld();process.stdout.write(JSON.stringify({pid:process.pid,mode})+'\n');
 setInterval(()=>lease.assertHeld(),1000);
}).catch(()=>process.exit(2));
