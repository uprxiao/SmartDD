import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [profile,base,family,record]=process.argv.slice(2),delay=ms=>new Promise(r=>setTimeout(r,ms));
assert(['chrome','edge'].includes(family));assert.equal(new URL(base).hostname,'127.0.0.1');
const deadline=Date.now()+1800000;let endpoint;
while(Date.now()<deadline){try{const lines=(await readFile(profile+'/DevToolsActivePort','utf8')).trim().split('\n');if(lines.length>=2){endpoint='ws://127.0.0.1:'+Number(lines[0])+lines[1];break}}catch(e){if(e.code!=='ENOENT')throw e}await delay(100)}
assert(endpoint,'Own browser debugging endpoint unavailable');
const ws=new WebSocket(endpoint),pending=new Map();let next=0;
await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true})});
ws.addEventListener('message',event=>{const x=JSON.parse(event.data),p=pending.get(x.id);if(p){pending.delete(x.id);clearTimeout(p.timer);x.error?p.no(Error(x.error.message)):p.ok(x.result)}});
ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.no(Error('Own seed browser connection closed'))}pending.clear()});
const rpc=(method,params={},sessionId)=>new Promise((ok,no)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);no(Error('Own seed CDP timeout: '+method))},1800000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
const poll=async fn=>{const end=Date.now()+1800000;while(Date.now()<end){const x=await fn();if(x)return x;await delay(100)}throw Error('Own browser cookie condition timed out')};
let requestedClose=false;
try{
 const version=await rpc('Browser.getVersion'),targets=await rpc('Target.getTargets');
 const page=targets.targetInfos.find(t=>t.type==='page');assert(page);
 const {sessionId}=await rpc('Target.attachToTarget',{targetId:page.targetId,flatten:true});
 await rpc('Page.enable',{},sessionId);await rpc('Network.enable',{},sessionId);
 const seed=new URL('/seed/'+family,base).href;await rpc('Page.navigate',{url:seed},sessionId);
 const cookie=await poll(async()=>{const x=await rpc('Network.getCookies',{urls:[seed]},sessionId);return x.cookies.find(c=>c.name==='m12_t083_'+family&&c.value==='T083_SYNTHETIC_'+family.toUpperCase())});
 assert.equal(cookie.session,false);assert(cookie.expires>Date.now()/1000);
 await rpc('Page.navigate',{url:new URL('/verify?source='+family,base).href},sessionId);
 const fact=await poll(async()=>{const x=await rpc('Runtime.evaluate',{expression:'(()=>{try{return JSON.parse(document.querySelector("#facts").textContent)}catch{return null}})()',returnByValue:true},sessionId);return x.result?.value?.[family+'Present']===true?x.result.value:null});
 await writeFile(record,JSON.stringify({family,browserProduct:version.product,cookiePresent:true,persistentCookie:true,expiryFuture:true,realServerReceivedCookie:fact[family+'Present'],cookieValuesArchived:false},null,2),{mode:0o600});
 const closed=new Promise(ok=>ws.addEventListener('close',ok,{once:true}));requestedClose=true;
 await rpc('Browser.close').catch(e=>{if(ws.readyState!==WebSocket.CLOSED)throw e});await closed;
 console.log(JSON.stringify({family,persistentCookieObserved:true,serverReceivedCookie:true,normalBrowserCloseRequested:true}));
}finally{
 if(!requestedClose&&ws.readyState===WebSocket.OPEN)await rpc('Browser.close').catch(()=>{});
 if(ws.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);
}
