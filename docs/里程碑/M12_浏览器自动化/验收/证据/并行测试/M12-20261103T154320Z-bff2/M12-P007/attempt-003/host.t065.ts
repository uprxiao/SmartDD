
// T065 observation-only wrapper in private I fixture; each original is called unchanged.
import {BrowserHelper as T065Helper} from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/browser/agent-browser';
import {BrowserCdpProxy as T065Proxy} from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/browser/cdp-proxy';
import t065ChildProcess from 'node:child_process';
import {createHash as t065CreateHash} from 'node:crypto';
const t065Trace={helperCalls:[] as {at:number;session:string;args:string[]}[],proxyEvents:[] as unknown[],rawHelpers:[] as unknown[],restored:false};
const t065OriginalCommand=T065Helper.prototype.command,t065OriginalStart=T065Proxy.prototype.start;

const t065OriginalExecFile=t065ChildProcess.execFile;
Reflect.set(t065ChildProcess,'execFile',function(...args:any[]){
  const file=args[0],argv=args[1];
  if(file===process.env.M12_RESOURCE_ROOT+'/agent-browser/'+process.arch+'/agent-browser'&&Array.isArray(argv)&&argv.includes('batch')&&argv.includes('--json')&&typeof args.at(-1)==='function'){
    const originalCallback=args.at(-1),at=performance.now(),si=argv.indexOf('--session'),ci=argv.indexOf('--cdp'),session=si>=0?String(argv[si+1]):'',endpoint=ci>=0?String(argv[ci+1]):'';
    const redact=(v:unknown)=>{const text=String(v??'');if(!endpoint)return text;const result=text.split(endpoint).join('<page-cdp>');try{const token=new URL(endpoint).pathname.slice(1);return token?result.split(token).join('<page-cdp-token>'):result}catch{return result}};
    args[args.length-1]=function(this:unknown,error:any,stdout:any,stderr:any){
      const command=t065Trace.helperCalls.filter(call=>call.session===session).at(-1)?.args;
      t065Trace.rawHelpers.push({at,finishedAt:performance.now(),session,command,argv:argv.map((v,i)=>i===ci+1?'<page-cdp>':String(v)),stdout:redact(stdout),stderr:redact(stderr),stdoutSha256:t065CreateHash('sha256').update(Buffer.isBuffer(stdout)?stdout:Buffer.from(String(stdout??''))).digest('hex'),error:error?{code:error.code??null,signal:error.signal??null,killed:error.killed??false}:null,redactions:endpoint?['private page CDP capability URL']:[]});
      return originalCallback.call(this,error,stdout,stderr);
    };
  }
  return Reflect.apply(t065OriginalExecFile,t065ChildProcess,args);
});

const t065Instances=new Map<T065Proxy,(event:Record<string,unknown>)=>void>();
T065Helper.prototype.command=function(args,options){t065Trace.helperCalls.push({at:performance.now(),session:this.options.session,args:[...args]});return t065OriginalCommand.call(this,args,options)};
T065Proxy.prototype.start=function(){if(!t065Instances.has(this)){const original=Reflect.get(this,'trace') as (event:Record<string,unknown>)=>void;t065Instances.set(this,original);Reflect.set(this,'trace',(event:Record<string,unknown>)=>{t065Trace.proxyEvents.push({at:performance.now(),webContentsId:this.contents.id,...event});original(event)})}return t065OriginalStart.call(this)};
function t065Restore(){Reflect.set(t065ChildProcess,'execFile',t065OriginalExecFile);T065Helper.prototype.command=t065OriginalCommand;T065Proxy.prototype.start=t065OriginalStart;for(const [proxy,original]of t065Instances)Reflect.set(proxy,'trace',original);t065Trace.restored=true;return{restored:t065Trace.restored,helperPrototypeRestored:T065Helper.prototype.command===t065OriginalCommand,proxyPrototypeRestored:T065Proxy.prototype.start===t065OriginalStart,execFileRestored:t065ChildProcess.execFile===t065OriginalExecFile,instanceCount:t065Instances.size}}
// I-level composition. Real service/module/CLI/gateway/SQLite/kernel peers; controlled run root and synthetic website.
import { app, BrowserWindow } from 'electron';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { CapabilitySessionSnapshot } from '/private/tmp/willyou-m12-p007-baseline-001/src/shared/application-session';
import { capabilitySessionSnapshotV3Schema } from '/private/tmp/willyou-m12-p007-baseline-001/src/shared/application-session-v3';
import { applicationNativeSkillName } from '/private/tmp/willyou-m12-p007-baseline-001/src/shared/application-session';
import { applicationToolDeclarations } from '/private/tmp/willyou-m12-p007-baseline-001/src/shared/application-capabilities';
import * as schema from '/private/tmp/willyou-m12-p007-baseline-001/src/main/db/schema';
import { SecretsStore } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/secrets';
import { ProjectService } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/projects/project-service';
import { agentFixture } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/__tests__/agent-fixture';
import { BrowserService } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/browser/service';
import type { BrowserPage } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/browser/page-registry';
import { CapabilityBundleSource } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/bundle-source';
import { BuiltinPackageRegistry } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/builtin-package-registry';
import { RuntimeRegistry } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/runtime-registry';
import { ApplicationService } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/application-service';
import { ApplicationToolService } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/tool-service';
import { ApplicationAdapterRegistry } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/application-adapter-registry';
import { CapabilityRunRegistry } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/run-registry';
import { createApplicationRunPlan } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/run-plan';
import { applicationSkillContentHash } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/session-registry';
import { MacProcessIdentityReader } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/process-identity';
import { MacUnixPeerIdentityReader } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/unix-peer-identity';
import { ApplicationCliGateway } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/cli-gateway';
import { digest } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/applications/manifest';
import { ApplicationError } from '/private/tmp/willyou-m12-p007-baseline-001/src/shared/applications';
import { FileWorkspacePersistence } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/files/workspace-persistence';
import { BrowserWorkspace } from '/private/tmp/willyou-m12-p007-baseline-001/src/main/core/browser/workspace';
import {popupFixtureHtml} from '/private/tmp/willyou-m12-p007-baseline-001/scripts/browser/popup-fixtures.mjs';
import {s3FixtureHtml} from '/private/tmp/willyou-m12-p007-baseline-001/scripts/browser/s3-fixtures.mjs';

for (const event of ['uncaughtException','unhandledRejection'] as const) process.on(event,error => {
  process.send?.({ fatal:String(error instanceof Error ? error.stack : error) }); app.exit(1);
});
let browser: BrowserService, applications: ApplicationService, gateway: ApplicationCliGateway;
let fixture: Awaited<ReturnType<typeof agentFixture>>, run: Awaited<ReturnType<CapabilityRunRegistry['reserve']>>;
let host: BrowserWindow, taskId: string, environment: NodeJS.ProcessEnv, binary: string;
let secondary: {taskId:string;pageId:string}|undefined;
const guardResponses=new Map<string,unknown>(),observedContents=new Set<number>();
interface SnapshotRace { mode:string;pageId:string;iterations:{before:number;helper:number;after:number}[];captures:number[][];restored:boolean }
const snapshotRaces:SnapshotRace[]=[],raceRestores=new Map<string,()=>void>();
const contextEvents:unknown[]=[];
const nestedMutations:{kind:string;point:string;mode:string;before:unknown;objectId:string;sessionId?:string}[]=[];
const inputFaults:{mode:string;commands:{points:number;bytes:number;sha256:string}[];events:unknown[];restored:boolean}[]=[];
let clearInputFault:(()=>void)|undefined;
const proxyForwarded=new Map<string,{method:string;sessionId?:string}[]>();
let errorHits=0,errorClose:Promise<void>|undefined,errorNavigation:Promise<void>|undefined;
const errorEvents:unknown[]=[];
const popupDestroyedEvents:{pageId:string;at:number}[]=[];
const retiredHelperCleanups:{pageId:string;cleanup:unknown}[]=[];
type CliResult={code:number|null;signal:NodeJS.Signals|null;stdout:string;stderr:string;timedOut:boolean};
const cliJobs=new Map<number,{child:ReturnType<typeof spawn>;done:Promise<CliResult>}>();
const commits:{key:string;bytes:number;sha256:string;at:string}[]=[];
function launchCli(args:string[],input?:string|Buffer){
  const child=spawn(binary,args,{env:environment,stdio:[input===undefined?'ignore':'pipe','pipe','pipe']});children.add(child);
  if(input!==undefined)child.stdin!.end(input);
  let stdout='',stderr='',timedOut=false;
  const done=new Promise<CliResult>(resolve=>{
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},105000);
    child.stdout!.on('data',chunk=>stdout+=chunk);child.stderr!.on('data',chunk=>stderr+=chunk);
    child.on('close',(code,signal)=>{clearTimeout(timer);children.delete(child);resolve({code,signal,stdout,stderr,timedOut});});
  });
  if(!child.pid)throw Error('Private native CLI did not launch');
  cliJobs.set(child.pid,{child,done});return {pid:child.pid,done};
}
async function actionBackend(page:BrowserPage):Promise<number>{
  const doc=await page.proxy.send<{root:{nodeId:number}}>('DOM.getDocument');
  const selected=await page.proxy.send<{nodeId:number}>('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#action'});
  return (await page.proxy.send<{node:{backendNodeId:number}}>('DOM.describeNode',{nodeId:selected.nodeId})).node.backendNodeId;
}
const children = new Set<ReturnType<typeof spawn>>();
const timingEvents:{label:string|null;phase:string|null;at:number}[]=[];
const respond = (request:IncomingMessage,response:ServerResponse) => {
  const url=new URL(request.url??'/','http://127.0.0.1');
  if(url.pathname.startsWith('/s3-')){response.setHeader('content-type','text/html; charset=utf-8');response.end(s3FixtureHtml);return;}
  if(url.pathname==='/s2-file-script'){response.setHeader('content-type','text/html');response.end('<title>S2 blocked file script</title><script>location.href="file:///etc/hosts"</script>');return;}
  if(url.pathname==='/s2-file-redirect'){response.writeHead(302,{location:'file:///etc/hosts'});response.end();return;}
  if(['/s2-popups','/s2-oauth','/s2-child'].includes(url.pathname)){
    const address=server.address();if(!address||typeof address==='string')throw Error('Popup fixture server not ready');
    const openerOrigin='http://127.0.0.1:'+address.port,authorizationOrigin=url.searchParams.get('cross')==='true'?'http://localhost:'+address.port:openerOrigin;
    response.setHeader('content-type','text/html');response.end(popupFixtureHtml(url.pathname,{openerOrigin,authorizationOrigin}));return;
  }
  if(url.pathname==='/commit'){
    const chunks:Buffer[]=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{
      const body=Buffer.concat(chunks);commits.push({key:url.searchParams.get('key')??'',bytes:body.length,sha256:digest(body),at:new Date().toISOString()});
      setTimeout(()=>{response.setHeader('content-type','application/json');response.end(JSON.stringify({received:true,count:commits.length}));},2000);
    });return;
  }
  if(url.pathname==='/large'){
    response.setHeader('content-type','text/html; charset=utf-8');
    response.end('<!doctype html><title>S1 large fixture</title>'+Array.from({length:1800},(_,i)=>'<p>'+i+':'+('大结果x'.repeat(180))+'</p>').join('')+`<script>window.produceLarge=async()=>{for(let i=0;i<650;i++)console.log(i+':'+('日志x'.repeat(300)));for(let i=0;i<100;i+=5)await Promise.all(Array.from({length:5},(_,j)=>fetch('/blob?i='+(i+j)+'&payload='+('x'.repeat(7000)))));return {logs:650,requests:100}}</script>`);return;
  }
  if(url.pathname==='/blob'){response.end('ok');return;}
  if(url.pathname==='/error-hit'){errorHits++;response.setHeader('content-type','application/json');response.end('{"received":true}');return;}
  if(url.pathname==='/connection-reset'){request.socket.destroy();return;}
  if(url.pathname==='/event'){
    timingEvents.push({label:url.searchParams.get('label'),phase:url.searchParams.get('phase'),at:performance.now()});
    response.setHeader('content-type','application/json');response.end('{"received":true}');return;
  }
  response.setHeader('content-type','text/html;charset=utf-8');
  const address=server.address();if(!address||typeof address==='string')throw Error('Fixture HTTP address missing');
  const parentOrigin='http://127.0.0.1:'+address.port,frameOrigin='http://localhost:'+address.port;
  if(url.pathname==='/input'){
    const max=url.searchParams.get('max'),limit=max==='3000'?' maxlength="3000"':'';
    response.end('<title>[I] S1 bounded input</title><input id="field" aria-label="Input"'+limit+'><script>window.hits=[];window.inputCount=0;window.latestInputValue="";document.addEventListener("input",e=>{if(e.target.id==="field"){window.inputCount++;window.latestInputValue=e.target.value;}},true);</script>');return;
  }
  if(url.pathname==='/frame'){
    const script=`const state={value:'',hits:0};const report=()=>parent.postMessage({kind:'frame-state',...state},${JSON.stringify(parentOrigin)});document.addEventListener('input',e=>{if(e.target.id==='frame-field'){state.value=e.target.value;document.getElementById('echo').textContent=JSON.stringify(state);report();}},true);document.addEventListener('click',e=>{if(e.target.id==='frame-action'){state.hits++;document.getElementById('echo').textContent=JSON.stringify(state);report();}},true);report();`;
    new Function(script);
    response.end('<title>[I] cross-site child</title><button id="frame-action">Frame action</button><input id="frame-field" aria-label="Frame input"><p id="echo"></p><script>'+script+'</script>');return;
  }
  let html='<title>[I] S1 real native CLI</title><form><button type="button" id="action" data-instance="initial">Action</button><input id="field" aria-label="Input"><div contenteditable role="textbox" aria-label="Editor"></div><select aria-label="Choice"><option>A</option><option>B</option></select><input type="checkbox" aria-label="Check"><input type="file" aria-label="Upload"></form><div style="height:3000px">Long page</div><script>window.hits=[];window.hitInstances=[];window.inputEvents=[];window.addEventListener("input",e=>inputEvents.push({id:e.target.id,value:e.target.value}),true);window.addEventListener("click",e=>{hits.push(e.target.id);hitInstances.push(e.target.dataset.instance??e.target.id)},true);window.delayedStep=async function(label){await fetch("/event?phase=start&label="+encodeURIComponent(label));await new Promise(resolve=>setTimeout(resolve,2000));await fetch("/event?phase=end&label="+encodeURIComponent(label));return label;}</script>';
  if(url.pathname==='/errors')html+='<script>window.addEventListener("click",e=>{if(e.target.id==="action")fetch("/error-hit",{method:"POST"})},true);</script>';
  if(url.pathname==='/delay')html+='<form id="delay-form"><input name="payload" value="S1-once-only"></form>';
  if(url.pathname==='/nested'){
    const before=`window.frameState={value:'',hits:0};window.addEventListener('message',e=>{if(e.origin===${JSON.stringify(frameOrigin)}&&e.data?.kind==='frame-state'){window.frameState={...e.data,origin:e.origin};document.getElementById('frame-echo').textContent=JSON.stringify(window.frameState);}});`;
    const shadow=`(()=>{const host=document.getElementById('closed-host'),root=host.attachShadow({mode:'closed'});root.innerHTML='<button id="shadow-action">Shadow action</button><input id="shadow-field" aria-label="Shadow input"><p id="shadow-echo"></p>';window.shadowState={value:'',hits:0};const report=()=>{root.getElementById('shadow-echo').textContent=JSON.stringify(window.shadowState);document.getElementById('outer-shadow-echo').textContent=JSON.stringify(window.shadowState);};root.addEventListener('input',e=>{if(e.target.id==='shadow-field'){window.shadowState.value=e.target.value;report();}},true);root.addEventListener('click',e=>{if(e.target.id==='shadow-action'){window.shadowState.hits++;report();}},true);report();})();`;
    new Function(before);new Function(shadow);
    const nested='<script>'+before+'</script><iframe id="embedded" width="640" height="160" src="'+frameOrigin+'/frame"></iframe><p id="frame-echo"></p><div id="closed-host" style="display:block;min-height:70px;width:640px;border:1px solid"></div><p id="outer-shadow-echo"></p><script>'+shadow+'</script>';
    html=html.replace('<div style="height:3000px">',nested+'<div style="height:3000px">');
  }
  response.end(html);
};
const server=createServer(respond),ipv6Server=createServer(respond);
app.whenReady().then(async () => {
  const resources = process.env.M12_RESOURCE_ROOT!;
  const source = new CapabilityBundleSource(join(resources,'capability-bundles'));
  fixture = await agentFixture();
  const processes = new MacProcessIdentityReader(join(resources,'native/willyou-process-identity'));
  const helperSource = JSON.parse(readFileSync(join(resources,'agent-browser/SOURCE.json'),'utf8'));
  const helperFile = helperSource.files.find((file:{arch:string}) => file.arch === process.arch);
  host = new BrowserWindow({show:false,focusable:false,skipTaskbar:true,width:1000,height:700,title:'[I] S1 isolated native CLI host',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await host.loadURL('data:text/html,<title>[I] S1 controlled run host</title>'); host.showInactive();
  browser = new BrowserService({userData:app.getPath('userData'),sqlite:fixture.sqlite,helper:{executable:join(resources,'agent-browser',process.arch,'agent-browser'),sha256:helperFile.sha256,processes},window:()=>host,taskProject:id => {
    const row = fixture.sqlite.prepare('SELECT project_id FROM tasks WHERE id=?').get(id) as {project_id:string}|undefined;
    return row?.project_id ?? null;
  }});
  browser.pages.observe(event=>{if(event.type==='created')event.page.contents.on('destroyed',()=>popupDestroyedEvents.push({pageId:event.page.id,at:Date.now()}));else retiredHelperCleanups.push({pageId:event.page.id,cleanup:event.page.helper.cleanup??{daemonState:'absent',clientStopped:true,socketFilesRemoved:true}});});
  const createPage=browser.pages.create.bind(browser.pages);
  browser.pages.create=async(task,project,savedId)=>{
    const page=await createPage(task,project,savedId);
    page.proxy.onEvent(event=>{if(['Runtime.executionContextCreated','Runtime.executionContextDestroyed','Runtime.executionContextsCleared','Target.attachedToTarget','Page.frameNavigated'].includes(event.method))contextEvents.push({pageId:page.id,...event});});
    return page;
  };
  await new RuntimeRegistry(fixture.store).install(source.runtime());
  const trusted = new BuiltinPackageRegistry(fixture.store), entry = source.index.apps.find(item => item.appId === 'browser');
  if (!entry) throw Error('Frozen browser package missing');
  const installed = await trusted.install(source,entry), manifest = installed.manifest;
  if (manifest.schema !== 'smartdd-app-package-v2') throw Error('Browser v2 package required');
  await trusted.packages.activate(installed.packageHash,trusted.packages.active('browser')?.generation ?? 0);
  const db = drizzle(fixture.sqlite,{schema});
  // No connections or credentials exist; this codec is unused by browser calls.
  const secrets = new SecretsStore(db,{isAvailable:()=>true,encrypt:value=>Buffer.from(value),decrypt:value=>value.toString()});
  applications = new ApplicationService(fixture.store,{secrets,projects:new ProjectService(db,secrets),tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},mailWorker:join(fixture.root,'unused-mail-worker'),foxmailNative:join(fixture.root,'unused-native-mail'),processes,browser});
  await applications.recover(); await applications.selections.setAdded('browser',true,0);
  await applications.selections.select({projectId:'p1',appId:'browser',enabled:true,expectedRevision:0,connections:{}});
  const base = fixture.plan('codex'), adapter = fixture.installedAdapters.find(item => item.metadata.agentId === 'codex' && item.metadata.version === '1.2.0');
  if (!adapter) throw Error('Frozen adapter missing');
  taskId = base.taskId;
  fixture.sqlite.prepare('INSERT INTO tasks(id,project_id,cwd,runner,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(taskId,'p1',fixture.cwd,'codex','[I] S1 synthetic task',1,1);
  const snapshot:CapabilitySessionSnapshot = {...base,schema:3,agentAtCreation:{version:'0.166.0',adapterRevision:1},adapterBinding:{id:'codex',version:adapter.metadata.version,hash:adapter.hash,projectionFormatVersion:1,nativeToolNames:{}},packages:[{
    appId:'browser',version:manifest.version,packageHash:installed.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(applicationToolDeclarations(manifest).map(tool=>[tool.name,tool.contractMajor])),capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(capability=>[capability.id,capability.contractMajor])),entry:'cli',bindings:[],allowedOperations:manifest.permissions,
    skills:manifest.skills.map(skill => {const nativeName=applicationNativeSkillName('browser',skill.id,installed.packageHash);return {skillId:skill.id,nativeName,contentHash:applicationSkillContentHash(manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(fixture.home,'.agents/skills',nativeName,'SKILL.md')};}),
  }],mcp:base.mcp.filter(item=>item.kind!=='applications')};
  const checked = capabilitySessionSnapshotV3Schema.safeParse(snapshot);
  if (!checked.success) throw Error('Fixture snapshot validation: '+JSON.stringify(checked.error.issues));
  const session = await fixture.sessions.create(checked.data,fixture.home);
  const runs = new CapabilityRunRegistry(fixture.store,fixture.sessions,{processes,assertCurrent:()=>{},revoke:()=>{},createPlan:(selected,hash,runId)=>createApplicationRunPlan({runId,snapshot:selected,snapshotHash:hash,applications:[{manifest,packageHash:installed.packageHash,capabilities:manifest.capabilities}],skills:[],available:{mcp:true,cli:true}})});
  applications.attachRuns(runs); run = await runs.reserve({taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});
  await run.prepare(); await run.cli.arm(); await run.cli.attach(process.pid);
  const tools = new ApplicationToolService(fixture.store,runs,new ApplicationAdapterRegistry(fixture.store,applications.data),{entry:'cli',retryDelays:[0,0]});
  binary = resolve(resources,'native/willyou-app');
  gateway = new ApplicationCliGateway(runs,tools,new MacUnixPeerIdentityReader(join(resources,'native/willyou-process-identity')),{executable:{path:binary,sha256:digest(readFileSync(binary))}});
  await gateway.start(); environment = {...gateway.issue(run).environment};
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok)); const address=server.address(); if (!address || typeof address==='string') throw Error('Fixture HTTP bind');
  await new Promise<void>((ok,no)=>{ipv6Server.once('error',no);ipv6Server.listen({port:address.port,host:'::1',ipv6Only:true},()=>{ipv6Server.off('error',no);ok();});});
  process.send?.({ready:true,pid:process.pid,taskId,runId:run.runId,url:`http://127.0.0.1:${address.port}/`,versions:process.versions,boundary:'I: real BrowserService/M11 module/CLI/gateway/SQLite/kernel peers; controlled Electron process as run root; synthetic page; not packaged App or real Agent'});
}).catch(error=>{process.send?.({fatal:String(error.stack??error)});app.exit(1);});

process.on('message',async (message:{id:number;command:string;args?:string[];input?:string;inputBase64?:string;paused?:boolean;expression?:string;opacity?:number;ignoreMouse?:boolean;focusEmulation?:boolean;pageId?:string;mode?:string;ref?:string;kind?:string;point?:string;threshold?:number;selection?:[number,number];pid?:number}) => {
  try {
    let value:unknown;
    if (message.command === 't065-trace') value = {...structuredClone(t065Trace),pages:browser.pages.list(taskId).map(page=>({id:page.id,session:page.helper.options.session}))};
    else if(message.command === 't065-restore') value=t065Restore();
    else if (message.command === 'cli') value = await launchCli(message.args!,message.inputBase64===undefined?message.input:Buffer.from(message.inputBase64,'base64')).done;
    else if(message.command==='s2-security-info'){
      const page=browser.pages.get(taskId),prefs=page.contents.getLastWebPreferences();
      value={pageId:page.id,profileId:page.profileId,pageIds:browser.pages.list(taskId).map(p=>p.id),preferences:{sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration,partition:prefs.partition}};
    }
    else if(message.command==='s2-popup-state'){
      const pages=browser.pages.list(taskId),page=message.pageId?pages.find(p=>p.id===message.pageId):undefined;
      const states=await Promise.all(pages.map(async p=>{try{return{pageId:p.id,...(await p.proxy.send<{result:{value:Record<string,unknown>}}>('Runtime.evaluate',{expression:'({url:location.href,hasOpener:!!window.opener,account:document.getElementById("account")?.value??null,errors:window.s2Errors??null})',returnByValue:true})).result.value};}catch{return{pageId:p.id,unavailable:true};}}));
      value={workspace:browser.workspace.snapshot(taskId),destroyedEvents:popupDestroyedEvents,retiredHelperCleanups,states,pages:pages.map(p=>({pageId:p.id,kind:p.kind,profileId:p.profileId,openerPageId:p.openerPageId,url:p.contents.getURL(),hasNativeWindow:!!p.popupWindow,sameSessionAsOpener:p.openerPageId?pages.find(parent=>parent.id===p.openerPageId)?.contents.session===p.contents.session:true})),...(page?{opener:(await page.proxy.send<{result:{value:unknown}}>('Runtime.evaluate',{expression:'({url:location.href,result:window.oauthResult??null,text:document.getElementById("oauth-result")?.textContent})',returnByValue:true})).result.value}:{})};
    }
    else if(message.command==='s2-close-page'){await browser.pages.close(taskId,message.pageId!);value={closed:message.pageId};}
    else if(message.command==='s2-close-all-pages'){for(const page of browser.pages.list(taskId))if(browser.pages.list(taskId).some(p=>p.id===page.id))await browser.pages.close(taskId,page.id);value={remaining:browser.pages.list(taskId).length};}
    else if(message.command==='s2-file-start'){
      const route={source:'task-cwd',sourceId:taskId,sourcePath:fixture.cwd,relativePath:'legacy.txt',mode:'document'};
      const old={schemaVersion:1,routes:[route],active:route,treeSource:null,expanded:{},collapsedRoots:[],filters:{},treeWidth:250};
      const raw=JSON.stringify(old,null,2),key='fileWorkspace.v1:task:'+taskId;
      fixture.sqlite.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)').run(key,raw,1);
      const local=join(app.getPath('userData'),'s2-local.html');writeFileSync(local,'<!doctype html><title>S2 local input</title><p>local native integration</p>');
      value={raw,loaded:new FileWorkspacePersistence(drizzle(fixture.sqlite,{schema})).load({kind:'task',taskId}),localUrl:'file://'+local};
    }
    else if(message.command==='s2-file-finish'){
      const before=browser.workspace.snapshot(taskId),last=before.tabs.at(-1);if(before.tabs.length!==2||!last)throw Error('Two original CLI-created tabs required');
      await browser.workspace.close(taskId,last.id);await browser.workspace.dispose();
      const restored=new BrowserWorkspace({sqlite:fixture.sqlite,pages:browser.pages,taskProject:id=>id===taskId?'p1':null});
      try{value={closedPageId:last.id,browserRestored:restored.snapshot(taskId),file:new FileWorkspacePersistence(drizzle(fixture.sqlite,{schema})).load({kind:'task',taskId}),records:fixture.sqlite.prepare("SELECT key,value FROM app_settings WHERE key IN (?,?) ORDER BY key").all('fileWorkspace.v1:task:'+taskId,'browserWorkspace.v1:'+taskId)};}finally{await restored.dispose();}
    }
    else if(message.command==='cli-begin'){const job=launchCli(message.args!,message.input);value={pid:job.pid};}
    else if(message.command==='cli-result'){const job=cliJobs.get(message.pid!);if(!job)throw Error('Unknown owned CLI job');value=await job.done;}
    else if(message.command==='cli-sigterm'){const job=cliJobs.get(message.pid!);if(!job||job.child.exitCode!==null||job.child.signalCode!==null)throw Error('Owned CLI is no longer running');value={sent:job.child.kill('SIGTERM'),pid:message.pid};}
    else if(message.command==='cancel-state'){
      const page=browser.pages.get(taskId),waits=Reflect.get(browser,'readWaits') as Map<string,Set<AbortController>>;
      const active=Reflect.get(page.helper,'active') as ReturnType<typeof spawn>|undefined;
      value={waits:waits.get(taskId)?.size??0,helperClientPid:active?.pid??null,helperCleanup:page.helper.cleanup??null,commits,
        operations:fixture.sqlite.prepare('SELECT request_id,command,state,effect_state,error_code FROM browser_operations WHERE run_id=? ORDER BY rowid').all(run.runId),
        invocations:fixture.sqlite.prepare('SELECT request_id,tool_name,state,effect_state FROM application_invocations WHERE run_id=? ORDER BY rowid').all(run.runId),
        activeLeases:fixture.sqlite.prepare("SELECT count(*) n FROM capability_run_activities WHERE run_id=? AND state='active'").get(run.runId)};
    }
    else if(message.command==='queue-settled'){
      const page=browser.pages.get(taskId),started=performance.now();
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([page.queue.settled(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned page queue did not settle after cancellation')),5000);})]);}
      finally{clearTimeout(timer);}
      value={settled:true,ms:performance.now()-started};
    }
    else if(message.command==='disconnect-submitted-write'){
      const row=fixture.sqlite.prepare("SELECT request_id FROM browser_operations WHERE run_id=? AND command='eval' AND state='running' ORDER BY rowid DESC LIMIT 1").get(run.runId) as {request_id:string}|undefined;
      if(!row||commits.length!==1)throw Error('Must first observe one server-accepted write');
      const peers=Reflect.get(gateway,'peers') as Set<{socket:{destroy():void};controllers:Map<string,{runId:string}>}>;
      const peer=[...peers].find(peer=>peer.controllers.get(row.request_id)?.runId===run.runId);if(!peer)throw Error('Original write has no live owned CLI connection');
      peer.socket.destroy();value={disconnected:true,requestId:row.request_id,at:new Date().toISOString(),commits};
    }
    else if (message.command === 'observe') {
      const page=browser.pages.get(taskId,message.pageId);
      value={...(await page.proxy.send<{result:{value:{hits:string[];value:string;url:string}}}>('Runtime.evaluate',{expression:'({hits:window.hits,instances:window.hitInstances,inputEvents:window.inputEvents,value:document.getElementById("field")?.value??null,url:location.href})',returnByValue:true})).result.value,rect:page.kind==='tab'?page.view.getBounds():page.rect,guardResponse:guardResponses.get(page.id)};
    }
    else if(message.command==='nested-observe'){
      const page=browser.pages.get(taskId);
      const frames=[];
      for(const id of page.proxy.sessions.keys())try{await page.proxy.frameReady(id);frames.push({id,ready:true,tree:await page.proxy.send('Page.getFrameTree',{},id)});}catch(error){frames.push({id,ready:false,error:String(error)});}
      const worlds=Reflect.get(page.references,'worlds'),bindings=Reflect.get(page.references,'refs');
      value={state:(await page.proxy.send<{result:{value:unknown}}>('Runtime.evaluate',{expression:'({frame:window.frameState,shadow:window.shadowState,frameEcho:document.getElementById("frame-echo")?.textContent,shadowEcho:document.getElementById("outer-shadow-echo")?.textContent,closed:document.getElementById("closed-host")?.shadowRoot===null})',returnByValue:true})).result.value,sessions:[...page.proxy.sessions].map(([id,target])=>({id,...target})),diagnostic:{frames,worlds:worlds instanceof Map?[...worlds]:null,bindings:bindings instanceof Map?[...bindings]:null,contexts:contextEvents}};
    }
    else if(message.command==='nested-mutate'){
      const page=browser.pages.get(taskId),bindings=Reflect.get(page.references,'refs') as Map<string,{backendNodeId:number;sessionId?:string}>;
      const node=bindings.get(message.ref!);if(!node)throw Error('Unknown private fixture ref');
      const mutate=async()=>{
        const resolved=await page.proxy.send<{object:{objectId:string}}>('DOM.resolveNode',{backendNodeId:node.backendNodeId},node.sessionId);
        const before=await page.proxy.send<{result:{value:unknown}}>('Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:'function(){return {value:this.value??null,connected:this.isConnected}}',returnByValue:true},node.sessionId);
        const replacement=await page.proxy.send<{result:{objectId:string}}>('Runtime.callFunctionOn',{
          objectId:resolved.object.objectId,functionDeclaration:`function(fresh){
            const next=fresh?this.ownerDocument.createElement(this.tagName):this.cloneNode(true);
            if(fresh){for(const attr of this.attributes)if(attr.name!=='data-willyou-ref')next.setAttribute(attr.name,attr.value);next.textContent=this.textContent;if('value' in this)next.value=this.value;}
            this.replaceWith(next);return next;
          }`,arguments:[{value:message.mode==='fresh'}],returnByValue:false,
        },node.sessionId);
        await page.proxy.send('Runtime.releaseObject',{objectId:resolved.object.objectId},node.sessionId);
        nestedMutations.push({kind:message.kind!,point:message.point!,mode:message.mode!,before:before.result.value,objectId:replacement.result.objectId,sessionId:node.sessionId});
      };
      if(message.point==='before-arm')await mutate();
      else if(message.point==='post-arm'){
        const original=page.references.arm.bind(page.references);
        page.references.arm=async ref=>{const armed=await original(ref);page.references.arm=original;await mutate();return armed;};
      }else if(message.point==='pre-input'){
        const original=page.proxy.send;
        page.proxy.send=async(method,params={},sessionId)=>{
          if(method==='Input.dispatchMouseEvent'||method==='Input.insertText'){page.proxy.send=original;await mutate();}
          return original(method,params,sessionId);
        };
      }else throw Error('Unknown nested fault point');
      value={installed:true,kind:message.kind,point:message.point,mode:message.mode};
    }
    else if(message.command==='nested-mutations'){
      const page=browser.pages.get(taskId),observations=[];
      for(const mutation of nestedMutations.slice(-1)){
        const after=await page.proxy.send<{result:{value:unknown}}>('Runtime.callFunctionOn',{objectId:mutation.objectId,functionDeclaration:'function(){return {value:this.value??null,connected:this.isConnected}}',returnByValue:true},mutation.sessionId);
        const {objectId,...metadata}=mutation;observations.push({...metadata,after:after.result.value});
      }
      value={mutations:observations,guard:guardResponses.get(page.id)};
    }
    else if(message.command==='helper-state'||message.command==='helper-kill'){
      const page=browser.pages.get(taskId,message.pageId),helper=page.helper;
      let pid:number|null=null;try{pid=Number(readFileSync(join(helper.options.sockets!,helper.options.session+'.pid'),'utf8'));}catch{}
      const identity=pid&&Number.isSafeInteger(pid)?helper.options.processes?.read(pid):null;
      if(message.command==='helper-kill'){
        if(!identity||helper.options.processes?.state(identity)!=='running')throw Error('Owned private helper is not running');
        process.kill(identity.pid,'SIGKILL');
        const deadline=performance.now()+2000;
        while(helper.options.processes.state(identity)==='running'&&performance.now()<deadline)await new Promise(ok=>setTimeout(ok,20));
        if(helper.options.processes.state(identity)!=='stopped')throw Error('Killed private helper has not stopped');
      }
      value={pageId:page.id,pid,identity,state:identity?helper.options.processes?.state(identity):'absent',url:page.contents.getURL(),observed:(await page.proxy.send<{result:{value:unknown}}>('Runtime.evaluate',{expression:'({hits:window.hits,value:document.getElementById("field")?.value})',returnByValue:true})).result.value};
    }
    else if(message.command==='input-observe'||message.command==='input-select'){
      const page=browser.pages.get(taskId);
      if(message.command==='input-select'){
        if(!message.selection||!message.selection.every(Number.isSafeInteger))throw Error('Explicit private selection required');
        // Test precondition only; the operation under test still goes through the actual CLI/native keyboard.
        await page.proxy.send('Runtime.evaluate',{expression:'document.getElementById("field").setSelectionRange('+JSON.stringify(message.selection[0])+','+JSON.stringify(message.selection[1])+')'});
      }
      value=(await page.proxy.send<{result:{value:unknown}}>('Runtime.evaluate',{expression:'(()=>{const field=document.getElementById("field");return {value:field.value,selectionStart:field.selectionStart,selectionEnd:field.selectionEnd,maxLength:field.maxLength,inputCount:window.inputCount,echo:window.latestInputValue,focused:document.activeElement===field}})()',returnByValue:true})).result.value;
    }
    else if(message.command==='input-fault'){
      clearInputFault?.();
      const page=browser.pages.get(taskId),helper=page.helper,original=helper.command.bind(helper);
      const record={mode:message.mode!,commands:[] as {points:number;bytes:number;sha256:string}[],events:[] as unknown[],restored:false};inputFaults.push(record);
      const pid=Number(readFileSync(join(helper.options.sockets!,helper.options.session+'.pid'),'utf8')),identity=helper.options.processes?.read(pid);
      if(!identity||helper.options.processes?.state(identity)!=='running')throw Error('Private input helper must already be connected');
      const kill=()=>{
        if(helper.options.processes?.state(identity)!=='running')throw Error('Private input helper identity no longer live');
        process.kill(identity.pid,'SIGKILL');record.events.push({event:'owned-daemon-SIGKILL',identity,at:new Date().toISOString()});
      };
      const binding='__s1InputFault'+inputFaults.length;
      const off=page.proxy.onEvent(event=>{
        if(event.method==='Runtime.bindingCalled'&&event.params.name===binding){
          record.events.push({event:'page-input-threshold',payload:event.params.payload,at:new Date().toISOString()});
          try{kill();}catch(error){record.events.push({event:'kill-failed',error:String(error)});}
        }
      });
      if(message.mode==='middle'){
        if(!message.threshold||!Number.isSafeInteger(message.threshold))throw Error('Explicit input-event threshold required');
        await page.proxy.send('Runtime.addBinding',{name:binding});
        const source=`(()=>{let count=0,fired=false;document.getElementById('field').addEventListener('input',e=>{if(!fired&&++count===${message.threshold}){fired=true;window[${JSON.stringify(binding)}](JSON.stringify({count,value:e.target.value,length:e.target.value.length}));}},true)})()`;
        new Function(source);await page.proxy.send('Runtime.evaluate',{expression:source});
      }
      helper.command=async(args,options)=>{
        if(args[0]==='keyboard'&&(args[1]==='type'||args[1]==='inserttext')){
          record.commands.push({points:Array.from(args[2]).length,bytes:Buffer.byteLength(args[2]),sha256:digest(Buffer.from(args[2]))});
          if(message.mode==='boundary'&&record.commands.length===2){
            kill();const until=performance.now()+2000;
            while(helper.options.processes?.state(identity)==='running'&&performance.now()<until)await new Promise(ok=>setTimeout(ok,10));
            if(helper.options.processes?.state(identity)!=='stopped')throw Error('Boundary helper has not stopped');
          }
        }
        return original(args,options);
      };
      clearInputFault=()=>{helper.command=original;off();record.restored=true;clearInputFault=undefined;};
      value={installed:true,mode:message.mode,threshold:message.threshold,identity};
    }
    else if(message.command==='input-clear'){clearInputFault?.();value={cleared:true};}
    else if(message.command==='input-diagnostics')value={faults:inputFaults,operations:fixture.sqlite.prepare("SELECT request_id,state,effect_state,progress,error_code FROM browser_operations WHERE run_id=? AND command IN ('type','inserttext') ORDER BY rowid").all(run.runId)};
    else if(message.command==='proxy-inspect'){
      const page=browser.pages.get(taskId,message.pageId);
      if(!proxyForwarded.has(page.id)){
        const calls:{method:string;sessionId?:string}[]=[],original=page.contents.debugger.sendCommand.bind(page.contents.debugger);proxyForwarded.set(page.id,calls);
        page.contents.debugger.sendCommand=(method,params,sessionId)=>{calls.push({method,sessionId});return sessionId?original(method,params,sessionId):original(method,params);};
      }
      value={pageId:page.id,endpoint:page.proxy.endpoint,discoveryEndpoint:page.proxy.discoveryEndpoint,parked:!host.contentView.children.includes(page.view),host:{id:host.id,title:host.getTitle(),url:host.webContents.getURL(),destroyed:host.isDestroyed()},pages:browser.pages.list(taskId).map(item=>({id:item.id,url:item.contents.getURL(),destroyed:item.contents.isDestroyed(),bounds:item.view.getBounds()})),forwarded:proxyForwarded.get(page.id)};
    }
    else if(message.command==='error-wrong-helper-sha'){
      const page=browser.pages.get(taskId,message.pageId);page.helper.options.sha256='0'.repeat(64);
      value={fault:'private helper configuration SHA mismatch before first prepare',pageId:page.id};
    }
    else if(message.command==='error-close-after-dispatch'){
      const page=browser.pages.get(taskId,message.pageId),original=page.helper.command.bind(page.helper);
      page.helper.command=async(args,options={})=>{
        page.helper.command=original;
        return original(args,{...options,dispatched:()=>{
          options.dispatched?.();errorEvents.push({event:'write-stdin-dispatched',pageId:page.id,at:new Date().toISOString()});
          errorClose=browser.pages.close(taskId,page.id).then(()=>{errorEvents.push({event:'page-closed-after-dispatch',pageId:page.id,helper:page.helper.cleanup});});
        }});
      };
      value={installed:true,pageId:page.id};
    }
    else if(message.command==='error-navigate-during-eval'){
      const page=browser.pages.get(taskId,message.pageId),original=page.proxy.send;
      page.proxy.send=(method,params={},sessionId)=>{
        if(method==='Runtime.evaluate'&&params.awaitPromise===true){
          page.proxy.send=original;
          const work=original(method,params,sessionId);
          setTimeout(()=>{errorNavigation=browser.pages.navigate(page,page.contents.getURL());errorNavigation.catch(error=>errorEvents.push({event:'navigation-failed',error:String(error)}));},30);
          return work;
        }
        return original(method,params,sessionId);
      };
      value={installed:true,pageId:page.id};
    }
    else if(message.command==='error-status'){
      await errorNavigation;await errorClose;
      value={hits:errorHits,events:errorEvents,pages:browser.pages.list(taskId).map(page=>({id:page.id,url:page.contents.getURL(),closed:page.closed}))};
    }
    else if(message.command==='identity-mutate'){
      const page=browser.pages.get(taskId,message.pageId),scripts:Record<string,string>={
        replace:'(()=>{const old=document.getElementById("action"),next=old.cloneNode(true);next.dataset.instance="replaced";old.replaceWith(next)})()',
        insert:'(()=>{const old=document.getElementById("action"),next=old.cloneNode(true);next.id="inserted";next.dataset.instance="inserted";old.before(next)})()',
        duplicate:'(()=>{const old=document.getElementById("action"),next=old.cloneNode(true);next.id="second";next.dataset.instance="second";old.after(next)})()',
        reorder:'document.getElementById("second").after(document.getElementById("action"))',
        rename:'document.getElementById("action").textContent="Renamed"',
      };
      const expression=scripts[message.mode??''];if(!expression)throw Error('Unknown identity mutation');new Function(expression);
      const before=await actionBackend(page);await page.proxy.send('Runtime.evaluate',{expression});value={before,after:await actionBackend(page),mode:message.mode};
    }
    else if(message.command==='identity-empty'){
      await browser.pages.get(taskId).proxy.send('Runtime.evaluate',{expression:'document.querySelector("form").remove()'});value={removed:'all form controls'};
    }
    else if(message.command==='native-stale-contract'){
      const page=browser.pages.get(taskId),options=page.helper.options,ref=message.args?.[0];
      if(!ref||!/^@e\d+$/.test(ref))throw Error('Native ref required');
      const raw=await new Promise((resolve,reject)=>{
        const child=spawn(options.executable,['--session',options.session,'--cdp',options.endpoint,'batch','--json'],{env:{PATH:process.env.PATH,HOME:options.home,TMPDIR:join(options.home,'tmp'),XDG_CONFIG_HOME:join(options.home,'config'),XDG_CACHE_HOME:join(options.home,'cache'),AGENT_BROWSER_SOCKET_DIR:options.sockets??join(options.home,'sockets'),AGENT_BROWSER_IDLE_TIMEOUT_MS:'600000'},stdio:['pipe','pipe','pipe']});children.add(child);
        let stdout='',stderr='',timedOut=false;
        const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},10000);
        child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);child.once('error',reject);
        child.on('close',(code,signal)=>{clearTimeout(timer);children.delete(child);resolve({code,signal,stdout,stderr,timedOut});});
        child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify([['click',ref]]));
      });
      let mapped:unknown;
      try{mapped={unexpectedSuccess:await page.helper.command(['click',ref],{timeout:5000})};}
      catch(error){mapped=error instanceof ApplicationError?{code:error.code,message:error.message}:{error:String(error)};}
      value={raw,mapped,nativeRef:ref,version:JSON.parse(readFileSync(join(process.env.M12_RESOURCE_ROOT!,'agent-browser/SOURCE.json'),'utf8')).version,pinnedSha256:options.sha256,actualSha256:digest(readFileSync(options.executable))};
    }
    else if(message.command==='snapshot-race'){
      const page=browser.pages.get(taskId,message.pageId),mode=message.mode;
      if(!mode||!['once','continuous','aba'].includes(mode))throw Error('Unknown snapshot race mode');
      raceRestores.get(page.id)?.();
      const record:SnapshotRace={mode,pageId:page.id,iterations:[],captures:[],restored:false};snapshotRaces.push(record);
      const original=page.helper.command.bind(page.helper),capture=page.proxy.captureSnapshot.bind(page.proxy);
      page.proxy.captureSnapshot=()=>{
        const observed=capture();return {...observed,finish:()=>{
          record.captures.push(observed.trees.flatMap(tree=>tree.nodes.flatMap(node=>node.role?.value==='button'&&node.name?.value==='Action'&&node.backendDOMNodeId!==undefined?[node.backendDOMNodeId]:[])));
          observed.finish();
        }};
      };
      page.helper.command=async(args,options)=>{
        if(args[0]!=='snapshot')return original(args,options);
        const before=await actionBackend(page),index=record.iterations.length;
        if(mode!=='once'||index===0)await page.proxy.send('Runtime.evaluate',{expression:'(()=>{window.__raceOriginal=document.getElementById("action");const next=window.__raceOriginal.cloneNode(true);next.dataset.instance="race-"+String((window.__raceCount??0)+1);window.__raceCount=(window.__raceCount??0)+1;window.__raceOriginal.replaceWith(next)})()'});
        const helper=await actionBackend(page);
        try{return await original(args,options);}finally{
          if(mode==='aba')await page.proxy.send('Runtime.evaluate',{expression:'(()=>{document.getElementById("action").replaceWith(window.__raceOriginal);delete window.__raceOriginal})()'});
          record.iterations.push({before,helper,after:await actionBackend(page)});
        }
      };
      raceRestores.set(page.id,()=>{page.helper.command=original;page.proxy.captureSnapshot=capture;record.restored=true;raceRestores.delete(page.id);});
      value={installed:true,mode};
    }
    else if(message.command==='identity-diagnostics')value={races:snapshotRaces};
    else if(message.command==='identity-clear'){const page=browser.pages.get(taskId,message.pageId);raceRestores.get(page.id)?.();value={cleared:true};}
    else if(message.command==='identity-observe-guards'){
      const page=browser.pages.get(taskId,message.pageId),original=page.references.arm.bind(page.references);
      page.references.arm=async(ref,options)=>{const armed=await original(ref,options);return {...armed,finish:async preserve=>{const observed=await armed.finish(preserve);guardResponses.set(page.id,{result:{value:observed}});return observed;}};};
      value={observer:'read-only returned guard states, private fixture lifetime'};
    }
    else if (message.command === 'placement') {
      const page=browser.pages.get(taskId);
      if(!observedContents.has(page.contents.id)){
        observedContents.add(page.contents.id);
        // Read-only observation of the exact guard response. No commands, events or business outputs are changed.
        const original=page.contents.debugger.sendCommand.bind(page.contents.debugger);
        page.contents.debugger.sendCommand=(method,params,sessionId)=>(sessionId?original(method,params,sessionId):original(method,params)).then(result=>{
          if(method==='Runtime.evaluate'&&params?.expression==='globalThis.__wyBrowserGuard.disarm()')guardResponses.set(page.id,result);
          return result;
        });
      }
      if(message.args?.[0]==='secondary'){
        if(!secondary){const otherTask=randomUUID();fixture.sqlite.prepare('INSERT INTO tasks(id,project_id,cwd,runner,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(otherTask,'p1',fixture.cwd,'codex','[I] secondary task',1,1);const other=await browser.pages.create(otherTask,'p1');await browser.pages.navigate(other,page.contents.getURL());secondary={taskId:otherTask,pageId:other.id};}
        await browser.pages.placement(secondary.taskId,secondary.pageId,{x:0,y:0,width:1000,height:700});
      }else await browser.pages.placement(taskId,page.id,{x:0,y:0,width:1000,height:700});
      value={placement:message.args?.[0]==='secondary'?'secondary-task-visible-primary-parked':'primary-mounted',primaryInMain:host.contentView.children.includes(page.view),primaryPageId:page.id,secondary};
    }
    else if (message.command === 'pause') { browser.pause(taskId,message.paused===true); value={paused:message.paused}; }
    else if (message.command === 'timing-events') value={events:timingEvents,operations:fixture.sqlite.prepare("SELECT request_id,created_at,rowid FROM browser_operations WHERE run_id=? AND command='eval' ORDER BY created_at,rowid").all(run.runId)};
    else if (message.command === 'park-config') {
      const page=browser.pages.get(taskId);
      const park=BrowserWindow.getAllWindows().find(window=>window.getTitle()==='WillYou browser background');
      if(!park)throw Error('Owned park window missing');
      park.setOpacity(message.opacity??0); park.setIgnoreMouseEvents(message.ignoreMouse!==false);
      await page.proxy.send('Emulation.setFocusEmulationEnabled',{enabled:message.focusEmulation===true});
      // Fault/diagnostic configuration only, never used as acceptance of the unchanged production environment.
      value={opacity:park.getOpacity(),ignoreMouse:message.ignoreMouse!==false,focusEmulation:message.focusEmulation===true};
    }
    else if (message.command === 'reset') { const page=browser.pages.get(taskId);await browser.pages.navigate(page,page.contents.getURL());value={reset:true}; }
    else if (message.command === 'replace-next-arm') {
      const page=browser.pages.get(taskId),original=page.references.arm.bind(page.references);
      // Explicit race latch: replace the field after host identity check/arming, before the native fill path.
      page.references.arm=async ref=>{
        const armed=await original(ref);page.references.arm=original;
        await page.proxy.send('Runtime.evaluate',{expression:message.mode==='button'?'(()=>{const old=document.getElementById("action"),clone=old.cloneNode(true);clone.id="clone";old.replaceWith(clone)})()':message.mode==='new-button'?'(()=>{const old=document.getElementById("action"),next=document.createElement("button");next.id="action";next.textContent="Action";next.dataset.instance="new-button";old.replaceWith(next)})()':'(()=>{const old=document.getElementById("field"),clone=old.cloneNode(true);old.replaceWith(clone)})()'});
        return armed;
      };
      value={injected:message.mode==='button'?'one-shot post-arm button clone':'one-shot post-arm nonempty field clone'};
    }
    else if (message.command === 'clone') {
      const page=browser.pages.get(taskId); await page.proxy.send('Runtime.evaluate',{expression:'(()=>{const old=document.getElementById("action"),clone=old.cloneNode(true);clone.id="clone";old.replaceWith(clone)})()'}); value={injected:'same-name replacement before action'};
    }
    else if (message.command === 'close') {
      clearInputFault?.();
      for (const child of children) child.kill('SIGKILL');
      console.error('[S1 cleanup] gateway');await gateway.close(); console.error('[S1 cleanup] run');await run.cli.exited();
      const helpers=browser.pages.list(taskId).map(page=>page.helper);
      console.error('[S1 cleanup] applications');await applications.dispose(); await browser.dispose();console.error('[S1 cleanup] helpers '+JSON.stringify(helpers.map(helper=>helper.cleanup)));
      value={closed:true,retiredHelperCleanups,helpers:helpers.map(helper=>helper.cleanup??{daemonState:'absent',clientStopped:true,socketFilesRemoved:true})};
      fixture.cleanup();server.closeAllConnections();ipv6Server.closeAllConnections(); await Promise.all([new Promise<void>(ok=>server.close(()=>ok())),new Promise<void>(ok=>ipv6Server.close(()=>ok()))]); host.destroy();
    }
    else throw Error('Unknown fixture command');
    process.send?.({id:message.id,value}); if(message.command==='close') app.quit();
  } catch(error) { process.send?.({id:message.id,error:String(error instanceof Error?error.stack:error)}); }
});
app.on('window-all-closed',()=>{});
