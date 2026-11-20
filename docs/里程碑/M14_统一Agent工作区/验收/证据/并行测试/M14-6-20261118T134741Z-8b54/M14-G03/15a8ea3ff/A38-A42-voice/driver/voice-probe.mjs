// A51: launch the isolated packaged App through LaunchServices (the Finder/Dock path, `open -g -n -a`), without any
// terminal environment, and verify native CLI discovery through the login shell, the native build, and the proxy path.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { join, dirname } from 'node:path';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const [out,commit,asar]=process.argv.slice(2);
assert.match(out??'',/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-[0-9]+$/);
const appBundle=join(base,'package/mac-arm64/WillYou.app'),exe=join(appBundle,'Contents/MacOS/WillYou');
assert.equal(readFileSync(join(base,'source-commit.txt'),'utf8').trim(),commit);
assert.equal(createHash('sha256').update(readFileSync(join(appBundle,'Contents/Resources/app.asar'))).digest('hex'),asar);
mkdirSync(out,{mode:0o700});
const root=realpathSync(mkdtempSync(join(out,'runtime-'))),home=join(root,'home'),userData=join(root,'data'),cwd=join(root,'work');
for(const d of [home,userData,cwd])mkdirSync(d,{mode:0o700});
const sec=(...a)=>execFileSync('/usr/bin/security',a,{env:{PATH:'/usr/bin:/bin',HOME:home},encoding:'utf8',timeout:10000}).trim();
const kc=join(home,'Library','Keychains','login.keychain-db');mkdirSync(dirname(kc),{recursive:true,mode:0o700});
sec('create-keychain','-p','m14-isolated-test-only',kc);sec('set-keychain-settings',kc);sec('list-keychains','-d','user','-s',kc);sec('default-keychain','-d','user','-s',kc);
const result={commit,asar,scope:'voice probe: Typeless installed, shortcut resolved from a minimal settings file, accessibility of the test package',checks:[],status:'failed'};
const check=(label,ok,detail)=>{result.checks.push({label,ok:!!ok,...(ok?{}:{detail})});assert(ok,label);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// synthetic model + a logging forward proxy; the login shell exports the proxy, the App gets nothing from a terminal.
const port=3425,proxyPort=3426,cdpPort=9351;
const proxied=[];
const model=createServer(async(req,res)=>{const parts=[];for await(const p of req)parts.push(p);let body={};try{body=JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{}
  if(req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'a51-main'}]}));return;}
  if(body.tools?.length){await sleep(4000);}
  res.writeHead(200,{'content-type':'text/event-stream'});const ev=(t,v)=>res.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...v})}\n\n`);
  ev('message_start',{message:{id:'m'+randomUUID(),type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
  ev('content_block_start',{index:0,content_block:{type:'text',text:''}});ev('content_block_delta',{index:0,delta:{type:'text_delta',text:body.tools?.length?'A51_OK':'A51 标题'}});
  ev('content_block_stop',{index:0});ev('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});ev('message_stop',{});res.end();});
const proxy=createServer((req,res)=>{proxied.push({method:req.method,url:req.url});const u=new URL(req.url);const up=httpRequest({host:u.hostname,port:u.port,path:u.pathname+u.search,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});req.pipe(up);up.on('error',()=>{res.writeHead(502);res.end();});});
proxy.on('connect',(req,sock,head)=>{proxied.push({method:'CONNECT',url:req.url});const [h,p]=req.url.split(':');const up=netConnect(Number(p),h,()=>{sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');up.write(head);up.pipe(sock);sock.pipe(up);});up.on('error',()=>sock.destroy());});
await new Promise(r=>model.listen(port,'127.0.0.1',r));await new Promise(r=>proxy.listen(proxyPort,'127.0.0.1',r));
const rc=`export PATH="/Users/${execFileSync('/usr/bin/id',['-un'],{encoding:'utf8'}).trim()}/.local/bin:/opt/homebrew/bin:$PATH"\nexport HTTP_PROXY=http://127.0.0.1:${proxyPort}\nexport HTTPS_PROXY=http://127.0.0.1:${proxyPort}\nexport ENABLE_TOOL_SEARCH=false\n`;
for(const f of ['.zprofile','.zshrc'])writeFileSync(join(home,f),rc,{mode:0o600});
{const real=JSON.parse(readFileSync(join('/Users',execFileSync('/usr/bin/id',['-un'],{encoding:'utf8'}).trim(),'Library/Application Support/Typeless/app-settings.json'),'utf8'));
 const only={keyboardShortcut:{handlesFreeMode:real.keyboardShortcut?.handlesFreeMode,pushToTalk:real.keyboardShortcut?.pushToTalk}};
 mkdirSync(join(home,'Library/Application Support/Typeless'),{recursive:true,mode:0o700});writeFileSync(join(home,'Library/Application Support/Typeless/app-settings.json'),JSON.stringify(only),{mode:0o600});
 result.typelessShortcutsCopied=Object.keys(only.keyboardShortcut).filter(k=>only.keyboardShortcut[k]);}
let pid=null,ws=null;
try{
  execFileSync('/usr/bin/open',['-g','-n','-a',appBundle,'--env','HOME='+home,'--env','SMARTDD_USER_DATA='+userData,'--env','CODEX_HOME='+join(home,'.codex'),'--env','CLAUDE_CONFIG_DIR='+join(home,'.claude'),'--args','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+cdpPort],{timeout:20000,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'}});
  // 557: open(1) forwards the caller's PATH; a Finder/Dock launch gets launchd's default PATH, so call open with exactly that.
  for(let i=0;i<80&&!pid;i++){await sleep(250);try{pid=Number(execFileSync('/usr/bin/pgrep',['-f','--',`remote-debugging-port=${cdpPort}`],{encoding:'utf8'}).trim().split('\n')[0])||null;}catch{}}
  assert(pid,'launched App process');
  const procCmd=execFileSync('/bin/ps',['-o','command=','-p',String(pid)],{encoding:'utf8'}).trim();
  const procEnv=execFileSync('/bin/ps',['eww','-o','command=','-p',String(pid)],{encoding:'utf8'});
  const pathVar=(procEnv.match(/\bPATH=(\S+)/)??[])[1]??null;
  result.process={pid,command:procCmd.slice(0,200),ppid:execFileSync('/bin/ps',['-o','ppid=','-p',String(pid)],{encoding:'utf8'}).trim(),PATH:pathVar,hasUserData:procEnv.includes('SMARTDD_USER_DATA='+userData)};
  check('the App was started by LaunchServices (parent launchd) with the test package and the isolated data directory',result.process.ppid==='1'&&procCmd.startsWith(exe)&&result.process.hasUserData,result.process);
  check('it inherited no terminal PATH (no ~/.local/bin, no proxy)',!!pathVar&&!pathVar.includes('.local/bin')&&!/HTTPS?_PROXY=/.test(procEnv),{PATH:pathVar});
  let targets=[];for(let i=0;i<80;i++){try{targets=await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(250);}
  const page=targets.find(t=>t.type==='page'&&!t.url.startsWith('devtools'));assert(page,'page target');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
  const cdp=(method,params={})=>new Promise(r=>{const id=++seq;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expr=>{const r=await cdp('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails).slice(0,400));return r.result?.result?.value;};
  for(let i=0;i<80;i++){if(await evaluate('Boolean(window.electronAPI)').catch(()=>false))break;await sleep(250);}
  result.voice=await evaluate(`window.electronAPI.invoke('voice.inspect')`);
  result.status='passed';
}catch(e){result.error=String(e.stack??e).slice(0,1500);}
finally{
  try{ws?.close();}catch{}
  if(pid){try{process.kill(pid,'SIGTERM');}catch{}for(let i=0;i<60;i++){try{process.kill(pid,0);await sleep(250);}catch{result.exited=true;break;}}if(!result.exited){try{process.kill(pid,'SIGKILL');result.forced=true;}catch{}}}
  for(const p of execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n')){const m=p.trim().match(/^(\d+)\s+(.*)$/);if(m&&m[2].includes(root)){try{process.kill(Number(m[1]),'SIGTERM');(result.cleaned??=[]).push(Number(m[1]));}catch{}}}
  model.close();proxy.close();
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));
}
if(result.status!=='passed')process.exitCode=1;
