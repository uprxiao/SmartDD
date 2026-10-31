import { mkdirSync,readFileSync,writeFileSync,writeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MacProcessIdentityReader } from '../../process-identity';
import { withResourceLock } from '../../resource-lock';
import { withDiscoveryLock } from '../../discovery-catalog-lock';
const [root,kind,mode,helper] = process.argv.slice(2);
const hold = () => {
  if(mode==='increment'){
    const file=join(root,'counter'),before=Number(readFileSync(file,'utf8'));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30);
    writeFileSync(file,String(before+1));return;
  }
  writeSync(1,JSON.stringify({ pid: process.pid,kind }) + '\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
};
if(mode==='legacy'){
  mkdirSync(join(root,'catalog.lock'));writeFileSync(join(root,'catalog.lock/owner.json'),JSON.stringify({schema:1,token:randomUUID(),...new MacProcessIdentityReader(helper).read(process.pid)!}));hold();
}else void (kind === 'C' ? withResourceLock(root,hold) : withDiscoveryLock(root,{ pid: process.pid,startedAt: 'fixture-not-recovery-authority' },hold)).catch(error => { console.error(error);process.exitCode = 1; });
