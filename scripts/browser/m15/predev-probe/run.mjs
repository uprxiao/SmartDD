import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=process.argv[2];
const root=fileURLToPath(new URL('.',import.meta.url)).replace(/\/$/,'');
if (!/^\/private\/tmp\/willyou-m15-predev\.[A-Za-z0-9]+$/.test(root)) throw new Error('Private fixture root required');
const [helper,oldPlaywright,newPlaywright]=process.argv.slice(3);
const require=createRequire(join(repo,'package.json'));
const child=spawn(require('electron'),[join(root,'probe.cjs'),'--user-data-dir='+join(root,'data-2')],{
  env:{
    PATH:process.env.PATH,HOME:join(root,'home-2'),TMPDIR:join(root,'scratch'),WY_M15_LAB:root,
    WY_M15_HELPER:helper,WY_M15_SQLITE:require.resolve('better-sqlite3'),
    WY_M15_PW_OLD:oldPlaywright,WY_M15_PW_NEW:newPlaywright,
  },
  stdio:['ignore','inherit','inherit']
});
const timer=setTimeout(()=>{console.error('Reached fixture limit');child.kill('SIGTERM');},35000);
try {
  process.exitCode=await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>{if(signal)console.error('Exit signal '+signal);resolve(code??1);});
  });
} finally {clearTimeout(timer);}
