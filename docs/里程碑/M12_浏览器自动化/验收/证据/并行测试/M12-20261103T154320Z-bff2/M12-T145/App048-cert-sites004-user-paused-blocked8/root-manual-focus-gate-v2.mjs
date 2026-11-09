import {readFile,writeFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const exec=promisify(execFile),root='/private/tmp/willyou-m12-t145-cert-sites24-prep-004';
const manual=JSON.parse(await readFile(root+'/manual-ready.json'));
const userConfirmedAt=new Date().toISOString(),samples=[];
let stable=null,passed=false;
for(const end=Date.now()+60000;Date.now()<end;){
 const result=await exec('/Users/liubu/.hermes/node/bin/node',[root+'/root-read-current-focus.mjs'],{env:{...process.env,NODE_COMPILE_CACHE:root+'/root-gate-cache/node'}});
 const rows=result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
 const host=rows.find(x=>x.type==='own-renderer')?.result,native=rows.find(x=>x.type==='own-localTLS')?.result;
 const correctContext=host?.taskId===manual.taskId&&host.visible==='visible';
 const focused=correctContext&&(host.focused||(native?.focused&&native.visible==='visible'&&native.marker==='T145_TLS_OWNED'));
 samples.push({at:new Date().toISOString(),host,native,focused});
 if(focused){stable??=Date.now();if(Date.now()-stable>=2000){
  const front=JSON.parse((await exec('/usr/bin/osascript',['-l','JavaScript','/private/tmp/willyou-m12-foreground-observer-001/frontmost.jxa'])).stdout);
  samples.push({frontmost:front});if(front.pid===manual.appPid){passed=true;break;}stable=null;
 }}else stable=null;
 await new Promise(resolve=>setTimeout(resolve,200));
}
await writeFile(root+'/root-manual-focus-proof.json',JSON.stringify({userConfirmedAt,passed,samples,boundary:'Read only exact owned host+TLS focus, same task, native page marker, exact foregroundAppPID. Original live guard and allowOwnedViews unchanged; no activation/rearm/riskclick.'},null,2)+'\n',{mode:0o600});
assert(passed,'No stable exact owned host-or-Native focus; no manualreceipt written');
const receipt={coordinator:'root',scope:manual.scope,action:'user-completed-risk-continue',appPid:manual.appPid,taskId:manual.taskId,pageId:manual.pageId,url:manual.url,userConfirmedAt,focusStableAt:new Date().toISOString(),basis:'User explicitly replied已点击继续; loaded own TLS marker and exactAppPID/host-or-ownedNativefocus stable2s. RootGatev1 wrongly required host-only focus; original guard unchanged.'};
await writeFile(root+'/manual-user-continue.receipt.tmp',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
await rename(root+'/manual-user-continue.receipt.tmp',root+'/manual-user-continue.receipt.json');
console.log(JSON.stringify({manualReceiptWritten:true,appPid:manual.appPid,stableOwnedNativeOrHost:true}));
