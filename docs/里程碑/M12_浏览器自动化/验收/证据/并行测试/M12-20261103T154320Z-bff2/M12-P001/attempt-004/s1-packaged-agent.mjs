// S1 T037/T045: packaged App + actual Codex 0.166.0; loopback synthetic model chooses calls.
// No daily credentials or external sites. One transient gateway disconnect is deliberate fault injection.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,cp,readdir,rm,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
import {focusNewInstalledWindow} from '../applications/fixtures/dmg-install-ui.mjs';
const [root,executable,expectedAsar,policyMode='named-workspace',approval='on-request']=process.argv.slice(2);
assert(['named-workspace','workspace-write','read-only'].includes(policyMode)&&['on-request','never'].includes(approval));
const policyProbe=process.argv.length>5;
assert(root?.startsWith('/private/tmp/willyou-m12-s1-')&&executable?.startsWith('/private/tmp/willyou-m12-s1-')&&expectedAsar);
await access(executable);
await mkdir(root,{recursive:false});
const home=join(root,'agent-home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata'),cli=join(root,'tools/codex');
for(const p of [home,state,join(cwd,'.git'),dirname(cli)])await mkdir(p,{recursive:true});
await cp('/Users/liubu/.codex/packages/app-server-daemon/releases/0.166.0-aarch64-apple-darwin/bin/codex',cli);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const asar=join(resolve(dirname(executable),'../Resources'),'app.asar');
assert.equal(sha(await readFile(asar)),expectedAsar);assert.equal(execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),'codex-cli 0.166.0');
const marker='M12_S1_'+root.split('-').at(-1),result={startedAt:new Date().toISOString(),root,userData,asarSha256:expectedAsar,cliSha256:sha(await readFile(cli)),sandbox:{policyMode,approval,probe:policyProbe,noBypass:true},layer:'I+R: packaged App -> real managed Codex -> native CLI -> host service; Responses provider is synthetic loopback, not real model reasoning',calls:[],outputs:[],commits:[],files:[],checks:[]};
let app,project,profile,task,stage='setup',phase='first',cursor=0,pending,serial=0;
const sockets=new Set(),seen=new Set();
const persist=async()=>writeFile(join(root,'live.json'),JSON.stringify({...result,stage,phase,cursor,pid:app?.processId},null,2)+'\n');
const poll=async(fn,ms=20000)=>{const end=Date.now()+ms;let last;do{last=await fn();if(last)return last;await new Promise(r=>setTimeout(r,100));}while(Date.now()<end);throw Error('Timeout at '+stage);};
const outputText=value=>typeof value==='string'?value:Array.isArray(value)?value.map(x=>x.text??'').join(''):JSON.stringify(value);
const jsonOf=text=>{const start=text.indexOf('{');assert(start>=0,'No JSON in native output: '+text.slice(0,300));return JSON.parse(text.slice(start).trim());};
const data={};
const canary=join(cwd,'m12-policy-canary.txt'),outside=resolve('.m12-policy-outside-'+sha(root).slice(0,12)+'.txt'),decoyPath='/private/tmp/m12-p001-'+sha(root).slice(0,12)+'.sock';
const decoyPeers=new Set();let decoyConnections=0;
const decoy=policyProbe?createNetServer(socket=>{decoyConnections++;decoyPeers.add(socket);socket.on('error',()=>{});socket.on('close',()=>decoyPeers.delete(socket));socket.end();}):null;
if(decoy)await new Promise((ok,no)=>{decoy.once('error',no);decoy.listen(decoyPath,ok);});
const filesystemCommand=()=>{
 const script='import json,pathlib,socket; records=[]\nfor name,path in '+JSON.stringify([['inside',canary],['outside',outside]])+':\n try:\n  pathlib.Path(path).write_text('+JSON.stringify(marker)+');records.append({"name":name,"wrote":True})\n except OSError as e:records.append({"name":name,"wrote":False,"error":type(e).__name__})\ns=socket.socket(socket.AF_UNIX);s.settimeout(2)\ntry:s.connect('+JSON.stringify(decoyPath)+');connected=True\nexcept OSError:connected=False\nfinally:s.close()\nprint(json.dumps({"writes":records,"otherSocketConnected":connected}))';
 return 'python3 -c '+quote(script);
};
async function nativeContexts(){
 const directory=join(state,'sessions'),contexts=[];
 for(const name of await readdir(directory,{recursive:true})){if(!name.endsWith('.jsonl'))continue;const path=join(directory,name),bytes=await readFile(path),raw=bytes.toString();if(!raw.includes(marker))continue;
 for(const line of raw.split('\n')){if(!line.trim())continue;let row;try{row=JSON.parse(line);}catch{continue;}if(row.type==='turn_context')contexts.push({source:path,sha256:sha(bytes),approval:row.payload.approval_policy,sandbox:row.payload.sandbox_policy});}}
 return contexts;
}

const commandSteps=()=>phase==='restart'?[
 {name:'new-run-get',cmd:()=> 'willyou-app browser operation get --request '+quote(result.disconnected.requestId)},
]:[
 {name:'create',cmd:()=> 'willyou-app browser tab create --url '+quote(site+'delay')},
 {name:'small-snapshot',cmd:()=> 'willyou-app browser snapshot'},
 {name:'small-console',cmd:()=> 'willyou-app browser console --limit 1'},
 {name:'small-network',cmd:()=> 'willyou-app browser network --limit 1'},
 {name:'post-disconnect',cmd:()=> 'willyou-app browser eval --expression '+quote('fetch('+JSON.stringify(site+'commit?key='+marker)+',{method:"POST",body:new URLSearchParams(new FormData(document.getElementById("delay-form")))}).then(r=>r.json())')},
 {name:'same-run-get',cmd:()=> 'willyou-app browser operation get --request '+quote(result.disconnected.requestId)},
 {name:'large-goto',cmd:()=> 'willyou-app browser goto --url '+quote(site+'large')},
 {name:'large-snapshot',cmd:()=> 'willyou-app browser snapshot'},
 {name:'produce',cmd:()=> 'willyou-app browser eval --expression '+quote('window.produceLarge()')},
 {name:'large-console',cmd:()=> 'willyou-app browser console --limit 1'},
 {name:'large-network',cmd:()=> 'willyou-app browser network --limit 1'},
 {name:'sandbox-read',cmd:()=> 'python3 -c '+quote('import json,hashlib,pathlib; files='+JSON.stringify(['large-snapshot','large-console','large-network'].map(name=>data[name].data.file))+'; print(json.dumps({"files":[{"path":f["path"],"bytes":len(pathlib.Path(f["path"]).read_bytes()),"sha256":hashlib.sha256(pathlib.Path(f["path"]).read_bytes()).hexdigest(),"parsed":bool(json.loads(pathlib.Path(f["path"]).read_text()))} for f in files]}))')},
 ...(policyProbe?[{name:'filesystem-policy',cmd:filesystemCommand}]:[]),
];
function sendResponse(res,body,call,text){
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 const id='resp_s1_'+(++serial),send=(type,v)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...v})+'\n\n');
 send('response.created',{response:{id,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
 let item;
 if(call){item=call;send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});}
 else{item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:text});send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text});send('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part:item.content[0]});}
 send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
}
const server=createServer((req,res)=>{
 if(req.url?.startsWith('/commit?')){const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',async()=>{try{const bytes=Buffer.concat(chunks);result.commits.push({method:req.method,bytes:bytes.length,sha256:sha(bytes),at:new Date().toISOString()});result.disconnected=await app.mainEvaluate(`(()=>{const f=globalThis.__m12S1Fault;const entries=[...f.sockets.entries()];if(entries.length!==1)throw Error('Exactly one own matching write socket required');const [requestId,socket]=entries[0];socket.destroy();return{requestId,destroyed:socket.destroyed}})()`);await persist();setTimeout(()=>{res.setHeader('content-type','application/json');res.end('{"received":true}');},2500);}catch(e){result.fixtureFailure=String(e);res.destroy();}});return;}
 if(req.url==='/delay'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>S1 delay</title><form id="delay-form"><input name="payload" value="S1-once-only"></form>');return;}
 if(req.url==='/large'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>S1 large</title>'+Array.from({length:1800},(_,i)=>'<p>'+i+':'+('大结果x'.repeat(180))+'</p>').join('')+`<script>window.produceLarge=async()=>{for(let i=0;i<650;i++)console.log(i+':'+('日志x'.repeat(300)));for(let i=0;i<100;i+=5)await Promise.all(Array.from({length:5},(_,j)=>fetch('/blob?i='+(i+j)+'&payload='+('x'.repeat(7000)))));return {logs:650,requests:100}}</script>`);return;}
 if(req.url?.startsWith('/blob?')){res.end('ok');return;}
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 let chunks=[];req.on('data',b=>chunks.push(b));req.on('end',async()=>{let body;try{
  body=JSON.parse(Buffer.concat(chunks));const raw=JSON.stringify(body),health=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
  if(!raw.includes(marker)){sendResponse(res,body,null,health??'S1_PRIVATE_OK');return;}
  await writeFile(join(root,'actual-tools.json'),JSON.stringify(body.tools??[],null,2)+'\n');
  for(const item of body.input??[])if(item.type==='function_call_output'&&!seen.has(item.call_id)){
   const issued=result.calls.find(c=>c.callId===item.call_id);if(!issued)continue;seen.add(item.call_id);const text=outputText(item.output);result.outputs.push({phase,step:issued.step,callId:item.call_id,raw:item.output});
   const background=text.match(/(?:Process running with session ID|session_id["':\s]+)(\d+)/i);
   if(background){pending={sessionId:Number(background[1]),step:issued.step};continue;}
   const value=jsonOf(text);data[issued.step]=value;pending=undefined;cursor++;
   if(issued.step==='post-disconnect'){assert(value.requestId&&value.requestId===result.disconnected.requestId);assert.equal(value.error.effectState,'unknown');}
   else if(issued.step==='filesystem-policy'){result.filesystemPolicy=value;assert.equal(value.otherSocketConnected,false);assert.equal(value.writes.find(x=>x.name==='inside').wrote,policyMode!=='read-only');assert.equal(value.writes.find(x=>x.name==='outside').wrote,false);}
   else if(issued.step==='sandbox-read'){result.sandboxRead=value;assert.equal(value.files.length,3);}
   else{assert.equal(value.schema,'willyou-app-result-v2');if(issued.step.startsWith('large-')&&issued.step!=='large-goto')assert(value.data.file,'Expected large artifact');}
  }
  assert(!result.fixtureFailure,result.fixtureFailure);
  const steps=commandSteps(),step=pending?steps.find(s=>s.name===pending.step):steps[cursor];
  if(!step){result[phase+'Complete']=true;await persist();sendResponse(res,body,null,marker+'_'+phase+'_DONE');return;}
  const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(tool=>({...tool,namespace:t.name})):t),name=pending?'write_stdin':'exec_command',declared=tools.find(t=>t.name===name);assert(declared,'Actual native tool missing: '+name);
  const args=pending?{session_id:pending.sessionId,chars:'',yield_time_ms:30000}:{cmd:step.cmd(),yield_time_ms:30000,max_output_tokens:8000};
  const callId='call_s1_'+result.calls.length,call={type:'function_call',id:'fc_'+callId,call_id:callId,name,...(declared.namespace?{namespace:declared.namespace}:{}),arguments:JSON.stringify(args),status:'completed'};
  result.calls.push({phase,step:step.name,callId,arguments:args});await persist();sendResponse(res,body,call);
 }catch(error){result.fixtureFailure=String(error.stack??error);await persist();sendResponse(res,body??{model:'fixture'},null,marker+'_FIXTURE_FAILED');}});
});
server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const site='http://127.0.0.1:'+server.address().port+'/';
await writeFile(join(state,'config.toml'),(policyMode==='named-workspace'?'default_permissions=":workspace"\n':'')+'approval_policy='+JSON.stringify(approval)+'\nmodel="s1-private-model"\nmodel_provider="s1_fixture"\nnotify=[]\n[model_providers.s1_fixture]\nname="S1 Local Fixture"\nbase_url="'+site+'v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.'+JSON.stringify(cwd)+']\ntrust_level="trusted"\n');
const privateEnv={PATH:process.env.PATH,HOME:home,ZDOTDIR:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};
async function click(selector,text){const geometry=()=>app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing');e.scrollIntoView({behavior:'instant',block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);let p=await geometry();await app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.deepEqual(await geometry(),p);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function reload(){const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,20000);await app.evaluate(`document.title='A · M12 S1 · 隔离技术门槛';true`);await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);}
async function launch(){
 await click('[data-testid=home-input]');for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});
 const prompt=marker+' '+phase+': Execute only the local S1 browser checks selected by the private fixture. Never resend a write whose result is unknown. Read the resulting artifacts and query the specified operation. End with '+marker+'_'+phase+'_DONE.';
 await app.cdp('Input.insertText',{text:prompt});assert.equal(await app.evaluate("document.querySelector('[data-testid=home-input]').value"),prompt);await click('[data-testid=home-launch]');
 task=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.find(t=>t.title.includes(marker+' '+phase));});result[phase+'TaskId']=task.id;
 await poll(async()=>{const t=await app.invoke('tasks.get',task.id);if(t.ptyId)await writeFile(join(root,phase+'-terminal.txt'),await app.output(t.ptyId));assert(!result.fixtureFailure,result.fixtureFailure);return result[phase+'Complete'];},150000);
 result[phase+'Session']=(await app.invoke('applications.session',task.id)).value;await app.screenshot(join(root,phase+'-done.png'));
}
try{
 app=await openElectron({executable,userData,cwd,env:{CODEX_HOME:state},inspectMain:true});result.firstPid=app.processId;
 project=await app.invoke('projects.create',{name:'M12 S1 私有门槛',aliases:[],description:'Local synthetic test',rulesPath:null},[{label:'fixture',path:cwd}]);
 const catalog=await poll(async()=>{const c=await app.invoke('applications.catalog');return c.ok&&c.value.find(a=>a.appId==='browser');},30000);assert((await app.invoke('applications.setAdded','browser',true,catalog.revision)).ok);assert((await app.invoke('applications.select',{projectId:project.id,appId:'browser',enabled:true,expectedRevision:0,connections:{}})).ok);
 profile=await app.invoke('aiProfiles.create',{name:'M12 S1 Codex 0.166.0',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args:['--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--ask-for-approval',approval,...(policyMode==='named-workspace'?[]:['--sandbox',policyMode])],color:null,isDefault:true});
 result.profileHealth=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p.check:null;},45000);assert.equal(result.profileHealth.status,'ok');
 stage='first-setup-reload';await reload();
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own instance only');const net=process.getBuiltinModule('net'),original=net.Server.prototype.emit,f={original,sockets:new Map()};globalThis.__m12S1Fault=f;net.Server.prototype.emit=function(event,...args){if(event==='connection'&&typeof this.address()==='string'){const socket=args[0];let buffer='';socket.on('data',bytes=>{buffer+=bytes;if(buffer.length>2097152){buffer='';return;}let at;while((at=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const request=JSON.parse(line);if(request.method==='capabilities/call'&&request.call?.operation==='browser.interact.eval'&&request.call.arguments?.expression?.includes(${JSON.stringify('commit?key='+marker)}))f.sockets.set(request.id,socket);}catch{}}});}return original.call(this,event,...args)};return true})()`);
 stage='first-agent';await persist();await launch();assert.equal(result.commits.length,1);assert(['unknown','succeeded','failed'].includes(data['same-run-get'].data.state));
 result.files=['large-snapshot','large-console','large-network'].map(name=>({name,...data[name].data.file,previewBytes:Buffer.byteLength(data[name].data.truncatedPreview)}));
 for(const f of result.files){const read=result.sandboxRead.files.find(x=>x.path===f.path);assert(read&&read.bytes===f.bytes&&read.sha256===f.sha256&&read.parsed);const bytes=await readFile(f.path);assert.equal(sha(bytes),f.sha256);await cp(f.path,join(root,f.name+'.json'));}
 for(const name of ['small-snapshot','small-console','small-network'])assert(!data[name].data.file);
 await app.mainEvaluate("(()=>{const f=globalThis.__m12S1Fault;process.getBuiltinModule('net').Server.prototype.emit=f.original;delete globalThis.__m12S1Fault;return true})()");result.faultRestored=true;
 stage='restart';await app.invoke('tasks.kill',task.id);await app.close();result.firstAppClosed=true;app=undefined;
 phase='restart';cursor=0;pending=undefined;app=await openElectron({executable,userData,cwd,env:{CODEX_HOME:state},inspectMain:true});result.restartPid=app.processId;await reload();stage='new-run-agent';await launch();assert.equal(data['new-run-get'].data.state,'not-found');
 assert.notEqual(result.firstSession.currentRun.id,result.restartSession.currentRun.id);
 stage='history-ui';await click('[data-testid=nav-apps]');await app.waitFor("!!document.querySelector('.m10-nav')",10000);await click('.m10-nav','调用记录');await app.waitFor("[...document.querySelectorAll('.m10-activity-row')].some(e=>e.innerText.includes('browser.interact.eval'))",10000);
 const records=await app.invoke('applications.activity',{appId:'browser',projectId:project.id,limit:100});result.historyRecords=records;const old=records.value.items.find(i=>i.requestId===result.disconnected.requestId);assert(old,'Original request must survive restart');result.historyOperation=old;
 const labels=await app.evaluate("[...document.querySelectorAll('.m10-activity-row')].filter(e=>e.innerText.includes('browser.interact.eval')).map(e=>e.innerText)");result.historyUiRows=labels;assert(labels.some(text=>text.includes('调用结果未知')||text.includes('调用完成')||text.includes('调用失败')));await app.screenshot(join(root,'history-after-restart.png'));
 result.storedProfileArgs=(await app.invoke('aiProfiles.get',profile.id)).args;assert.deepEqual(result.storedProfileArgs,profile.args);
 await app.invoke('tasks.kill',task.id);result.nativeContexts=await nativeContexts();if(policyProbe){assert(result.nativeContexts.length>=2);assert(result.nativeContexts.every(x=>x.approval===approval&&x.sandbox?.type===(policyMode==='read-only'?'read-only':'workspace-write')));assert.equal(decoyConnections,0);result.decoyConnections=decoyConnections;}
 result.status='passed';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error.stack??error);if(app)try{await writeFile(join(root,'failure-dom.txt'),await app.evaluate('document.body.innerText'));await app.screenshot(join(root,'failure.png'));if(task?.id){result.failureSession=await app.invoke('applications.session',task.id);const current=await app.invoke('tasks.get',task.id);if(current.ptyId)await writeFile(join(root,'failure-terminal.txt'),await app.output(current.ptyId));}}catch{}}
finally{
 if(app){try{await app.mainEvaluate("(()=>{const f=globalThis.__m12S1Fault;if(f){process.getBuiltinModule('net').Server.prototype.emit=f.original;delete globalThis.__m12S1Fault;}return true})()");result.faultRestored=true;}catch{}if(task?.id)try{await app.invoke('tasks.kill',task.id);}catch{}await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.appClosed=true;}
 if(decoy){for(const peer of decoyPeers)peer.destroy();await new Promise(r=>decoy.close(r));await rm(decoyPath,{force:true});result.decoyClosed=true;}
 try{const value=await readFile(outside,'utf8');if(value===marker){await rm(outside);result.unexpectedOutsideCanaryRemoved=true;}}catch{}
 for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,stage,error:result.error,root,calls:result.calls.length}));
}
