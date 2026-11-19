import {spawnSync} from 'node:child_process';
import {existsSync,openSync,closeSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {matchesStat} from './gate-lib.mjs';

const control=dirname(fileURLToPath(import.meta.url));
const root=dirname(control);
const args=process.argv.slice(2);
const readScope=()=>{
  const p=join(control,'scope.json');
  return existsSync(p)&&realpathSync(p)===p?JSON.parse(readFileSync(p,'utf8')):null;
};
const scope=readScope();
const cwd=realpathSync(process.cwd());
const match=matchesStat({cwd,args,root,scope});
let fd;
if(match)try{fd=openSync(join(control,'claimed'),'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;}
const real=spawnSync('/usr/bin/git',args,{encoding:null,timeout:110000,maxBuffer:8*1024*1024,env:process.env});
if(fd!==undefined){
  closeSync(fd);
  const manifest={pid:process.pid,parentPid:process.ppid,cwd,args,at:Date.now(),status:real.status,stdoutBytes:real.stdout?.length};
  writeFileSync(join(control,'ready.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});
  const end=Date.now()+55000;
  const lease=join(control,'release');
  let released=false;
  while(Date.now()<end){
    if(existsSync(lease)&&realpathSync(lease)===lease&&readFileSync(lease,'utf8')===scope.nonce){released=true;break;}
    await setTimeout(50);
  }
  writeFileSync(join(control,'forwarded.json'),JSON.stringify({...manifest,forwardedAt:Date.now(),released}),{flag:'wx',mode:0o600});
}
if(real.stdout)process.stdout.write(real.stdout);
if(real.stderr)process.stderr.write(real.stderr);
process.exitCode=real.status??125;
