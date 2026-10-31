import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {join} from 'node:path';
import {openElectron} from '/Users/hx/hx/hxWork/SmartDD/scripts/lib/electron-harness.mjs';
import {compileApplicationFixture} from '/Users/hx/hx/hxWork/SmartDD/scripts/lib/compile-application-fixture.mjs';
import {concurrentVersionsProbe} from '/Users/hx/hx/hxWork/SmartDD/scripts/applications/fixtures/concurrent-versions-native.mjs';
import {DIR,assertPrivateProfile} from './permission.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const nativeArgs=['--profile','m10-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--sandbox','read-only','--ask-for-approval','never'];
function textResponse(res,model,text){
 const id='ug_health',message={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
 const frame=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
 frame('response.created',{response:{id,object:'response',status:'in_progress',output:[]}});
 frame('response.output_item.added',{output_index:0,item:{...message,status:'in_progress',content:[]}});
 frame('response.content_part.added',{item_id:message.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
 frame('response.output_text.delta',{item_id:message.id,output_index:0,content_index:0,delta:text});
 frame('response.output_text.done',{item_id:message.id,output_index:0,content_index:0,text});
 frame('response.content_part.done',{item_id:message.id,output_index:0,content_index:0,part:message.content[0]});
 frame('response.output_item.done',{output_index:0,item:message});
 frame('response.completed',{response:{id,object:'response',status:'completed',model,output:[message],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
}
export function mainGuard(cfg,checkProfile){
 const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
 if(![0,2].includes(cfg.maxTaskCreates)||E.app.getPath('userData')!==cfg.userData||process.env.HOME!==(cfg.maxTaskCreates===0?cfg.env.HOME:'/Users/hx'))throw Error('UG own App HOME/userData required');
 const req=process.getBuiltinModule('module').createRequire(E.app.getAppPath()+'/out/main/index.js');
 const DB=req('better-sqlite3'),db=new DB(cfg.userData+'/smartdd.db',{readonly:true,fileMustExist:true});
 const fs=process.getBuiltinModule('fs');
 for(const p of [cfg.root,cfg.env.HOME,cfg.env.CODEX_HOME,cfg.env.CLAUDE_CONFIG_DIR])if(fs.lstatSync(p).isSymbolicLink()||fs.realpathSync(p)!==p)throw Error('UG canonical private roots required');
 const map=E.ipcMain._invokeHandlers,g={db,originals:[],forbidden:[],attempts:[],taskIds:[],records:[],sourceId:null,imported:null,defaults:null,exports:[],nativeDialogs:[]};
 g.checkPaths=(paths,isSave)=>{for(const path of paths){
  if(path===cfg.cli&&!isSave)continue;
  if(typeof path!=='string'||!(path===cfg.root||path.startsWith(cfg.root+'/'))){g.forbidden.push('fixture-path-outside-root');throw Error('UG native dialog path outside this fixture')}
  const canonical=isSave?process.getBuiltinModule('path').join(fs.realpathSync(process.getBuiltinModule('path').dirname(path)),process.getBuiltinModule('path').basename(path)):fs.realpathSync(path);
  if(canonical!==path)throw Error('UG canonical own dialog path required');
  if(!isSave&&path.endsWith('.willyou')&&!g.exports.some(x=>x.path===path&&x.sha256===process.getBuiltinModule('crypto').createHash('sha256').update(fs.readFileSync(path)).digest('hex')))throw Error('UG only exact own successful export may be imported');
 }return true};
 for(const name of ['showOpenDialog','showSaveDialog']){const original=E.dialog[name];g.nativeDialogs.push([name,original]);E.dialog[name]=async function(...args){const result=await original.apply(this,args);if(!result.canceled)g.checkPaths(name==='showOpenDialog'?result.filePaths:[result.filePath],name==='showSaveDialog');return result}};
 const originalGet=map.get('tasks.get');
 const wrap=(name,fn)=>{const original=map.get(name);if(typeof original!=='function')throw Error('UG required original handler:'+name);g.originals.push([name,original]);map.set(name,fn(original))};
 wrap('aiProfiles.create',original=>async function(event,...args){checkProfile(args[0],cfg);return original.call(this,event,...args)});
 wrap('tasks.create',original=>async function(event,...args){
  const input=args[0],index=g.attempts.length;if(index>=cfg.maxTaskCreates||input.fork||input.forkFrom||input.resumeFrom)throw Error('UG two original new tasks only');
  const profileId=input.aiProfileId??db.prepare('SELECT id FROM ai_profiles WHERE is_default=1').get()?.id;
  const row=db.prepare('SELECT runner,executable,args,env FROM ai_profiles WHERE id=?').get(profileId);
  if(!row)throw Error('UG own profile missing');checkProfile({...row,args:JSON.parse(row.args),env:JSON.parse(row.env)},cfg);
  const expectedProject=index===0?g.sourceId:g.imported?.projectId,expectedPrompt=index===0?cfg.oldPrompt:cfg.newPrompt;
  if(!expectedProject||input.projectId!==expectedProject||input.firstMessage!==expectedPrompt||index===1&&!g.imported.profileIds.includes(profileId))throw Error('UG exact project/profile/prompt required');
  if(index===1){const old=await originalGet(event,g.taskIds[0]);if(old.ptyId||!old.nativeSessionId)throw Error('UG old native task must stop before imported task')}
  fs.writeFileSync(cfg.audit+'/task-attempt-'+(index+1)+'.json',JSON.stringify({at:new Date().toISOString(),projectId:input.projectId,profileId,index:index+1}),{flag:'wx',mode:0o600});
  g.attempts.push({at:Date.now(),projectId:input.projectId,profileId});const result=await original.call(this,event,...args);g.taskIds.push(result.task.id);return result;
 });
 for(const name of ['projectTransfer.export','projectTransfer.commit'])wrap(name,original=>async function(event,...args){
  const entry={name,at:Date.now()};g.records.push(entry);const result=await original.call(this,event,...args);entry.reply=result;entry.returnedAt=Date.now();
  if(name==='projectTransfer.export'&&result.ok){const path=result.value.path;g.checkPaths([path],true);g.exports.push({path,sha256:process.getBuiltinModule('crypto').createHash('sha256').update(fs.readFileSync(path)).digest('hex')})}
  if(name==='projectTransfer.commit'&&result.ok){
   if(g.imported&&g.imported.projectId!==result.value.projectId)throw Error('UG one imported project only');g.imported=result.value;
   g.defaults={settings:db.prepare('SELECT enabled FROM application_project_settings WHERE project_id=?').all(result.value.projectId),bindings:db.prepare('SELECT count(*) n FROM application_project_bindings WHERE project_id=?').get(result.value.projectId).n};
  }
  return result;
 });
 for(const name of ['aiProfiles.importZshrc','tasks.open','tasks.fork','tasks.clone','applications.replyDraft','applications.importAttachment','applications.captureAttachment','applications.prepareSend','applications.reviewSend','applications.authorizeSend','applications.executeSend','app.openExternal','projects.testDatabase','projects.testServer']){
  const original=map.get(name);if(original){g.originals.push([name,original]);map.set(name,()=>{g.forbidden.push(name);throw Error('UG scope forbids operation:'+name)})}
 }
 g.restore=()=>{for(const[n,f]of g.originals)map.set(n,f);for(const[n,f]of g.nativeDialogs)E.dialog[n]=f;db.close();delete globalThis.__ugRich};
 globalThis.__ugRich=g;const windows=E.BrowserWindow.getAllWindows();if(windows.length!==1)throw Error('UG own one window required');windows[0].setTitle('A · T21 UG rich/new sessions · PID '+process.pid);return true;
}

export async function execute(pins,permission){
 assert.equal(permission.maxTaskCreates,2);
 const root=await mkdtemp('/private/tmp/willyou-m10-transfer-rich-ug-'),userData=join(root,'userdata'),home=join(root,'home'),state=join(root,'codex'),claude=join(root,'never-claude'),sourceCode=join(root,'source-code'),importCode=join(root,'imported-code');
 for(const p of [userData,home,state,claude,sourceCode,join(sourceCode,'.git'),importCode,join(importCode,'.git'),join(root,'peer-code')])await mkdir(p,{recursive:true,mode:0o700});
 const secrets={password:randomBytes(24).toString('base64url'),db:randomBytes(24).toString('base64url'),ssh:randomBytes(24).toString('base64url')};await writeFile(join(root,'.private-fixture-secrets.json'),JSON.stringify(secrets),{flag:'wx',mode:0o600});
 await writeFile(join(sourceCode,'source-only.txt'),'UG_CODE_CONTENT_NOT_PORTABLE\n');
 const marker='UG_'+root.split('-').at(-1),probe=concurrentVersionsProbe(marker),oldPrompt=marker+'_NJ_old-target: Create one LOCAL DRAFT only;no recipients,no SMTP.',newPrompt=marker+'_NJ_imported: Create one LOCAL DRAFT only;no recipients,no SMTP.';
 const result={startedAt:new Date().toISOString(),root,userData,home,state,app:pins.app,status:'running',layer:'Real packaged UI import/export/P04/native task creation and stop;real Codex/MCP;synthetic loopback model and resource prerequisites',checks:[],controls:[],requests:[],modelPhases:probe.records,scope:permission.scope,maxTaskCreates:2};
 const sockets=new Set();let app,server;
 const sql=q=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),q],{encoding:'utf8',timeout:4000})||'[]');
 const unwrap=v=>{assert(v.ok,JSON.stringify(v));return v.value};
 const poll=async(fn,ms=45000)=>{const end=Date.now()+ms;do{const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100))}while(Date.now()<end);throw Error('UG bounded original-state wait timed out')};
 const note=name=>{result.checks.push({name,at:new Date().toISOString()});console.log(JSON.stringify({root,check:name}))};
 async function fill(selector,value){
  assert(await app.evaluate('document.hasFocus()&&document.visibilityState==="visible"'),'UG explicit own UI focus required');
  await app.waitFor('!!document.querySelector('+JSON.stringify(selector)+')',10000);
  const p=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('UG covered private field');return{x,y}})()`);
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
  for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});
  await app.cdp('Input.insertText',{text:value});assert.equal(await app.evaluate('document.querySelector('+JSON.stringify(selector)+').value'),value);
 }
 const filled=new Set();
 async function control(kind,data={}){
  const n=result.controls.length,ack=join(root,'ack-'+n+'.json'),entry={kind,sequence:n,ack,pid:app.processId,root,...data,at:new Date().toISOString()};result.controls.push(entry);await writeFile(join(root,'progress.json'),JSON.stringify(entry,null,2));console.log(JSON.stringify({root,control:entry}));
  const end=Date.now()+900000;
  while(Date.now()<end){
   for(const phase of ['export','import'])if(!filled.has(phase)&&await readFile(join(root,'fill-'+phase+'.json'),'utf8').then(JSON.parse,()=>null)){
    if(phase==='export'){await fill('input[aria-label=设置导出口令]',secrets.password);await fill('input[aria-label=再次输入口令]',secrets.password)}else await fill('input[aria-label=导入口令]',secrets.password);
    filled.add(phase);await writeFile(join(root,'filled-'+phase+'.json'),JSON.stringify({done:true,at:new Date().toISOString(),method:'Original own renderer input controls;no direct DOM/store assignment'}),{flag:'wx'});
   }
   const value=await readFile(ack,'utf8').then(JSON.parse,()=>null);if(value){assert(value.done===true,'UG actual UI action deferred');entry.receipt=value;return}
   await new Promise(r=>setTimeout(r,100));
  }
  throw Error('UG actual UI control timed out;preserve original state,do not replay');
 }
 async function nativeTask(phase,projectId){
  assert(phase.done&&!phase.value.error,'UG actual MCP result required');const task=await poll(async()=>{const t=(await app.invoke('tasks.list',{includeArchived:true})).find(t=>t.firstMessage===(phase.name==='old-target'?oldPrompt:newPrompt));return t?.nativeSessionId?t:null});
  assert.equal(task.projectId,projectId);assert.equal(task.stateRoot,state);assert(phase.value.draft&&phase.value.draft.sourceTaskId===task.id);
  const row=await poll(()=>{const v=sql("SELECT snapshot_hash,snapshot_json FROM capability_session_snapshots WHERE task_id='"+task.id+"'")[0];return v&&JSON.parse(v.snapshot_json).native.sessionId===task.nativeSessionId?v:null});const snap=JSON.parse(row.snapshot_json),pack=snap.packages.find(x=>x.appId==='mail');assert.equal(pack.packageHash,pins.mailPackageHash);
  return{task,phaseDraftId:phase.value.draft.id,snapshotHash:row.snapshot_hash,packageHash:pack.packageHash};
 }
 async function history(task){
  const found=[];async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);assert(!e.isSymbolicLink());if(e.isDirectory())await walk(p);else if(e.isFile()&&e.name.endsWith('.jsonl')&&e.name.includes(task.nativeSessionId))found.push(p)}}await walk(join(state,'sessions'));assert.equal(found.length,1);return{path:found[0],sha256:hash(await readFile(found[0])),bytes:(await lstat(found[0])).size};
 }
 async function stopped(taskId){
  await poll(async()=>{
   if((await app.invoke('tasks.get',taskId)).ptyId)return false;
   const runs=sql("SELECT id,state FROM capability_runs WHERE task_id='"+taskId+"'");
   if(!runs.length||runs.some(x=>x.state!=='stopped'))return false;
   const processes=sql("SELECT p.state FROM capability_run_processes p JOIN capability_runs r ON r.id=p.run_id WHERE r.task_id='"+taskId+"'");
   return processes.length>0&&processes.every(x=>['exited','canceled'].includes(x.state))&&sql("SELECT count(*) n FROM capability_resource_leases WHERE state<>'released'")[0].n===0;
  });
 }
 try{
  server=createServer((req,res)=>{const chunks=[];let bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(b)});req.on('end',()=>{try{if(!req.url.endsWith('/responses')){res.writeHead(404);res.end();return}const body=JSON.parse(Buffer.concat(chunks).toString()),raw=JSON.stringify(body),code=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];result.requests.push({at:new Date().toISOString(),bytes,sha256:hash(raw),kind:code?'profile-health':'fixed-local-draft',model:body.model});res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});if(code)textResponse(res,body.model,code);else if(!probe.respond(body,res))throw Error('UG unexpected model phase')}catch(error){result.providerError=String(error);res.destroy(error)}})});
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{})});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;result.provider={host:'127.0.0.1',port,synthetic:true,realProviderAuth:false};
  const config='model="m10-base-model"\nmodel_provider="m10_local_fixture"\nnotify=[]\n[model_providers.m10_local_fixture]\nname="UG Synthetic Local Fixture"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n'+[sourceCode,importCode].map(p=>'[projects.'+JSON.stringify(p)+']\ntrust_level="trusted"\n').join('');
  await writeFile(join(state,'config.toml'),config);await writeFile(join(state,'m10-native.config.toml'),'model="m10-ui-profile-model"\nskills.config=[]\n');
  const env={HOME:home,ZDOTDIR:home,CODEX_HOME:state,CLAUDE_CONFIG_DIR:claude,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};
  app=await openElectron({executable:join(pins.app,'Contents/MacOS/WillYou'),userData,cwd:sourceCode,inspectMain:true,env:{...env,HOME:'/Users/hx'}});result.pid=app.processId;
  const cfg={root,userData,audit:DIR,env,cli:pins.cli,args:nativeArgs,oldPrompt,newPrompt,maxTaskCreates:2};await app.mainEvaluate('('+mainGuard.toString()+')('+JSON.stringify(cfg)+','+assertPrivateProfile.toString()+')',{label:'ug-install-reviewed-private-task-guard'});
  console.log(JSON.stringify({root,pid:app.processId,stage:'prepare-own-projects-configs-profile;system-keychain-may-request-confirmation'}));
  const source=await app.invoke('projects.create',{name:'UG rich source',aliases:['UG-SOURCE'],description:'UG synthetic rich M8/M10 source',rulesPath:null},[{label:'main',path:sourceCode}]);result.source={id:source.id,name:source.name};
  const peer=await app.invoke('projects.create',{name:'UG unrelated peer',aliases:[],description:'UG unchanged peer',rulesPath:null},[{label:'peer',path:join(root,'peer-code')}]);result.peer={id:peer.id,name:peer.name};await app.mainEvaluate('globalThis.__ugRich.sourceId='+JSON.stringify(source.id)+';true',{label:'ug-bind-own-source-project'});
  await app.invoke('projects.createDatabase',source.id,{env:'test',label:'UG offline database',aliases:[],vendor:'postgres',host:'127.0.0.1',port:9,database:'ug_fixture',schema:'public',username:'ug_fixture',accessLevel:'readonly',isDefault:true,note:'Definition only;never query or connect',password:secrets.db});
  await app.invoke('projects.createServer',source.id,{env:'test',label:'UG offline server',aliases:[],host:'127.0.0.1',port:9,username:'ug_fixture',authType:'password',privateKeyPath:null,defaultRoot:true,sudoPolicy:'none',appRoot:'/fixture',logsPath:null,note:'Definition only;never connect',password:secrets.ssh});
  const mailSource=join(root,'synthetic-foxmail');await mkdir(join(mailSource,'Mail/Inbox'),{recursive:true});await writeFile(join(mailSource,'Mail/Inbox/1.mail'),'From: sender@example.test\r\nTo: receiver@example.test\r\nSubject: UG fixture\r\nMessage-ID: <ug@example.test>\r\n\r\nUG_M10_BODY_NOT_PORTABLE\r\n');execFileSync('/usr/bin/sqlite3',[join(mailSource,'messages.db'),"CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);INSERT INTO mailinfo VALUES(1,'UG fixture','sender@example.test','receiver@example.test','<ug@example.test>',0,0,1,0)"]);
  const mail=unwrap(await app.invoke('applications.catalog')).find(x=>x.appId==='mail');unwrap(await app.invoke('applications.setAdded','mail',true,mail.revision));const tested=unwrap(await app.invoke('applications.testConnection',{name:'UG existing local source',expectedRevision:0,config:{kind:'foxmail',sourcePath:mailSource,account:'receiver@example.test',queryDays:7}}));const connection=unwrap(await app.invoke('applications.saveConnection','mail',tested.operationId,tested.candidateHash));result.connection={id:connection.id,name:connection.name};unwrap(await app.invoke('applications.select',{projectId:source.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:connection.id,smtp:null}}));
  const profile=await app.invoke('aiProfiles.create',{name:'UG private Codex',runner:'codex',executable:pins.cli,args:nativeArgs,env:Object.entries(env).map(([name,value])=>({name,value,secret:false})),color:null,isDefault:true});result.profile={id:profile.id,name:profile.name};await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);if(p.check&&!p.checking){assert.equal(p.check.status,'ok');return true}},45000);
  const content=name=>({mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject:marker+'_'+name,text:marker+'_M10_PRIVATE_'+name,html:null,inReplyTo:null,references:[],attachmentIds:[]});
  const oldPhase=probe.select('old-target',{content:content('OLD_DRAFT')},'smartdd_mail_draft_create_v1');assert(oldPrompt.startsWith(oldPhase.token));await control('create-and-stop-old-source-task-via-real-ui',{projectId:source.id,projectName:source.name,profileName:profile.name,prompt:oldPrompt});await poll(()=>oldPhase.done);const old=await nativeTask(oldPhase,source.id);await stopped(old.task.id);old.task=await app.invoke('tasks.get',old.task.id);const oldHistory=await history(old.task);probe.clear(oldPhase);note('Old source task is a real stopped native Codex session with a local draft and fixed own snapshot');
  const preserveTables=['tasks','mail_drafts','mail_draft_revisions','mail_attachment_objects','mail_send_intents','mail_send_executions','capability_session_snapshots','capability_session_refs','application_project_settings','application_project_bindings','app_secrets'];const before=Object.fromEntries(preserveTables.map(t=>[t,sql('SELECT * FROM '+t+' ORDER BY rowid')]));const sourceBefore=await app.invoke('projects.get',source.id),peerBefore=await app.invoke('projects.get',peer.id),connectionBefore=sql('SELECT id,name,config_json,enabled,revision FROM application_connections');
  const exportPath=join(root,'ug-rich.willyou');await control('actual-source-export-import-and-success-page-P04-selection',{sourceProjectId:source.id,sourceProjectName:source.name,profileName:profile.name,exportPath,importDirectory:importCode,existingConnectionName:connection.name,secretCommands:{export:join(root,'fill-export.json'),import:join(root,'fill-import.json')},instructions:'Select the source AI profile for export and import;use real native Save/Open/directory;after successful import click Configure project applications on that same page;enable Mail and explicitly reuse the one verified local source. No task yet.'});
  const stateAfterImport=await app.mainEvaluate('({imported:globalThis.__ugRich.imported,defaults:globalThis.__ugRich.defaults})',{label:'ug-read-original-import-and-defaults'});assert(stateAfterImport.imported&&stateAfterImport.imported.profileIds.length===1);assert(stateAfterImport.defaults.settings.every(x=>!x.enabled)&&stateAfterImport.defaults.bindings===0);result.imported=stateAfterImport.imported;
  const selected=unwrap(await app.invoke('applications.projectSettings',result.imported.projectId,'mail'));assert(selected.enabled&&selected.connections.foxmail===connection.id&&selected.connections.smtp===null);result.selected=selected;
  const codecInfo=await compileApplicationFixture({entry:'scripts/applications/fixtures/transfer-fixture-codec.ts',output:join(root,'setup/codec.cjs')}),codec=createRequire(import.meta.url)(codecInfo.output),raw=await readFile(exportPath),payload=await codec.decryptProject(raw,secrets.password);assert.deepEqual(Object.keys(payload).sort(),['schemaVersion','exportedAt','producer','project','directories','databases','servers','capabilities','profiles','credentials'].sort());assert.equal(payload.databases.length,1);assert.equal(payload.servers.length,1);assert.equal(payload.profiles.length,1);assert.equal(Object.keys(payload.credentials).length,2);assert(Object.values(payload.credentials).some(v=>v.password===secrets.db)&&Object.values(payload.credentials).some(v=>v.password===secrets.ssh));for(const value of [old.task.id,old.task.nativeSessionId,old.snapshotHash,old.phaseDraftId,connection.id,'UG_CODE_CONTENT_NOT_PORTABLE','UG_M10_BODY_NOT_PORTABLE',marker+'_M10_PRIVATE_OLD_DRAFT'])assert(!JSON.stringify(payload).includes(value));result.artifact={path:exportPath,sha256:hash(raw),bytes:raw.length,keys:Object.keys(payload),m8Counts:{databases:1,servers:1,profiles:1,credentials:2},m10CanariesAbsent:true};
  const importedProject=await app.invoke('projects.get',result.imported.projectId);assert.equal(importedProject.databases.length,1);assert.equal(importedProject.servers.length,1);const ownSecretChecks=[[`db:${importedProject.databases[0].id}:password`,secrets.db],[`server:${importedProject.servers[0].id}:password`,secrets.ssh]];
  const secretMatches=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),db=globalThis.__ugRich.db;return ${JSON.stringify(ownSecretChecks)}.map(([key,wanted])=>{const row=db.prepare('SELECT secret FROM app_secrets WHERE key=?').get(key);return !!row&&row.secret!==Buffer.from(wanted).toString('base64')&&E.safeStorage.decryptString(Buffer.from(row.secret,'base64'))===wanted})})()`,{label:'ug-compare-own-imported-m8-credentials'});assert.deepEqual(secretMatches,[true,true]);result.importedCredentialMatches=secretMatches;note('Rich original UI export/import preserves nonempty M8 fields and receiver encryption,excludes nonempty source M10/native data,and same-success-page P04 explicitly selects the local connection');
  const next=probe.select('imported',{content:content('IMPORTED_DRAFT')},'smartdd_mail_draft_create_v1');assert(newPrompt.startsWith(next.token));const importedProfile=await app.invoke('aiProfiles.get',result.imported.profileIds[0]);await control('create-and-stop-imported-task-via-real-ui',{projectId:result.imported.projectId,projectName:result.imported.name,profileName:importedProfile.name,prompt:newPrompt});await poll(()=>next.done);const fresh=await nativeTask(next,result.imported.projectId);await stopped(fresh.task.id);assert.notEqual(fresh.task.nativeSessionId,old.task.nativeSessionId);assert.equal(fresh.task.aiProfileId,importedProfile.id);probe.clear(next);
  for(const[t,rows]of Object.entries(before)){const now=sql('SELECT * FROM '+t+' ORDER BY rowid');for(const row of rows)assert(now.some(v=>JSON.stringify(v)===JSON.stringify(row)),'Old row changed:'+t)}assert.deepEqual(await history(old.task),oldHistory);assert.deepEqual(await app.invoke('projects.get',source.id),sourceBefore);assert.deepEqual(await app.invoke('projects.get',peer.id),peerBefore);assert.deepEqual(sql('SELECT id,name,config_json,enabled,revision FROM application_connections'),connectionBefore);assert.equal(sql('SELECT count(*) n FROM tasks')[0].n,2);assert.equal(sql('SELECT count(*) n FROM project_import_receipts')[0].n,1);assert.equal(sql('SELECT count(*) n FROM mail_send_executions')[0].n,0);assert.equal(sql("SELECT count(*) n FROM capability_resource_leases WHERE state<>'released'")[0].n,0);assert(sql('SELECT state FROM capability_runs').every(x=>x.state==='stopped'));
  result.native={old:{taskId:old.task.id,nativeId:old.task.nativeSessionId,stateRoot:state,snapshotHash:old.snapshotHash,draftId:old.phaseDraftId,history:oldHistory},imported:{taskId:fresh.task.id,nativeId:fresh.task.nativeSessionId,stateRoot:state,snapshotHash:fresh.snapshotHash,draftId:fresh.phaseDraftId,packageHash:fresh.packageHash},oldRowsRetained:true};note('Imported real native task uses current local package/selected connection/private root while old session JSONL,task,snapshot,draft,global connection and peer remain exact');result.status='passed-rich-t21-native-subset';
 }catch(error){result.status='failed';result.error=String(error);result.stack=error.stack;process.exitCode=2;}
 finally{
  probe.clearAll();if(app){try{const g=await app.mainEvaluate('({taskIds:globalThis.__ugRich.taskIds,attempts:globalThis.__ugRich.attempts,forbidden:globalThis.__ugRich.forbidden,records:globalThis.__ugRich.records.map(x=>({name:x.name,at:x.at,returnedAt:x.returnedAt,ok:x.reply?.ok,code:x.reply?.code}))})',{label:'ug-own-guard-results'});result.guard=g;for(const id of g.taskIds)await app.invoke('tasks.kill',id);assert(g.attempts.length<=2&&!g.forbidden.length);await app.mainEvaluate('globalThis.__ugRich.restore();true',{label:'ug-restore-own-guard'});result.guardRestored=true;await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()",{label:'ug-own-normal-quit'});result.exit=await app.waitForExit(5000)}catch(error){result.cleanupError=String(error)}await app.close()}
  for(const socket of sockets)socket.destroy();if(server)await new Promise(resolve=>server.close(resolve));result.finishedAt=new Date().toISOString();const serialized=JSON.stringify(result,null,2);for(const v of Object.values(secrets))assert(!serialized.includes(v),'Private generated fixture secret must not enter result');await writeFile(join(root,'result.json'),serialized,{mode:0o600});await writeFile(DIR+'/last-root.json',JSON.stringify({root,status:result.status,finishedAt:result.finishedAt}));console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error}));
 }
}
