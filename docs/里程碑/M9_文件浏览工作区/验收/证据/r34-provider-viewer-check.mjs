// Isolated official MCP PDF viewer probe. No user CLI, model, or project data.
// Prerequisite: fixed @modelcontextprotocol/server-pdf@2.0.3 in argv[2].
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const temp = fs.realpathSync(process.argv[2]);
const repo = process.cwd();
const out = path.join(repo, 'docs/里程碑/M9_文件浏览工作区/验收/证据');
const evidence = (suffix) => path.join(out, `r34-provider-viewer-${suffix}`);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const pkg = path.join(temp, 'node_modules/@modelcontextprotocol/server-pdf');
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'))).version;
if (version !== '2.0.3') throw Error('wrong official viewer version');
const { Client } = await import(pathToFileURL(path.join(temp, 'node_modules/@modelcontextprotocol/client/dist/index.mjs')));
const { StdioClientTransport } = await import(pathToFileURL(path.join(temp, 'node_modules/@modelcontextprotocol/client/dist/stdio.mjs')));
const { chromium } = await import('/private/tmp/m9-qa/node_modules/playwright-core/index.mjs');
fs.mkdirSync(path.join(temp, 'fixture'), { recursive: true });
fs.mkdirSync(path.join(temp, 'empty-home'), { recursive: true });
const pdf = path.join(temp, 'fixture/example.pdf');
execFileSync('python3', ['-c', 'from pypdf import PdfReader,PdfWriter;import sys; r=PdfReader(sys.argv[1]); w=PdfWriter();w.add_page(r.pages[0]);w.add_page(r.pages[0]);w.write(sys.argv[2])', path.join(out,'r34-tex-normal.pdf'), pdf]);
const outside = path.join(temp,'outside-canary.txt');
fs.writeFileSync(outside,'M9-PRIVATE-PROVIDER-CANARY');
const bytes = fs.readFileSync(pdf), originalHash = sha(bytes);
const node = fs.realpathSync(process.execPath);
const readDirs = ['/usr/lib','/System/Library','/System/Volumes/Preboot','/private/var/db/dyld',path.join(temp,'node_modules')];
const ancestorMetadata = new Set();for(const leaf of [node,temp]){for(let p=path.dirname(leaf);p!=='/';p=path.dirname(p))ancestorMetadata.add(p);}
const sb = `(version 1)(deny default)(allow process-exec (literal ${JSON.stringify(node)}))(allow process-info* (target self))(allow sysctl-read)(allow file-read* ${readDirs.map(p=>`(subpath ${JSON.stringify(p)})`).join(' ')} ${['/','/dev/null','/dev/random','/dev/urandom',node,pdf].map(p=>`(literal ${JSON.stringify(p)})`).join(' ')})(allow file-read-metadata (subpath ${JSON.stringify(temp)}) ${[...ancestorMetadata].map(p=>`(literal ${JSON.stringify(p)})`).join(' ')})`;
const profile = path.join(temp,'viewer-readonly.sb');fs.writeFileSync(profile,sb);
const env = { PATH:'/usr/bin:/bin', HOME:path.join(temp,'empty-home'), TMPDIR:path.join(temp,'empty-home'), NODE_NO_WARNINGS:'1' };
const checks=[], calls=[], consoleMessages=[], externalRequests=[];
function check(name,pass,details){checks.push({name,pass:!!pass,details});}
const report={date:new Date().toISOString(),kind:'official-third-party-viewer-in-isolated-test-host',package:'@modelcontextprotocol/server-pdf',version,checks,calls,consoleMessages,externalRequests,fixture:{bytes:bytes.length,sha256:originalHash},isolation:{profile:sb,network:'deny default: no network allow rule',writes:'deny default: no file-write allow rule',modelRequests:'none; host rejects context/message/open/download requests'},officialHtml:null};
let client,transport,browser,host,sandbox;
try {
  const probeCode=`const fs=require('fs');const r={};try{fs.readFileSync(${JSON.stringify(outside)});r.outsideRead='ALLOWED'}catch(e){r.outsideRead=e.code}try{fs.writeFileSync(${JSON.stringify(pdf)},'bad');r.write='ALLOWED'}catch(e){r.write=e.code}require('net').connect({host:'127.0.0.1',port:9}).on('error',e=>{r.network=e.code;console.log(JSON.stringify(r))});`;
  const policyProbe=spawnSync('/usr/bin/sandbox-exec',['-f',profile,node,'-e',probeCode],{cwd:temp,env,encoding:'utf8',timeout:10000});
  report.policyProbe={status:policyProbe.status,stdout:policyProbe.stdout,stderr:policyProbe.stderr};
  const denied=JSON.parse(policyProbe.stdout.trim());
  check('OS sandbox denies fixture overwrite',denied.write==='EPERM'||denied.write==='EACCES',denied.write);
  check('OS sandbox denies outside-canary contents',denied.outsideRead==='EPERM'||denied.outsideRead==='EACCES',denied.outsideRead);
  check('OS sandbox denies even loopback network',denied.network==='EPERM'||denied.network==='EACCES',denied.network);

  transport=new StdioClientTransport({command:'/usr/bin/sandbox-exec',args:['-f',profile,node,path.join(pkg,'dist/index.js'),'--stdio',pdf],env,cwd:pkg,stderr:'pipe',maxBufferSize:32*1024*1024});
  let serverLog='';transport.stderr.on('data',d=>{serverLog+=String(d);fs.writeFileSync(evidence('server.log'),serverLog);});
  client=new Client({name:'WillYou isolated research host',version:'r34'});
  await client.connect(transport);
  report.serverInfo=client.getServerVersion();report.serverCapabilities=client.getServerCapabilities();
  const listed=await client.listTools();
  report.toolNames=listed.tools.map(t=>t.name);
  const tool=listed.tools.find(t=>t.name==='display_pdf');
  const uri=tool?._meta?.ui?.resourceUri;
  check('real MCP discovers display tool and UI resource linkage',typeof uri==='string',uri);
  const resource=await client.readResource({uri});
  const content=resource.contents[0], html=content.text;
  if (typeof html!=='string'||content.mimeType!=='text/html;profile=mcp-app') throw Error('official HTML resource missing');
  report.officialHtml={uri,mimeType:content.mimeType,bytes:Buffer.byteLength(html),sha256:sha(html),declaredCsp:content._meta?.ui?.csp};
  check('official MCP resource equals published HTML bytes',sha(html)===sha(fs.readFileSync(path.join(pkg,'dist/mcp-app.html'))),report.officialHtml);
  const input={url:pdf};
  const result=await client.callTool({name:'display_pdf',arguments:input});
  if(result.isError)throw Error(JSON.stringify(result));
  // Test host is read-only even if the upstream example advertises OS W_OK.
  result._meta={...result._meta,writable:false,interactEnabled:false};
  report.hostMetadataOverrides={writable:false,interactEnabled:false,reason:'read-only fixture host; no command polling or writes'};
  const chunk=await client.callTool({name:'read_pdf_bytes',arguments:{url:pdf,offset:0,byteCount:bytes.length}});
  check('real provider returns exact local PDF bytes',sha(Buffer.from(chunk.structuredContent.bytes,'base64'))===originalHash);
  const bad=await client.callTool({name:'read_pdf_bytes',arguments:{url:outside,offset:0,byteCount:128}});
  check('real provider rejects non-fixture file',bad.isError===true,bad.content?.[0]?.text);

  const browserSource=`import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
const boot=await(await fetch('/bootstrap')).json();const frame=document.querySelector('iframe');
window.probe={initialized:false,denied:[],calls:[]};
const bridge=new AppBridge(null,{name:'Isolated read-only fixture host',version:'r34'},{serverTools:{}},{hostContext:{theme:'light',platform:'web',displayMode:'inline',availableDisplayModes:['inline'],containerDimensions:{width:1100,maxHeight:900}}});
bridge.oncalltool=async params=>{window.probe.calls.push(params.name);const r=await fetch('/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});if(!r.ok)throw Error(await r.text());return await r.json();};
for(const key of ['onmessage','onopenlink','ondownloadfile','onupdatemodelcontext'])bridge[key]=async()=>{window.probe.denied.push(key);throw Error('not allowed in isolated viewer research');};
bridge.onloggingmessage=p=>console.log('APP',p);bridge.onsizechange=()=>{};
const ready=new Promise(resolve=>{const f=e=>{if(e.source===frame.contentWindow&&e.data?.method==='ui/notifications/sandbox-proxy-ready'){removeEventListener('message',f);resolve()}};addEventListener('message',f)});
frame.src=boot.sandboxUrl;await ready;
const initialized=new Promise(resolve=>bridge.oninitialized=()=>{window.probe.initialized=true;resolve()});
await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
await bridge.sendSandboxResourceReady({html:boot.html,csp:{connectDomains:[],resourceDomains:[]},permissions:{}});await initialized;await bridge.sendToolInput({arguments:boot.input});await bridge.sendToolResult(boot.result);window.probe.ready=true;
window.setProbeTheme=theme=>bridge.sendHostContextChange({theme});
window.disposeProbe=async()=>{try{await bridge.teardownResource({},{timeout:3000});window.probe.teardownAck=true}catch(e){window.probe.teardownError=String(e)}await bridge.close();frame.remove();window.probe.disposed=true;};`;
  fs.writeFileSync(path.join(temp,'host-entry.mjs'),browserSource);
  const esbuild=path.join(repo,'node_modules/.bin/esbuild');
  for(const [entry,dest] of [['host-entry.mjs','host.js'],['reference/examples/basic-host/src/sandbox.ts','sandbox.js']])execFileSync(esbuild,[path.join(temp,entry),'--bundle','--platform=browser','--format=esm',`--outfile=${path.join(temp,dest)}`],{stdio:'pipe'});
  const csp="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' blob: data:; worker-src blob: data:; frame-src 'self' blob:; base-uri 'none'; form-action 'none'";
  report.hostCsp=csp;
  sandbox=http.createServer((req,res)=>{res.setHeader('Content-Security-Policy',csp);res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), clipboard-write=()');if(req.url==='/sandbox.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(temp,'sandbox.js')))}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><style>html,body{margin:0;width:100%;height:100%}</style><script type="module" src="/sandbox.js"></script>')}});
  await new Promise(r=>sandbox.listen(0,'127.0.0.1',r));const sandboxUrl=`http://127.0.0.1:${sandbox.address().port}/sandbox.html`;
  host=http.createServer(async(req,res)=>{
    try{
      if(req.url==='/bootstrap'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({html,input,result,sandboxUrl}));}
      if(req.url==='/host.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(temp,'host.js')));}
      if(req.url==='/call'&&req.method==='POST'){
        let raw='';for await(const part of req){raw+=part;if(raw.length>8192)throw Error('request too large');}
        const p=JSON.parse(raw);calls.push({name:p.name,arguments:p.arguments});
        if(p.name!=='read_pdf_bytes'||p.arguments?.url!==pdf){res.statusCode=403;return res.end('only exact fixture read_pdf_bytes allowed');}
        const r=await client.callTool(p);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(r));
      }
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Official MCP PDF viewer — isolated synthetic probe</title><style>body{margin:0;font:14px system-ui;background:#eee}header{padding:12px}iframe{width:calc(100% - 24px);height:850px;margin:0 12px;border:1px solid #aaa}</style><header>Official server-pdf 2.0.3 · synthetic PDF · read only · no external network</header><iframe sandbox="allow-scripts allow-same-origin" referrerpolicy="origin"></iframe><script type="module" src="/host.js"></script>');
    }catch(error){res.statusCode=500;res.end(String(error));}
  });
  await new Promise(r=>host.listen(0,'127.0.0.1',r));const hostUrl=`http://127.0.0.1:${host.address().port}`;
  report.loopbackOrigins=[hostUrl,new URL(sandboxUrl).origin];
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
  report.browserVersion=browser.version();
  const page=await browser.newPage({viewport:{width:1280,height:960}});
  const externalResponses=[];report.externalResponses=externalResponses;
  page.on('response',response=>{const u=response.url();if(!u.startsWith(hostUrl+'/')&&!u.startsWith(new URL(sandboxUrl).origin+'/')&&!/^(data|blob):/.test(u))externalResponses.push(u);});
  page.on('console',m=>consoleMessages.push({type:m.type(),text:m.text().slice(0,800)}));page.on('pageerror',e=>consoleMessages.push({type:'pageerror',text:String(e)}));
  await page.route('**/*',route=>{const u=route.request().url();if(u.startsWith(hostUrl+'/')||u.startsWith(new URL(sandboxUrl).origin+'/')||/^(data|blob):/.test(u))return route.continue();externalRequests.push(u);return route.abort('blockedbyclient');});
  await page.goto(hostUrl);
  await page.waitForFunction(()=>window.probe?.ready,{timeout:20000});
  check('official UI initialize handshake completes',true);
  const view=await (async()=>{for(let n=0;n<100;n++){const f=page.frames().find(f=>f!==page.mainFrame()&&f.url()==='about:blank'&&f.parentFrame());if(f&&await f.locator('canvas').count())return f;await new Promise(r=>setTimeout(r,100));}throw Error('official viewer canvas not found');})();
  await view.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>c.width>100&&c.height>100),{timeout:20000});
  await view.waitForFunction(()=>document.body.innerText.includes('Hello WillYou'),{timeout:20000});
  const visual=await view.evaluate(()=>({text:document.body.innerText.slice(0,2500),canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,nonWhite:c.width>0&&c.height>0&&[...c.getContext('2d').getImageData(0,0,c.width,c.height).data].some((v,i)=>i%4!==3&&v<230)})),buttons:[...document.querySelectorAll('button')].map(b=>({title:b.title,aria:b.getAttribute('aria-label'),text:b.textContent?.trim(),disabled:b.disabled})),inputs:[...document.querySelectorAll('input')].map(e=>({type:e.type,value:e.value,aria:e.getAttribute('aria-label')}))}));
  report.visual=visual;check('official PDF.js paints nonblank PDF canvas',visual.canvases.some(c=>c.nonWhite));check('official viewer exposes real synthetic PDF text',visual.text.includes('Hello WillYou'));
  check('browser reads file through actual provider tool',calls.some(c=>c.name==='read_pdf_bytes'));
  await page.screenshot({path:evidence('light.png')});
  await page.evaluate(()=>window.setProbeTheme('dark'));await page.waitForTimeout(250);await page.screenshot({path:evidence('dark.png')});
  report.browserProbe=await page.evaluate(()=>window.probe);
  check('cross-origin sandbox denies host DOM access',await view.evaluate(()=>{try{return !window.top.document}catch(e){return e.name==='SecurityError'}}));
  const forbidden=await page.evaluate(async()=>{const r=await fetch('/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'save_pdf',arguments:{url:'ignored',data:'aA=='}})});return {status:r.status,text:await r.text()}});
  check('read-only host denies save tool dispatch',forbidden.status===403,forbidden);
  check('fixture remains byte-identical',sha(fs.readFileSync(pdf))===originalHash);
  check('no external network response received',externalResponses.length===0,{responses:externalResponses,routeBlockedAttempts:externalRequests});
  await page.evaluate(()=>window.disposeProbe());const afterDispose=calls.length;await page.waitForTimeout(400);
  report.browserProbe=await page.evaluate(()=>window.probe);
  check('viewer teardown acknowledged and iframe removed',report.browserProbe.teardownAck===true&&await page.locator('iframe').count()===0,report.browserProbe);
  check('no further provider call after teardown during 400ms observation',calls.length===afterDispose);
  report.completed=true;
}catch(error){report.error=String(error?.stack||error);check('probe completes',false,String(error));}
finally{
  if(browser)await browser.close();
  await new Promise(r=>host?host.close(r):r());await new Promise(r=>sandbox?sandbox.close(r):r());
  const childPid=transport?.pid;
  if(client)await client.close();else if(transport)await transport.close();
  if(report.completed){let exited=false;try{process.kill(childPid,0)}catch(e){exited=e.code==='ESRCH'}check('own MCP child exits and host listeners close',exited&&!host.listening&&!sandbox.listening,{childPid,exited,hostListening:host.listening,sandboxListening:sandbox.listening});}
  report.summary={passed:checks.filter(c=>c.pass).length,total:checks.length};
  fs.writeFileSync(evidence('report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({summary:report.summary,error:report.error,report:evidence('report.json')}));
  if(report.summary.passed!==report.summary.total)process.exitCode=1;
}
