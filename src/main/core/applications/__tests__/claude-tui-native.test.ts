import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {expect,it,vi} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {PtyManager} from '../../../pty-manager';
import {ProjectService} from '../../projects/project-service';
import {AiProfileService} from '../../ai/ai-profile-service';
import {CapabilityService} from '../../capabilities/capability-service';
import {TaskService} from '../../tasks/task-service';
import {claudeSessionFile} from '../../tasks/native-sessions';
import {ResourceStore} from '../resource-store';
import {AgentSupportService} from '../agent-support-service';
import {ApplicationService} from '../application-service';
import {ManagedTaskCapabilities} from '../task-capability-launcher';
import {MacProcessIdentityReader} from '../process-identity';
import {fixture as pluginFixture} from '../plugins/__tests__/fixture';
import {digest} from '../manifest';
import {pluginMcpToolName} from '../plugins/session-tools';
import {loopbackMessages} from './fixtures/loopback-messages';

/** Real native TUI permission check with fixed localhost Messages and private
 * data. No print/bare/allowedTools, App main, desktop install or real model.
 */
it.runIf(process.platform==='darwin'&&!!process.env.WILLYOU_P1_CLAUDE_TUI_BINARY)('asks for native MCP permission by default, refuses without plugin execution, then permits an explicit retry',async()=>{
 const root=realpathSync(mkdtempSync('/private/tmp/willyou-m13-native-claude-tui-')),home=join(root,'home'),cwd=join(root,'project'),config=join(home,'.claude');mkdirSync(home);mkdirSync(cwd);mkdirSync(join(cwd,'.git'));mkdirSync(config);
 const binary=realpathSync(process.env.WILLYOU_P1_CLAUDE_TUI_BINARY!),key='p1-synthetic-not-a-real-key',model=await loopbackMessages(root,{P1_CLAUDE_B:'P1 Claude 0.1.0'});
 writeFileSync(join(config,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,theme:'dark',lastOnboardingVersion:'2.1.322',customApiKeyResponses:{approved:[key.slice(-20)],rejected:[]},projects:{[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}}));
 const sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);const db=drizzle(sqlite,{schema});
 const secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets),profiles=new AiProfileService(db,secrets);
 const projectId=projects.createProject({name:'P1 default native approval fixture',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;
 const env={CLAUDE_CONFIG_DIR:config,ANTHROPIC_BASE_URL:model.url,ANTHROPIC_API_KEY:key,ANTHROPIC_MODEL:'synthetic-p1',ANTHROPIC_DEFAULT_SONNET_MODEL:'synthetic-p1',ANTHROPIC_DEFAULT_OPUS_MODEL:'synthetic-p1',ANTHROPIC_DEFAULT_HAIKU_MODEL:'synthetic-p1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
 const profileId=profiles.create({name:'P1 default Claude TUI',runner:'claude',executable:binary,args:['--permission-mode','default','--model','synthetic-p1'],env:Object.entries(env).map(([name,value])=>({name,value,secret:name==='ANTHROPIC_API_KEY'})),color:null,isDefault:true}).id;
 const capabilities=new CapabilityService({db,projects,secrets,userData:root}),ptys=new PtyManager(),reader=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),support=new AgentSupportService(new ResourceStore(sqlite,root),capabilities,resolve('out/capability-bundles-compatibility-v1'));
 let applications:ApplicationService|undefined,managed:ManagedTaskCapabilities|undefined,tasks:TaskService|undefined,created:Awaited<ReturnType<TaskService['create']>>|undefined,terminal='',passed=false;
 const evidence:Record<string,unknown>={schema:1,root,home,cwd,config,binaryHash:digest(readFileSync(binary)),actualNativeClaude:true,actualPty:true,mode:'regular native TUI, default permission, no preapproved MCP tools',packagedApp:false,realModel:false,copyDailyAuth:false,stage:'prepare',events:[]};
 const save=()=>{const path=process.env.WILLYOU_P1_CLAUDE_TUI_EVIDENCE;if(path){if(!path.startsWith('/private/tmp/willyou-m13-'))throw Error('Private evidence required');writeFileSync(path,JSON.stringify({...evidence,terminal},null,2)+'\n');}};
 const spawn=ptys.spawn.bind(ptys);vi.spyOn(ptys,'spawn').mockImplementation(options=>{evidence.launch={command:options.command,args:options.args,cwd:options.cwd,rows:options.rows,cols:options.cols};save();return spawn(options);});
 // This software-only driver models its own focused terminal. The real xterm
 // replies to DECSET1004 with ESC[I or ESC[O; no desktop/DOM focus is claimed.
 ptys.on('data',(id:string,data:string)=>{terminal+=data;appendFileSync(join(root,'terminal.raw'),data);if(data.includes('\x1b[?1004h')){(evidence.events as unknown[]).push({at:new Date().toISOString(),reason:'Software fixture: standard focus-in response to native DECSET1004; not OS/DOM focus evidence',data:'\x1b[I'});ptys.write(id,'\x1b[I');}save();});
 const clean=(start=0)=>terminal.slice(start).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'');
 const rows=()=>sqlite.prepare('SELECT run_id,kind,state,pid,process_started_at FROM capability_run_processes ORDER BY rowid').all();
 const wait=(check:()=>void,timeout=15000)=>vi.waitFor(check,{timeout,interval:50});
 const send=(data:string,reason:string)=>{expect(created).toBeDefined();(evidence.events as unknown[]).push({at:new Date().toISOString(),reason,data});save();ptys.write(created!.ptyId,data);};
 const observeTerminal=(stage:string)=>{
  if(!created)return;const native=(ptys as unknown as {ptys:Map<string,{pid:number;ptsName:string}>}).ptys.get(created.ptyId);if(!native||native.pid!==ptys.nativePid(created.ptyId)||!/^\/dev\/ttys[0-9]+$/.test(native.ptsName))throw Error('Exact owned native PTY required');
  const run=(command:string,args:string[])=>{const result=spawnSync(command,args,{encoding:'utf8',timeout:3000,maxBuffer:16384,env:{PATH:'/usr/bin:/bin'}});return{command,args,code:result.status,signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr};};
  const result={stage,pid:native.pid,tty:native.ptsName,process:run('/bin/ps',['-p',String(native.pid),'-o','pid=,ppid=,pgid=,tpgid=,tty=,stat=']),attributes:run('/bin/stty',['-f',native.ptsName,'-a'])};((evidence.terminalObservations??=[]) as unknown[]).push(result);save();
 };
 try{
  await support.initialize();tasks=new TaskService({db,ptys,profiles,projects,capabilities,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TERM:'xterm-256color'}),onChanged:()=>{}});
  applications=new ApplicationService(support.store,{secrets,projects,tasks,activePty:id=>tasks!.activePty(id),requireSender:()=>{},mailWorker:join(root,'unused'),foxmailNative:join(root,'unused'),processes:reader,plugins:{processes:reader,runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[home]}}});await applications.recover();
  managed=await ManagedTaskCapabilities.open(support,capabilities,applications,{helper:resolve('out/native/willyou-process-identity'),processes:reader,stopPty:id=>ptys.kill(id),pollMs:30});tasks.attachManagedCapabilities(managed);
  const f=pluginFixture();f.manifest.permissions=[];f.manifest.providers=[];f.manifest.capabilities['demo-tracker.items.list'].slots=[];Object.assign(f.manifest,{skills:['skills']});f.files.set('skills/query/SKILL.md',Buffer.from('---\nname: query\ndescription: Native default permission fixture\n---\nP1_CLAUDE_SKILL_V1\n{{WILLYOU_APPLICATION}}\n{{WILLYOU_ENTRYPOINTS}}\n'));
  f.files.set('runtime/main.mjs',Buffer.from(`import readline from 'node:readline';import{appendFileSync}from'node:fs';import{join}from'node:path';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method!=='initialize')appendFileSync(join(process.env.WILLYOU_PLUGIN_DATA,'executions.log'),'executed\\n');process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:'0.1.0'}:{items:[{id:'synthetic',title:'P1 Claude 0.1.0'}]}})+'\\n');});`));
  const dir=join(root,'fixture');for(const[path,bytes]of f.bundle()){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);}const inspected=await applications.plugins!.inspect('software-fixture',dir,'directory');await applications.plugins!.install('software-fixture',inspected.token);
  created=await tasks.create({projectId,dirId:null,aiProfileId:profileId,firstMessage:''});evidence.geometry={cols:120,rows:32,reason:'Original PTY dimensions; no fake terminal device-attribute or cursor-position responses'};const stored=await managed.sessions.get(created.task.id);model.setTarget(stored.snapshot.adapterBinding.nativeToolNames[pluginMcpToolName('demo-tracker.items.list')]);evidence.stage='wait-native-prompt';evidence.runId=created.task.runtimeSnapshot!.runId;save();
  await wait(()=>expect(clean()).toMatch(/for shortcuts|Try "|❯|Do you trust/));
  // Only a positively identified trust prompt for this new empty fixture may
  // be accepted. No catch-all prompt answering or user configuration changes.
  if(clean().includes('Do you trust the files in this folder?')){send('\r','trust this private empty fixture');await wait(()=>expect(clean()).toMatch(/for shortcuts|Try "/));}
  const begin=terminal.length;send('\x1b[200~P1_CLAUDE_A\x1b[201~','submit fixed local-protocol prompt');await wait(()=>expect(clean(begin)).toContain('P1_CLAUDE_A'));send('\r','native submit');evidence.stage='wait-native-MCP-approval';save();
  await wait(()=>expect(clean(begin).replace(/\s+/g,'')).toContain('Doyouwanttoproceed?'),20000);
  evidence.firstApproval=clean(begin);expect(sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:0});
  observeTerminal('before-native-MCP-decision');
  expect(clean(begin).replace(/\s+/g,'')).toContain('Tool:(MCP)');expect(clean(begin)).toContain('Esc to cancel');send('\x1b','reject the exact MCP request with its documented native Escape action (A1 TUI driver)');
  // Native rejection may end the turn without another model request. Its own
  // persisted tool_result, not a fabricated peer completion, proves rejection.
  const nativeReceipt=(callId:string)=>{
    const file=claudeSessionFile(config,cwd,created!.task.nativeSessionId!,false);if(!file)return undefined;
    return readFileSync(file,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).flatMap(row=>Array.isArray(row.message?.content)?row.message.content:[]).find(block=>block.type==='tool_result'&&block.tool_use_id===callId);
  };
  await wait(()=>expect(nativeReceipt('toolu_P1_CLAUDE_A')).toMatchObject({is_error:true}));expect(sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:0});expect(existsSync(join(applications.plugins!.lifecycle.dataDirectory('demo-tracker'),'executions.log'))).toBe(false);evidence.deniedNativeReceipt=nativeReceipt('toolu_P1_CLAUDE_A');evidence.deniedHostCount=0;evidence.deniedPluginExecutions=0;
  evidence.stage='native-denial-verified';save();
  // The accepted retry uses a fresh fixed peer marker/tool id in the same
  // running task. A missing read receipt must never be treated as success.
  const second=terminal.length;send('\x1b[200~P1_CLAUDE_B\x1b[201~','submit second fixed prompt');await wait(()=>expect(clean(second)).toContain('P1_CLAUDE_B'));send('\r','native retry submit');
  await wait(()=>expect(clean(second).replace(/\s+/g,'')).toContain('Doyouwanttoproceed?'),20000);evidence.secondApproval=clean(second);expect(clean(second).replace(/\s+/g,'')).toContain('Tool:(MCP)');expect(clean(second).replace(/\s+/g,'')).toContain('❯1.Yes');send('\r','confirm visibly selected native Yes for this exact synthetic read');
  await wait(()=>expect(sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:1}));await wait(()=>expect(model.outputs.get('P1_CLAUDE_B')).toContain('P1 Claude 0.1.0'));await wait(()=>expect(clean(second)).toContain('P1_CLAUDE_B_DONE'));expect(readFileSync(join(applications.plugins!.lifecycle.dataDirectory('demo-tracker'),'executions.log'),'utf8')).toBe('executed\n');evidence.allowedOutput=model.outputs.get('P1_CLAUDE_B');evidence.allowedNativeReceipt=nativeReceipt('toolu_P1_CLAUDE_B');evidence.allowedHostCount=1;evidence.allowedPluginExecutions=1;evidence.stage='verified';passed=true;
 }catch(error){evidence.failure={message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined};throw error;}
 finally{
  evidence.model={requests:model.requests,outputs:Object.fromEntries(model.outputs),failures:model.failures};evidence.rowsBeforeCleanup=rows();const cleanup:Record<string,unknown>={};
  try{if(created)tasks?.kill(created.task.id);tasks?.dispose();await applications?.dispose();await managed?.dispose();await wait(()=>expect(ptys.count).toBe(0),6000);cleanup.ptys=ptys.count;cleanup.rows=rows();}catch(error){cleanup.error=String(error);passed=false;}finally{capabilities.dispose();await model.close();}
  evidence.cleanup=cleanup;evidence.status=passed?'passed':'failed';save();sqlite.close();vi.restoreAllMocks();expect(cleanup).not.toHaveProperty('error');
 }
},90000);
