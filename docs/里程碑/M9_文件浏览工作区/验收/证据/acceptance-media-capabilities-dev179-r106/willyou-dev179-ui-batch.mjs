import {spawn} from 'node:child_process';
import {openSync,closeSync,writeFileSync} from 'node:fs';
const env={...process.env,WILLYOU_FILES_APP:'/private/tmp/willyou-m9-acceptance-batch-r106-build/mac-arm64/WillYou.app/Contents/MacOS/WillYou',WILLYOU_MEDIA_FIXTURES:'/private/tmp/willyou-media-controls-fixtures-_z88t0ri/fixtures.json'},rows=[];
for(const[name,script]of[['capabilities','scripts/files/media-capabilities-ui.mjs'],['keyboard','scripts/files/media-keyboard-ui.mjs'],['controls','scripts/files/media-controls-ui.mjs']]){
 const log='/private/tmp/willyou-dev179-A-'+name+'.log',fd=openSync(log,'w'),started=Date.now();
 try{await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[script],{env,stdio:['ignore',fd,fd]});p.once('error',reject);p.once('exit',(code,signal)=>{rows.push({name,script,log,code,signal,ms:Date.now()-started});resolve();});});}finally{closeSync(fd)}
 console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync('/private/tmp/willyou-dev179-ui-batch-result.json',JSON.stringify({at:new Date().toISOString(),status:rows.every(x=>x.code===0&&!x.signal)?'passed':'failed',rows},null,2)+'\n');if(rows.some(x=>x.code!==0||x.signal))process.exitCode=1;
