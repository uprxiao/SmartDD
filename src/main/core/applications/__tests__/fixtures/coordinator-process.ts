import { readFileSync,writeFileSync,writeSync } from 'node:fs';
import { join } from 'node:path';
import { withResourceLock } from '../../resource-lock';
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
void withResourceLock(root,hold).catch(error => { console.error(error);process.exitCode = 1; });
