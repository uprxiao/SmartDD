// T62 service/actual-CLI evidence. Fresh native history is created outside WillYou,
// then imported as a private NULL-snapshot fixture. No UI creation claim.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openElectron,pause} from '../lib/electron-harness.mjs';
import {installAppFocusGuard} from '../lib/app-focus-guard.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP,expectedAsar=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,cli=process.env.WILLYOU_CODEX_CLI;
assert(executable?.startsWith('/private/tmp/willyou-m10-')&&cli&&expectedAsar);
const root=await mkdtemp('/private/tmp/willyou-m10-unknown-history-'),home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
for(const dir of [home,state,join(cwd,'.git')])await mkdir(dir,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),appRoot=resolve(dirname(executable),'../..'),marker='M10_UNKNOWN_'+root.split('-').at(-1);
const result={root,startedAt:new Date().toISOString(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),driverSha256:hash(await readFile(new URL(import.meta.url))),app:appRoot,asar:hash(await readFile(join(appRoot,'Contents/Resources/app.asar'))),layer:'I: actual packaged TaskService/PTY and real Codex resume; initial headless native history is a fixture only; no UI creation or prototype pass',checks:[],requests:[],appPids:[],status:'running'};
assert.equal(result.asar,expectedAsar);result.cli={path:cli,version:execFileSync(cli,['--version'],{encoding:'utf8'}).trim()};assert.equal(result.cli.version,'codex-cli 0.162.1');
const checked=name=>result.checks.push({name,at:new Date().toISOString(),passed:true});
let app,task,freshTask,project,profile,stage='native-history-fixture';
const sockets=new Set();
const server=createServer((req,res)=>{let data='';req.on('data',b=>{data+=b;if(data.length>4*1024*1024)req.destroy();});req.on('end',()=>{try{
 const body=JSON.parse(data),raw=JSON.stringify(body),health=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
 const kind=raw.includes(marker+'_FRESH')?'fresh':raw.includes(marker+'_RESUME')?'resumed':raw.includes(marker+'_INITIAL')?'initial':health?'health':'unexpected';
 assert.notEqual(kind,'unexpected');const text=health??marker+'_'+kind.toUpperCase()+'_DONE';
 result.requests.push({kind,at:new Date().toISOString(),sha256:hash(raw),bytes:Buffer.byteLength(raw),toolNames:(body.tools??[]).map(t=>t.name??t.type),managedSkillNames:[...new Set(raw.match(/smartdd-a-(?:mail|zentao)-[A-Za-z0-9_-]+/g)??[])]});
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 const id='msg_'+result.requests.length,message={id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
 const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
 send('response.created',{response:{id:'resp_'+id,object:'response',status:'in_progress',output:[]}});
 send('response.output_item.added',{output_index:0,item:{...message,status:'in_progress',content:[]}});
 send('response.content_part.added',{item_id:id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
 send('response.output_text.delta',{item_id:id,output_index:0,content_index:0,delta:text});send('response.output_text.done',{item_id:id,output_index:0,content_index:0,text});
 send('response.content_part.done',{item_id:id,output_index:0,content_index:0,part:message.content[0]});send('response.output_item.done',{output_index:0,item:message});
 send('response.completed',{response:{id:'resp_'+id,object:'response',status:'completed',model:body.model,output:[message],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
 }catch(error){result.providerFailure=String(error);res.destroy(error);}});});
server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const config='model="m10-unknown-model"\nmodel_provider="m10_fixture"\nnotify=[]\n[model_providers.m10_fixture]\nname="Synthetic local fixture"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.'+JSON.stringify(cwd)+']\ntrust_level="trusted"\n';
await writeFile(join(state,'config.toml'),config);
const privateEnv={HOME:home,ZDOTDIR:home,CODEX_HOME:state,SHELL:'/bin/zsh',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
for(const key of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL'].includes(key))delete process.env[key];Object.assign(process.env,privateEnv);
const flags=['--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','--sandbox','read-only','--ask-for-approval','never'];
async function poll(fn,ms=30000){const end=Date.now()+ms;do{if(result.providerFailure)throw Error(result.providerFailure);const v=await fn();if(v)return v;await pause(100);}while(Date.now()<end);throw Error('Bounded wait: '+stage);}
const sql=q=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),q],{encoding:'utf8'})||'[]');
async function start(){app=await openElectron({executable,userData,cwd,env:privateEnv,inspectMain:true});installAppFocusGuard(app,result);result.appPids.push(app.processId);await app.evaluate("document.title='A · M10 · unknown native history service fixture';true");}
async function stop(label){await writeFile(join(root,label+'.log'),app.logs());await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");const exit=await app.waitForExit();assert.equal(exit.code,0);await app.close();app=undefined;}
async function nativeSubmit(taskId,ptyId,text,done){
 await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId,ptyId,data:text})});true`);
 await poll(async()=>(await app.output(ptyId)).includes(text.split(':')[0]),10000);await pause(350); // Actual native paste timer.
 await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId,ptyId,data:'\r'})});true`);
 await poll(async()=>{const value=await app.output(ptyId);await writeFile(join(root,'resume-terminal.txt'),value);return value.includes(done);},60000);
}
try{
 const nativeExecution=promisify(execFile)(cli,[...flags,'exec','--json','--skip-git-repo-check',marker+'_INITIAL: Reply with the marker only. Do not use tools or change files.'],{cwd,env:{...process.env,...privateEnv},timeout:45000,maxBuffer:4*1024*1024});nativeExecution.child.stdin.end();const native=await nativeExecution;
 await writeFile(join(root,'initial-native.jsonl'),native.stdout);await writeFile(join(root,'initial-native.stderr'),native.stderr);
 const events=native.stdout.trim().split('\n').map(line=>JSON.parse(line)),started=events.find(event=>event.type==='thread.started');assert(started?.thread_id);const nativeId=started.thread_id;assert(native.stdout.includes(marker+'_INITIAL_DONE'));result.originalNativeId=nativeId;
 const histories=(await readdir(state,{recursive:true})).filter(path=>path.endsWith('.jsonl')&&path.includes(nativeId));assert.equal(histories.length,1);const history=join(state,histories[0]),historyBefore=await readFile(history);result.nativeHistory={path:history,sha256:hash(historyBefore),bytes:historyBefore.length};checked('Independent actual Codex produced native history outside WillYou; no capability snapshot ever recorded');
 stage='app-prerequisites';await start();project=await app.invoke('projects.create',{name:'M10 未知历史隔离项目',aliases:[],description:'Synthetic task metadata, real native history',rulesPath:null},[{label:'private',path:cwd}]);result.projectId=project.id;
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok);assert((await app.invoke('applications.setAdded','mail',true,catalog.value.find(a=>a.appId==='mail').revision)).ok);
 assert((await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}})).ok);
 profile=await app.invoke('aiProfiles.create',{name:'Private Codex for unknown history',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args:flags,color:null,isDefault:true});result.profileId=profile.id;
 const health=await poll(async()=>{const v=await app.invoke('aiProfiles.get',profile.id);return !v.checking&&v.check?v.check:null;});assert.equal(health.status,'ok');await stop('prerequisite-host');
 stage='import-null-snapshot-fixture';const taskId=randomUUID(),at=Date.now();result.taskId=taskId;
 execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys,json; p=json.loads(sys.stdin.read()); c=sqlite3.connect(sys.argv[1]); c.execute(\"INSERT INTO tasks(id,project_id,cwd,ai_profile_id,ai_profile_name,runner,native_session_id,state_root,native_history_observed,title,first_message,runtime_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,'codex',?,?,1,'Unknown native fixture',?,NULL,?,?)\",p); c.commit(); c.close()",join(userData,'smartdd.db')],{input:JSON.stringify([taskId,project.id,cwd,profile.id,profile.name,nativeId,state,marker+'_INITIAL',at,at]),encoding:'utf8'});
 assert.equal(sql("SELECT runtime_snapshot FROM tasks WHERE id='"+taskId+"'")[0].runtime_snapshot,null);assert.equal(sql('SELECT count(*) n FROM capability_session_snapshots')[0].n,0);
 stage='read-only-history-inspection';await start();const before=sql('SELECT * FROM tasks'),view=await app.invoke('tasks.get',taskId),diagnostic=await app.invoke('applications.session',taskId);assert(diagnostic.ok);assert.equal(view.ptyId,null);assert.equal(diagnostic.value.selection,'unknown-history');assert.deepEqual(sql('SELECT * FROM tasks'),before);assert.equal(sql('SELECT count(*) n FROM capability_runs')[0].n,0);result.beforeResume={view,diagnostic:diagnostic.value};checked('Read-only historical view reports unknown capability and creates no PTY/run or task rewrite');
 stage='actual-native-resume';const opened=await app.invoke('tasks.open',{taskId,cols:100,rows:30});task=opened.task;assert.equal(task.nativeSessionId,nativeId);assert(task.ptyId);
 await poll(async()=>(await app.output(task.ptyId)).includes(marker+'_INITIAL'),30000);
 await nativeSubmit(taskId,task.ptyId,marker+'_RESUME: Continue this exact native history, reply only. Do not use tools or access files.',marker+'_RESUMED_DONE');
 const legacy=await app.invoke('applications.session',taskId);assert(legacy.ok);assert.equal(legacy.value.selection,'unknown-history');assert(legacy.value.applications.every(a=>a.fixedVersion===null),'Unknown history cannot acquire fixed current app');
 const resumedRequests=result.requests.filter(r=>r.kind==='resumed');assert(resumedRequests.length);assert(resumedRequests.every(r=>r.toolNames.every(n=>!String(n).startsWith('mcp__wy_'))&&r.managedSkillNames.length===0));
 assert.equal(sql("SELECT runtime_snapshot FROM tasks WHERE id='"+taskId+"'")[0].runtime_snapshot,null);const held=sql("SELECT schema_version,legacy_status FROM capability_session_snapshots WHERE task_id='"+taskId+"'");assert.deepEqual(held,[{schema_version:0,legacy_status:'history-unknown'}]);
 result.resumed={task:await app.invoke('tasks.get',taskId),diagnostic:legacy.value,held};assert.equal(result.resumed.task.nativeSessionId,nativeId);checked('Actual interactive Codex resumed original native ID with NULL persisted capability pointer and no M10 tool/Skill injection despite enabled project Mail');
 await app.invoke('tasks.kill',taskId);
 stage='fresh-current-session';const created=await app.invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:marker+'_FRESH: Reply only; no tools, file changes, or sending.',cols:100,rows:30});freshTask=created.task;result.freshTaskId=freshTask.id;
 await poll(async()=>{freshTask=await app.invoke('tasks.get',freshTask.id);return freshTask.ptyId&&freshTask.nativeSessionId&&(await app.output(freshTask.ptyId)).includes(marker+'_FRESH_DONE');},60000);assert.notEqual(freshTask.nativeSessionId,nativeId);assert.notEqual(freshTask.id,taskId);
 const fresh=await app.invoke('applications.session',freshTask.id);assert(fresh.ok);assert.equal(fresh.value.selection,'fixed');assert.equal(fresh.value.applications.find(a=>a.appId==='mail').fixedVersion,'1.0.4');assert(result.requests.some(r=>r.kind==='fresh'&&r.toolNames.some(n=>String(n).startsWith('mcp__wy_'))));
 const retained=await app.invoke('applications.session',taskId);assert(retained.ok);assert.equal(retained.value.selection,'unknown-history');assert.equal(sql("SELECT runtime_snapshot FROM tasks WHERE id='"+taskId+"'")[0].runtime_snapshot,null);result.fresh={task:freshTask,diagnostic:fresh.value,oldAfterNew:retained.value};
 const historyAfter=await readFile(history);assert(historyAfter.subarray(0,historyBefore.length).equals(historyBefore));assert(historyAfter.includes(Buffer.from(marker+'_RESUME')));result.nativeHistory.afterSha256=hash(historyAfter);result.nativeHistory.afterBytes=historyAfter.length;checked('Separate current task receives new native ID and fixed Mail1.0.4 while original history stays unknown and original native log bytes remain an exact prefix');
 assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);assert.deepEqual(app.rendererErrors,[]);assert.equal(sql('SELECT count(*) n FROM mail_drafts')[0].n,0);assert.equal(result.asar,hash(await readFile(join(appRoot,'Contents/Resources/app.asar'))));checked('Private base configuration and package bytes unchanged, no draft or external write produced');result.status='passed-partial';
 result.remaining=['T62 prototype/UI checks and full original-step audit remain','Native history fixture is real headless initial execution; the tested resume is actual interactive Codex through packaged TaskService, not a headless replacement','No real model, Claude, native dialog or SMTP pass'];
}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=1;}
finally{
 if(app){for(const id of [task?.id,freshTask?.id].filter(Boolean))try{await app.invoke('tasks.kill',id);}catch{}await writeFile(join(root,'final-host.log'),app.logs());if(task?.ptyId)try{await writeFile(join(root,'final-terminal.txt'),await app.output(task.ptyId));}catch{}result.rendererErrors=app.rendererErrors;await app.close();result.ownAppCleanupComplete=true;}
 for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
