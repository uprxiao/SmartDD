import {spawn,execFile} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const dir=dirname(fileURLToPath(import.meta.url)),out=join(dir,'attempt-003');await mkdir(out,{recursive:true});
const home=join(dir,'private-home-003'),ud=join(dir,'userData-003'),cache=join(dir,'cache-003');for(const p of [home,ud,cache])await mkdir(p,{recursive:true});
const ab=join(dir,'agent-browser/bin/agent-browser-darwin-arm64'),electron=createRequire('/Users/liubu/hx/4.uprxiao/SmartDD/package.json')('electron');
const env={PATH:process.env.PATH,HOME:home,TMPDIR:dir,XDG_CACHE_HOME:cache,XDG_CONFIG_HOME:join(home,'config'),AGENT_BROWSER_SOCKET_DIR:join(home,'sock'),AGENT_BROWSER_IDLE_TIMEOUT_MS:'60000'};
const result={at:new Date().toISOString(),boundary:'Independent local Electron experiment; synthetic pages only; no WillYou gateway; no daily app/profile; transparent no-focus parking window',steps:[]};
const host=spawn(electron,[join(dir,'host.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+ud],{env,stdio:['ignore','pipe','pipe','ipc']});result.hostPid=host.pid;
let stderr='';host.stderr.on('data',d=>stderr+=d);host.stdout.on('data',d=>{});const exit=new Promise(resolve=>host.on('exit',(code,signal)=>resolve({code,signal})));let seq=0;
const ipc=m=>new Promise((resolve,reject)=>{const id=++seq;const fn=r=>{if(r.id!==id)return;clearTimeout(t);host.off('message',fn);r.error?reject(Error(r.error)):resolve(r.value)};const t=setTimeout(()=>{host.off('message',fn);reject(Error('ipc timeout'))},10000);host.on('message',fn);host.send({...m,id});});
let port;
const call=async(command,{session='deep',timeout=20000}={})=>{const start=performance.now();const r=await new Promise(resolve=>{const p=execFile(ab,['--session',session,'--cdp',String(port),'batch','--json'],{env,timeout,maxBuffer:12*1024*1024},(e,stdout,stderr)=>{let parsed;try{parsed=JSON.parse(stdout)}catch{}const item=Array.isArray(parsed)?parsed[0]:parsed;resolve({exit:e?.code??0,signal:e?.signal,ok:item?.success===true,data:item?.result??item?.data,error:item?.error,stdout,stderr})});p.stdin.end(JSON.stringify([command]));});r.ms=Math.round(performance.now()-start);result.steps.push({command:command.map(v=>typeof v==='string'&&v.length>1000?{chars:v.length,utf8Bytes:Buffer.byteLength(v),description:'synthetic repeated ASCII text'}:v),...r});await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));return r;};
const ref=(s,role,name)=>Object.entries(s?.refs??{}).find(([k,v])=>v.role===role&&v.name===name)?.[0];
try{
 const ready=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('ready timeout')),20000);host.on('message',m=>{if(m.ready){clearTimeout(t);resolve(m)}});host.on('error',reject);host.on('exit',c=>reject(Error('host early exit '+c)));});result.ready=ready;
 port=Number((await readFile(join(ud,'DevToolsActivePort'),'utf8')).split('\n')[0]);result.cdpPort=port;
 result.targets=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).map(t=>({id:t.id,type:t.type,title:t.title,url:t.url}));
 const tabs=(await call(['tab','list'])).data.tabs;const one=tabs.find(t=>t.title==='DeepReview Page 1'),two=tabs.find(t=>t.title==='DeepReview Page 2');if(!one||!two)throw Error('test targets missing');
 await call(['tab',one.tabId]);
 let s=(await call(['snapshot'])).data;result.refs={cross:ref(s,'textbox','CrossSiteInput'),closed:ref(s,'textbox','closedInput'),count:ref(s,'button','Count'),action:ref(s,'button','Action')};
 for(const [name,key]of[['cross','CrossSiteInput'],['closed','closedInput']]){const r=ref(s,'textbox',key);if(r)await call(['fill','@'+r,'VERIFY-'+name]);}
 result.crossReadBack=await ipc({action:'eval',expression:'document.getElementById("frame").textContent'});result.closedReadBack=await ipc({action:'eval',expression:'document.getElementById("shadow").textContent'});
 await call(['click','@'+result.refs.count]);result.twoViewsCount=await ipc({action:'eval',expression:'window.count'});result.twoViewsClickMs=result.steps.at(-1).ms;await ipc({action:'parkOne'});await call(['click','@'+result.refs.count]);result.oneViewCount=await ipc({action:'eval',expression:'window.count'});result.oneViewClickMs=result.steps.at(-1).ms;await call(['wait','--fn','(()=>{document.getElementById("count").click();return true})()']);result.waitFnCount=await ipc({action:'eval',expression:'window.count'});
 await call(['wait','--fn','(()=>{document.getElementById("count").click();return false})()','--timeout','300']);result.waitFalseCount=await ipc({action:'eval',expression:'window.count'});
 await call(['screenshot',join(out,'page1.png')]);await ipc({action:'move',index:0});await call(['click','@'+result.refs.count]);result.afterMoveCount=await ipc({action:'eval',expression:'window.count'});
 s=(await call(['snapshot'])).data;const old=ref(s,'button','Action');await ipc({action:'eval',expression:'(()=>{const b=document.createElement("button");b.id="replacement";b.textContent="Action";b.onclick=()=>document.getElementById("effect").textContent="replacement";document.getElementById("dynamic").replaceChildren(b);return true})()'});
 await call(['click','@'+old]);result.staleEffect=await ipc({action:'eval',expression:'document.getElementById("effect").textContent'});
 await call(['tab',one.tabId]);await call(['snapshot']);
await ipc({action:'eval',expression:'document.body.insertAdjacentHTML("beforeend","<textarea id=long></textarea>");document.getElementById("long").focus();true'});await call(['keyboard','type','A'.repeat(65536)],{timeout:90000});result.type64KiB={ms:result.steps.at(-1).ms,ok:result.steps.at(-1).ok,error:result.steps.at(-1).error,length:await ipc({action:'eval',expression:'document.getElementById("long").value.length'})};
}catch(e){result.failure=String(e.stack||e)}finally{
 if(port)await new Promise(resolve=>execFile(ab,['--session','deep','close'],{env,timeout:10000},(e,so,se)=>{result.close={code:e?.code??0,stdout:so,stderr:se};resolve()}));
 if(host.connected)host.send({action:'close'});
 const closed=await Promise.race([exit,new Promise(r=>setTimeout(()=>r(null),5000))]);if(!closed){host.kill('SIGTERM');result.hostExit=await exit}else result.hostExit=closed;
 result.hostStderr=stderr;result.endedAt=new Date().toISOString();await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));await writeFile(join(out,'cleanup.json'),JSON.stringify({hostPid:host.pid,hostExit:result.hostExit,agentBrowserClose:result.close,onlyOwnProcesses:true},null,2));
 console.log(JSON.stringify({failure:result.failure,ready:result.ready,refs:result.refs,crossReadBack:result.crossReadBack,closedReadBack:result.closedReadBack,waitFnCount:result.waitFnCount,waitFalseCount:result.waitFalseCount,afterMoveCount:result.afterMoveCount,staleEffect:result.staleEffect,type64KiB:result.type64KiB,twoViewsCount:result.twoViewsCount,oneViewCount:result.oneViewCount,twoViewsClickMs:result.twoViewsClickMs,oneViewClickMs:result.oneViewClickMs,steps:result.steps.map(s=>({cmd:s.command.slice(0,2),ok:s.ok,ms:s.ms,error:s.error})),cleanup:result.hostExit},null,2));
}
