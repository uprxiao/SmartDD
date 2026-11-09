import{spawn,execFile}from'node:child_process';
import{mkdir,readFile,writeFile}from'node:fs/promises';
import{join,dirname}from'node:path';
import{fileURLToPath}from'node:url';
import{createRequire}from'node:module';
import{createHash,randomBytes}from'node:crypto';
const dir=dirname(fileURLToPath(import.meta.url)), out=join(dir,'attempt-002');await mkdir(out,{recursive:true});
const home=join(dir,'home-002'),userData=join(dir,'userData-002'),cache=join(dir,'cache-002');for(const p of[home,userData,cache])await mkdir(p,{recursive:true});
const electron=createRequire('/Users/liubu/hx/4.uprxiao/SmartDD/package.json')('electron');
const ab='/private/tmp/m12-deep-review-20261103T073535Z/native-review/agent-browser/bin/agent-browser-darwin-arm64';
const env={PATH:process.env.PATH,HOME:home,TMPDIR:dir,XDG_CACHE_HOME:cache,XDG_CONFIG_HOME:join(home,'config'),AGENT_BROWSER_SOCKET_DIR:join(home,'sock'),AGENT_BROWSER_IDLE_TIMEOUT_MS:'60000'};
const result={at:new Date().toISOString(),boundary:'Synthetic local Electron + same agent-browser 0.27.3 binary; direct global CDP, no final per-page proxy or WillYou gateway; one inactive offscreen window, no OS input/focus acquisition',raw:[],binarySha256:createHash('sha256').update(await readFile(ab)).digest('hex')};
const host=spawn(electron,[join(dir,'host.cjs'),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+userData],{env,stdio:['ignore','pipe','pipe','ipc']});result.hostPid=host.pid;
let logs='',port,ws;host.stdout.on('data',d=>logs+=d);host.stderr.on('data',d=>logs+=d);const exited=new Promise(r=>host.on('exit',(code,signal)=>r({code,signal})));
const abCall=async(command,close=false)=>{const r=await new Promise(resolve=>{const args=close?['--session','e4d','close']:['--session','e4d','--cdp',String(port),'batch','--json'];const c=execFile(ab,args,{env,timeout:15000,maxBuffer:2**20},(e,stdout,stderr)=>{let parsed;try{parsed=JSON.parse(stdout)}catch{}resolve({command,code:e?.code??0,stdout,stderr,parsed})});if(!close)c.stdin.end(JSON.stringify([command]));});result.raw.push(r);return r};
try{
 result.ready=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('ready timeout')),20000);host.once('error',reject);host.on('message',m=>{if(m.ready){clearTimeout(t);resolve(m)}});host.once('exit',()=>{clearTimeout(t);reject(Error('early host exit'))})});
 port=Number((await readFile(join(userData,'DevToolsActivePort'),'utf8')).split('\n')[0]);result.port=port;
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();result.targets=targets.map(t=>({id:t.id,title:t.title,type:t.type,url:t.url}));const target=targets.find(t=>t.title==='M12 R1.1 E4d private');if(!target)throw Error('fixture target missing');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0;const pending=new Map();ws.addEventListener('message',({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){clearTimeout(p.t);pending.delete(m.id);m.error?p.no(Error(JSON.stringify(m.error))):p.ok(m.result)}});
 const cdp=(method,params={})=>new Promise((ok,no)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);no(Error(method+' timeout'))},5000);pending.set(id,{ok,no,t});ws.send(JSON.stringify({id,method,params}))});
 const ev=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await cdp('DOM.enable');await cdp('Accessibility.enable');await cdp('DOM.getDocument',{depth:-1});
 const id=async()=>{const r=await cdp('Accessibility.getFullAXTree');return r.nodes.find(n=>n.role?.value==='button'&&n.name?.value==='Action'&&!n.ignored).backendDOMNodeId};
 const tag=async nonce=>{const backendNodeId=await id();const {nodeIds}=await cdp('DOM.pushNodesByBackendIdsToFrontend',{backendNodeIds:[backendNodeId]});await cdp('DOM.setAttributeValue',{nodeId:nodeIds[0],name:'data-willyou-ref',value:nonce});return backendNodeId};
 const tabs=await abCall(['tab','list']);const list=tabs.parsed[0].result.tabs;const page=list.find(t=>t.title==='M12 R1.1 E4d private');if(!page)throw Error('helper fixture target missing');await abCall(['tab',page.tabId]);
 const nonce1=randomBytes(16).toString('hex');const controlBefore=await tag(nonce1);const controlCall=await abCall(['click','[data-willyou-ref="'+nonce1+'"]']);result.control={backendNodeId:controlBefore,hits:await ev('hits.slice()'),success:controlCall.parsed?.[0]?.success};
 await ev('window.hits=[]');const nonce2=randomBytes(16).toString('hex');const before=await tag(nonce2);
 result.replacement=await ev('(()=>{const a=document.getElementById("original"),b=a.cloneNode(true);b.id="clone";a.replaceWith(b);return{sameNode:a===b,tagCopied:b.getAttribute("data-willyou-ref"),originalConnected:a.isConnected}})()');
 const after=await id();const click=await abCall(['click','[data-willyou-ref="'+nonce2+'"]']);result.cloneCase={beforeBackendNodeId:before,afterBackendNodeId:after,nonce:nonce2,hits:await ev('hits.slice()'),success:click.parsed?.[0]?.success};
 result.rawConclusion={controlClickedOriginal:result.control.success&&JSON.stringify(result.control.hits)==='["original"]',clonedReplacementClicked:before!==after&&result.cloneCase.success&&JSON.stringify(result.cloneCase.hits)==='["clone"]'};
}catch(e){result.failure=String(e.stack||e)}finally{
 if(port)result.helperClose=await abCall([],true);if(ws)ws.close();if(host.connected)host.send('close');let closed=await Promise.race([exited,new Promise(r=>setTimeout(()=>r(null),5000))]);if(!closed){host.kill('SIGTERM');closed=await exited}result.hostExit=closed;result.endedAt=new Date().toISOString();await writeFile(join(out,'host.log'),logs);await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));await writeFile(join(out,'cleanup.json'),JSON.stringify({hostPid:host.pid,hostExit:closed,helperCloseCode:result.helperClose?.code,onlyOwnProcesses:true,privateHome:home,privateUserData:userData,port},null,2));console.log(JSON.stringify({failure:result.failure,control:result.control,cloneCase:result.cloneCase,rawConclusion:result.rawConclusion,cleanup:closed}));}
