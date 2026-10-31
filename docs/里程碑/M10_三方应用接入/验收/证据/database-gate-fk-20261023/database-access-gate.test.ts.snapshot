import {mkdtempSync,realpathSync,rmSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {acquireDatabaseAccess,type DatabaseAccessLease} from './database-access-gate';
let root:string;const leases:DatabaseAccessLease[]=[];
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-db-gate-')));});
afterEach(()=>{for(const lease of leases.splice(0))lease.release();rmSync(root,{recursive:true,force:true});});
async function acquire(mode:DatabaseAccessLease['mode']){const value=await acquireDatabaseAccess(root,mode,{timeoutMs:50});leases.push(value);return value;}
it('allows two cooperative hosts but blocks maintenance until the last host releases',async()=>{
 const a=await acquire('shared'),b=await acquire('shared');a.assertHeld();b.assertHeld();await expect(acquire('maintenance')).rejects.toThrow('仍有宿主');a.release();await expect(acquire('maintenance')).rejects.toThrow('仍有宿主');b.release();const maintenance=await acquire('maintenance');maintenance.assertHeld();await expect(acquire('shared')).rejects.toThrow('仍有宿主');maintenance.release();(await acquire('shared')).assertHeld();
});
it('cancels a waiting upgrade without releasing another host or replacing the gate inode',async()=>{
 const first=await acquire('shared'),before=readFileSync(join(root,'.database-access.sqlite')),controller=new AbortController();
 const waiting=acquireDatabaseAccess(root,'maintenance',{signal:controller.signal});controller.abort();await expect(waiting).rejects.toThrow('取消');first.assertHeld();expect(readFileSync(join(root,'.database-access.sqlite'))).toEqual(before);
});
it('rejects a replaced gate and a lease after release',async()=>{
 const lease=await acquire('shared'),file=join(root,'.database-access.sqlite');renameSync(file,file+'.original');writeFileSync(file,'foreign');expect(()=>lease.assertHeld()).toThrow('身份');lease.release();expect(()=>lease.assertHeld()).toThrow('释放');
});
