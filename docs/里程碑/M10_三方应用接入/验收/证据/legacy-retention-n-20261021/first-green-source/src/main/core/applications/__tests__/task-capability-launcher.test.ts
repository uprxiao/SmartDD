import {PtyAccess} from '../../../pty-access';
import {APPLICATION_SKILL_EXAMPLES} from '@shared/application-terminal';
import type {ApplicationUiSender} from '../execution-context';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {parse as parseToml} from 'smol-toml';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import type {SpawnOptions} from '../../../pty-manager';
import {ProjectService} from '../../projects/project-service';
import {AiProfileService} from '../../ai/ai-profile-service';
import {CapabilityService,MCP_CAPABILITY} from '../../capabilities/capability-service';
import {TaskService,type PtyHost} from '../../tasks/task-service';
import {ResourceStore} from '../resource-store';
import {AgentSupportService} from '../agent-support-service';
import {ApplicationService} from '../application-service';
import {ManagedTaskCapabilities} from '../task-capability-launcher';
import {FixtureProcessReader} from './run-fixture';
import {PtyManager} from '../../../pty-manager';
import {MacProcessIdentityReader} from '../process-identity';
import {encodeClaudeDir} from '../../tasks/native-sessions';
import {ApplicationToolService} from '../tool-service';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
let root:string,home:string,cwd:string,sqlite:Database.Database,capabilities:CapabilityService,support:AgentSupportService,applications:ApplicationService,managed:ManagedTaskCapabilities,tasks:TaskService,projects:ProjectService,profiles:AiProfileService,reader:FixtureProcessReader,ptys:TestPtys,projectId:string,codexId:string,claudeId:string;
let expectedDisposeError:unknown;
class TestPtys extends EventEmitter implements PtyHost{
 readonly live=new Map<string,number>();readonly launches:SpawnOptions[]=[];
 spawn(options:SpawnOptions){this.launches.push(options);const pid=31000+this.launches.length;this.live.set(options.id!,pid);reader.identities.set(pid,'darwin-proc-v1:300:'+pid);return options.id!;}
 nativePid(id:string){return this.live.get(id)??null;}
 kill(id:string){const pid=this.live.get(id);if(pid){reader.identities.delete(pid);this.live.delete(id);this.emit('exit',id,0);}}
}
beforeEach(async()=>{
 expectedDisposeError=undefined;root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-launch-')));home=join(root,'home');cwd=join(root,'project');mkdirSync(home);mkdirSync(cwd);mkdirSync(join(cwd,'.git'));
 sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});projects=new ProjectService(db,secrets);profiles=new AiProfileService(db,secrets);projectId=projects.createProject({name:'isolated production composition',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;
 // Only this private, harmless version fixture is executed. It does not emulate a native Agent session.
 const command=join(root,'version-fixture');writeFileSync(command,'#!/bin/sh\ncase "$1" in --version) echo "0.162.1";; *) exit 70;; esac\n',{mode:0o700});
 codexId=profiles.create({name:'Codex version fixture',runner:'codex',executable:command,args:[],env:[],color:null,isDefault:true}).id;
 const cc=join(root,'cc-version-fixture');writeFileSync(cc,'#!/bin/sh\ncase "$1" in --version) echo "2.1.303 (Claude Code)";; *) exit 70;; esac\n',{mode:0o700});claudeId=profiles.create({name:'CC version fixture',runner:'claude',executable:cc,args:[],env:[],color:null,isDefault:false}).id;
 capabilities=new CapabilityService({db,projects,secrets,userData:root});support=new AgentSupportService(new ResourceStore(sqlite,root),capabilities,resolve('out/capability-bundles'));await support.initialize();expect(support.status().state).toBe('ready');reader=new FixtureProcessReader();ptys=new TestPtys();tasks=new TaskService({db,ptys,profiles,projects,capabilities,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin'}),onChanged:()=>{}});
 applications=new ApplicationService(support.store,{secrets,projects,tasks,activePty:id=>tasks.activePty(id),requireSender:()=>{},mailWorker:join(root,'unused-worker'),foxmailNative:join(root,'unused-native'),processes:reader});await applications.recover();managed=await ManagedTaskCapabilities.open(support,capabilities,applications,{helper:join(root,'unused-helper'),processes:reader,peers:{read:async()=>null},stopPty:id=>ptys.kill(id),pollMs:20});tasks.attachManagedCapabilities(managed);
});
afterEach(async()=>{tasks?.dispose();for(const id of ptys?.live?.keys()??[])ptys.kill(id);await applications?.dispose();try{await managed?.dispose();}catch(error){if(error!==expectedDisposeError)throw error;}capabilities?.dispose();sqlite?.close();rmSync(root,{recursive:true,force:true});});
const create=(id=codexId)=>tasks.create({projectId,dirId:null,aiProfileId:id,firstMessage:''});
const consumers=()=>readdirSync(join(home,'.agents/smartdd-runtime/catalog-consumers'));
describe('production ManagedTaskCapabilities composed with actual TaskService and local services',()=>{
 it.each(['claude-code','codex'] as const)('registers native input provenance using the current verified %s launch version and owned run signal',async runner=>{
  const register=vi.spyOn(applications.nativeMessages,'register'),first=await create(runner==='codex'?codexId:claudeId),runId=first.task.runtimeSnapshot!.runId,context=managed.runs.assertActive(runId);
  expect(register).toHaveBeenCalledWith(runId,runner==='codex'?'0.162.1':'2.1.303',context.signal);expect((await applications.nativeMessages.read(runId)).messages).toEqual([]);
  tasks.kill(first.task.id);await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopped'));expect((await applications.nativeMessages.read(runId)).messages).toEqual([]);expect(sqlite.prepare('SELECT * FROM mail_user_action_sources').all()).toEqual([]);
 });
 it.each(['claude-code','codex'] as const)('joins the trusted home prompt to native %s user records only after owned spawn and invalidates it on stop',async runner=>{
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const sender={sender:{id:101},senderFrame:{processId:9,routingId:1}} as unknown as ApplicationUiSender,text='请查看当前邮件\n并准备具体回复',first=await tasks.create({projectId,dirId:null,aiProfileId:runner==='codex'?codexId:claudeId,firstMessage:'  '+text+'  '},sender),runId=first.task.runtimeSnapshot!.runId,initial=managed.runs.assertActive(runId),nativeId=runner==='codex'?randomUUID():first.task.id,at=new Date().toISOString();
  expect(ptys.launches[0].args.at(-1)).toBe(text);const date=new Date(),dir=runner==='codex'?join(initial.snapshot.native.stateRoot,'sessions',String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')):join(initial.snapshot.native.stateRoot,'projects',encodeClaudeDir(cwd));mkdirSync(dir,{recursive:true});
  const path=join(dir,runner==='codex'?'rollout-home-'+nativeId+'.jsonl':nativeId+'.jsonl'),record=runner==='codex'?{timestamp:at,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}}:{timestamp:at,type:'user',sessionId:nativeId,cwd,message:{role:'user',content:text}},header=runner==='codex'?JSON.stringify({type:'session_meta',payload:{id:nativeId,cwd,timestamp:at,originator:'codex_cli_rs'}})+'\n':'';writeFileSync(path,header+JSON.stringify(record)+'\n');
  if(runner==='codex')await vi.waitFor(()=>expect(tasks.get(first.task.id).nativeSessionId).toBe(nativeId),{timeout:6000});
  const context=managed.runs.assertActive(runId),matched=await applications.nativeMessages.read(runId);expect(matched).toMatchObject({status:'matched',messages:[{text,nativeSessionId:nativeId,receipt:{transport:'launch-argument',senderId:101,taskId:first.task.id}}]});expect(sqlite.prepare('SELECT * FROM mail_user_action_sources').all()).toEqual([]);
  tasks.kill(first.task.id);await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopping'));expect(applications.nativeInputs.match(context,text,Date.parse(at))).toBeNull();
  // The synthetic PTY never forks its armed bridge. Real process exit/resume is checked below.
 });
 it('does not assign home-user origin to an internal task creation without a trusted sender',async()=>{
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const observe=vi.spyOn(applications.nativeInputs,'observeLaunch'),first=await tasks.create({projectId,dirId:null,aiProfileId:claudeId,firstMessage:'internal request'});expect(observe).not.toHaveBeenCalled();expect(ptys.launches[0].args.at(-1)).toBe('internal request');expect(applications.nativeInputs.match(managed.runs.assertActive(first.task.runtimeSnapshot!.runId),'internal request',Date.now())).toBeNull();
 });
 it('does not capture a launch argument when native spawning fails',async()=>{
  const observe=vi.spyOn(applications.nativeInputs,'observeLaunch');vi.spyOn(ptys,'spawn').mockImplementationOnce(()=>{throw new Error('controlled spawn failure');});
  await expect(tasks.create({projectId,dirId:null,aiProfileId:claudeId,firstMessage:'never delivered'},{sender:{id:101},senderFrame:{processId:9,routingId:1}} as unknown as ApplicationUiSender)).rejects.toThrow('controlled spawn failure');expect(observe).not.toHaveBeenCalled();
 });
 it('clears a captured launch origin if the new task cannot be committed to SQLite',async()=>{
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const sender={sender:{id:101},senderFrame:{processId:9,routingId:1}} as unknown as ApplicationUiSender,observe=applications.nativeInputs.observeLaunch.bind(applications.nativeInputs);let captured:ReturnType<typeof applications.nativeInputs.match>=null,context:ReturnType<typeof managed.runs.assertActive>|undefined;
  vi.spyOn(applications.nativeInputs,'observeLaunch').mockImplementation((source,target,text)=>{observe(source,target,text);context=managed.runs.inputContext(target.taskId,target.ptyId)!;captured=applications.nativeInputs.match(context,text,Date.now());});
  sqlite.exec("CREATE TRIGGER fixture_task_fail BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'controlled task commit failure'); END");await expect(tasks.create({projectId,dirId:null,aiProfileId:claudeId,firstMessage:'already passed to process'},sender)).rejects.toThrow('controlled task commit failure');expect(captured).toMatchObject({transport:'launch-argument'});expect(context).toBeDefined();expect(applications.nativeInputs.match(context!,'already passed to process',Date.now())).toBeNull();
 });
 it('does not duplicate an accepted launch when optional origin observation fails',async()=>{
  vi.spyOn(applications.nativeInputs,'observeLaunch').mockImplementation(()=>{throw new Error('controlled evidence failure');});const text='single initial request',first=await tasks.create({projectId,dirId:null,aiProfileId:claudeId,firstMessage:text},{sender:{id:101},senderFrame:{processId:9,routingId:1}} as unknown as ApplicationUiSender);expect(first.task.firstMessage).toBe(text);expect(ptys.launches).toHaveLength(1);expect(ptys.launches[0].args.at(-1)).toBe(text);
 });
 it('registers all no-application Codex runs, retains fixed sources, and releases only after the owned PTY exit',async()=>{
  const first=await create(),runtime=first.task.runtimeSnapshot!,session=await managed.sessions.get(first.task.id);expect(session.snapshot.packages).toEqual([]);expect(runtime.sessionCapabilities).toEqual(session.pointer);expect(managed.runs.get(runtime.runId).state).toBe('active');expect(consumers()).toHaveLength(1);expect(ptys.launches[0].args.join('\n')).toContain('skills.config=');expect(existsSync(runtime.manifestPath)).toBe(true);
  tasks.kill(first.task.id);await vi.waitFor(()=>expect(consumers()).toEqual([]));expect(managed.runs.get(runtime.runId).state).toBe('stopped');expect(existsSync(runtime.manifestPath)).toBe(false);expect((await managed.sessions.references(first.task.id)).some(r=>r.refKind==='legacy-runtime')).toBe(true);
 });
 it('uses the same session selection and paths when project defaults change between runs',async()=>{
  const first=await create(),before=await managed.sessions.get(first.task.id);tasks.kill(first.task.id);await vi.waitFor(()=>expect(consumers()).toEqual([]));for(const skill of capabilities.list(projectId))capabilities.setEnabled(projectId,skill.id,false);
  const resumed=await tasks.open({taskId:first.task.id}),after=await managed.sessions.get(first.task.id);expect(after.pointer).toEqual(before.pointer);expect(after.snapshot.standardSkills).toEqual(before.snapshot.standardSkills);expect(resumed.task.runtimeSnapshot?.skills).toHaveLength(before.snapshot.standardSkills.length);expect(resumed.task.runtimeSnapshot?.runId).not.toBe(first.task.runtimeSnapshot?.runId);
 });
 it('retains user Skill flags and MCP names while adding a full managed selection',async()=>{
  mkdirSync(join(home,'.codex'));writeFileSync(join(home,'.codex/config.toml'),'[skills]\nconfig=[{path="/private/unchanged-user-skill",enabled=false,custom="retained"}]\n[mcp_servers.user_server]\ncommand="/usr/bin/true"\n');const source=readFileSync(join(home,'.codex/config.toml'),'utf8');
  await create();const args=ptys.launches[0].args.join('\n');expect(args).toContain('/private/unchanged-user-skill');expect(args).toContain('retained');const flags=ptys.launches[0].args.find(a=>a.startsWith('skills.config='))!;expect((parseToml(flags).skills as {config:unknown[]}).config[0]).toEqual({path:'/private/unchanged-user-skill',enabled:false,custom:'retained'});expect(args).not.toContain('mcp_servers.user_server');expect(readFileSync(join(home,'.codex/config.toml'),'utf8')).toBe(source);
 });
 it('gives Claude one stable complete plugin without registering a Codex consumer',async()=>{
  const first=await create(claudeId),session=await managed.sessions.get(first.task.id),args=ptys.launches[0].args;expect(session.snapshot.runner).toBe('claude-code');expect(args).toContain('--plugin-dir');expect(args).toContain(join(support.store.root,'sessions',first.task.id,'claude/plugin'));expect(session.snapshot.standardSkills.every(s=>existsSync(s.projectionPath))).toBe(true);expect(consumers()).toEqual([]);
  tasks.kill(first.task.id);await vi.waitFor(()=>expect(managed.runs.get(first.task.runtimeSnapshot!.runId).state).toBe('stopped'));await create();expect(consumers()).toHaveLength(1);
 });
 it('keeps the old launcher runtime occupied even with the project-context MCP disabled',async()=>{
  capabilities.setEnabled(projectId,MCP_CAPABILITY,false);const first=await create(),current=await managed.sessions.get(first.task.id),refs=await managed.sessions.references(first.task.id);expect(current.snapshot.mcp).toEqual([]);expect(refs.filter(r=>r.refKind==='legacy-runtime')).toHaveLength(1);const held=sqlite.prepare('SELECT 1 FROM capability_lease_resources lr JOIN capability_resource_leases l ON l.lease_id=lr.lease_id WHERE l.owner_id=? AND lr.resource_id=?').get(first.task.runtimeSnapshot!.runId,refs.find(r=>r.refKind==='legacy-runtime')!.refId);expect(held).toBeTruthy();
 });
 it('keeps a native Agent available on unverified profile configuration, with no managed argv or credentials',async()=>{
  mkdirSync(join(home,'.codex'));writeFileSync(join(home,'.codex/config.toml'),'profile="private-profile"\n[profiles.private-profile]\nmodel="unchanged-model"\n');const first=await create(),runtime=first.task.runtimeSnapshot!;expect(runtime.selfCheck).toMatchObject({status:'failed',issues:['AGENT_ADAPTER_UNSUPPORTED']});expect(ptys.launches[0].args.join('\n')).not.toContain('skills.config=');expect(ptys.launches[0].command).toBe(profiles.resolve(codexId).command);expect(consumers()).toHaveLength(1);expect(managed.runs.get(runtime.runId).state).toBe('active');
 });
 it('diagnoses an actual Claude plugin namespace conflict without removing the user plugin or stopping the Agent',async()=>{
  const plugin=join(root,'user-plugin');mkdirSync(join(plugin,'.claude-plugin'),{recursive:true});writeFileSync(join(plugin,'.claude-plugin/plugin.json'),JSON.stringify({name:'smartdd-session'}));const profile=profiles.create({name:'CC with real plugin namespace',runner:'claude',executable:profiles.resolve(claudeId).command,args:['--plugin-dir',plugin],env:[],color:null,isDefault:false});
  const first=await create(profile.id);expect(first.task.runtimeSnapshot?.selfCheck.issues).toEqual(['AGENT_CAPABILITY_NAME_CONFLICT']);expect(ptys.launches[0].args).toContain(plugin);expect(ptys.launches[0].args.filter(v=>v==='--plugin-dir')).toHaveLength(1);expect(existsSync(join(plugin,'.claude-plugin/plugin.json'))).toBe(true);expect(ptys.live.size).toBe(1);
 });
 it('keeps original Mail tool contracts callable without SMTP and rejects later policy revocation without stopping the CLI',async()=>{
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const first=await create(),session=await managed.sessions.get(first.task.id),runId=first.task.runtimeSnapshot!.runId,mail=session.snapshot.packages.find(p=>p.appId==='mail')!,tools=new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data));
  expect(mail.skills).toHaveLength(1);expect(session.snapshot.mcp.some(m=>m.kind==='applications')).toBe(true);expect(ptys.launches[0].args.join('\n')).toContain('--bootstrap');const table=await tools.list(runId);const draft=table.tools.find(t=>t.name.includes('draft')&&t.name.includes('list'))!;expect(draft).toBeTruthy();const value=await tools.call(runId,randomUUID(),{operation:draft.name,contractMajor:draft.contractMajor,connectionId:null,arguments:{}});expect(value.status).toBe('ok');
  await applications.selections.setGlobalEnabled('mail',false,1);const denied=await tools.call(runId,randomUUID(),{operation:draft.name,contractMajor:draft.contractMajor,connectionId:null,arguments:{}});expect(denied).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(managed.runs.get(runId).state).toBe('active');expect(ptys.live.size).toBe(1);expect((await tools.list(runId)).tools.map(t=>t.name)).toEqual(table.tools.map(t=>t.name));
  tasks.kill(first.task.id);await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopping'));expect(consumers()).toHaveLength(1);const bridge=sqlite.prepare("SELECT state,pid FROM capability_run_processes WHERE run_id=? AND kind='bridge'").get(runId);expect(bridge).toEqual({state:'armed',pid:null});
  // This controlled PTY never forks a bridge. Its intentionally unresolved fork
  // window is retained, not misreported as an actual native child exit.
 });
 it('connects the complete production launcher through a real OS PTY, kernel-owned CLI and original CJS MCP child',async()=>{
  await managed.dispose();await applications.dispose();tasks.dispose();
  const real=new PtyManager(),processes=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});
  const inputReport=join(root,'native-input.bin'),report=join(root,'native-report.json'),stop=join(root,'stop-native'),command=join(root,'native-cli-fixture'),quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'",script=resolve('src/main/core/applications/__tests__/fixtures/managed-native-cli.mjs');
  writeFileSync(command,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(script)+' "$@"\n',{mode:0o700});
  const profile=profiles.create({name:'private actual process fixture',runner:'codex',executable:command,args:[],env:[{name:'WY_M10_TEST_INPUT_REPORT',value:inputReport,secret:false},{name:'ELECTRON_RUN_AS_NODE',value:'1',secret:false},{name:'WY_M10_TEST_REPORT',value:report,secret:false},{name:'WY_M10_TEST_STOP',value:stop,secret:false}],color:null,isDefault:false});
  for(const skill of capabilities.list(projectId))capabilities.setEnabled(projectId,skill.id,false);capabilities.setEnabled(projectId,MCP_CAPABILITY,false);
  tasks=new TaskService({db,ptys:real,profiles,projects,capabilities,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin',SHELL:'/bin/sh'}),onChanged:()=>{}});
  const frame={processId:9,routingId:1},sender={sender:{id:101,mainFrame:frame,isDestroyed:()=>false},senderFrame:frame} as unknown as ApplicationUiSender;
  const access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:id=>tasks.activePty(id),alive:id=>real.has(id),write:(id,data)=>real.writeControlled(id,data),resize:()=>{},killTask:()=>{}});
  applications=new ApplicationService(support.store,{secrets,projects,tasks,activePty:id=>tasks.activePty(id),terminal:{access,bracketedPaste:id=>real.bracketedPaste(id),write:(id,data)=>real.writeControlled(id,data)},requireSender:e=>access.requireSender(e),mailWorker:join(root,'unused-worker'),foxmailNative:join(root,'unused-native'),processes});await applications.recover();
  managed=await ManagedTaskCapabilities.open(support,capabilities,applications,{helper:resolve('out/native/willyou-process-identity'),stopPty:id=>real.kill(id),pollMs:20});tasks.attachManagedCapabilities(managed);
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const oldShell=process.env.SHELL;process.env.SHELL='/bin/sh';let transcript='';real.on('data',(_id,data)=>{transcript+=data;});
  try{
   const homePrompt='真实启动首条问题\n仅准备草稿内容',first=await tasks.create({projectId,dirId:null,aiProfileId:profile.id,firstMessage:homePrompt},sender),runId=first.task.runtimeSnapshot!.runId;
   await vi.waitFor(()=>expect(existsSync(report),transcript).toBe(true),{timeout:10000});const observed=JSON.parse(readFileSync(report,'utf8')) as {cliPid:number;bridgePid:number;initialArgument:string;result:{isError?:boolean}};
   expect(observed.initialArgument).toBe(homePrompt);
   const nativeId=randomUUID(),date=new Date(),nativeRoot=managed.runs.assertActive(runId).snapshot.native.stateRoot,folder=join(nativeRoot,'sessions',String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')),nativeAt=new Date().toISOString();mkdirSync(folder,{recursive:true});
   writeFileSync(join(folder,'rollout-actual-argv-'+nativeId+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:nativeId,cwd,timestamp:nativeAt,originator:'codex_cli_rs'}})+'\n'+JSON.stringify({timestamp:nativeAt,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:observed.initialArgument}]}})+'\n');
   await vi.waitFor(()=>expect(tasks.get(first.task.id).nativeSessionId).toBe(nativeId),{timeout:6000});const homeSource=(await applications.nativeMessages.read(runId)).messages[0];expect(homeSource).toMatchObject({text:homePrompt,receipt:{transport:'launch-argument',senderId:101}});expect(await applications.nativeMessages.verify(homeSource)).toBe(true);
   expect(observed.result.isError).not.toBe(true);expect(managed.runs.get(runId).pid).toBe(observed.cliPid);const child=sqlite.prepare("SELECT state,pid FROM capability_run_processes WHERE run_id=? AND kind='bridge'").get(runId);expect(child).toEqual({state:'active',pid:observed.bridgePid});expect(consumers()).toHaveLength(1);
   const diagnostic=await applications.sessionDiagnostics.inspect(first.task.id);expect(diagnostic.currentRun).toMatchObject({id:runId,current:true,preparation:{state:'prepared',cliVersion:'0.162.1'},bridge:{connected:true,observedAt:expect.any(String)}});expect(diagnostic.applications.find(a=>a.appId==='mail')).toMatchObject({fixedVersion:'1.0.0',resourceState:'verified',evidence:{skillDiscovery:'unverified',skillRead:'unverified',toolRequests:1,successfulToolRequests:1}});
   const target={taskId:first.task.id,ptyId:first.ptyId},source={kind:'skill' as const,appId:'mail' as const,skillId:'work-assistant'};
   await expect(applications.bindTerminal(sender,{projectId:'different-project',target,source})).rejects.toMatchObject({code:'SCOPE_DENIED'});
   await expect(applications.bindTerminal(sender,{projectId,target,source:{...source,skillId:'not-in-original-package'}})).rejects.toMatchObject({code:'SCOPE_DENIED'});
   const untouched=join(root,'other-pty-input.bin'),otherPty=randomUUID();real.spawn({id:otherPty,command:process.execPath,args:['-e',"const fs=require('fs');fs.writeFileSync(process.argv[1],'',{flag:'wx'});process.stdin.setRawMode(true);process.stdin.on('data',data=>fs.appendFileSync(process.argv[1],data));process.stdin.resume();",untouched],cwd:home,env:{HOME:home,PATH:'/usr/bin:/bin',ELECTRON_RUN_AS_NODE:'1'}});await vi.waitFor(()=>expect(existsSync(untouched)).toBe(true));
   real.writeControlled(first.ptyId,'existing-prefix ');await vi.waitFor(()=>expect(readFileSync(inputReport,'utf8')).toBe('existing-prefix '));
   const binding=await applications.bindTerminal(sender,{projectId,target,source}),request={bindingId:binding.id,operationId:randomUUID()};
   const inserted=await applications.insertTerminal(sender,request);expect(inserted).toMatchObject({state:'inserted',bracketed:false});expect(await applications.insertTerminal(sender,request)).toEqual(inserted);
   const expected='existing-prefix '+APPLICATION_SKILL_EXAMPLES['mail:work-assistant'];await vi.waitFor(()=>expect(readFileSync(inputReport,'utf8')).toBe(expected));expect(readFileSync(inputReport).includes(13)).toBe(false);expect(readFileSync(inputReport).includes(10)).toBe(false);
   expect(readFileSync(untouched).length).toBe(0);expect(real.has(otherPty)).toBe(true);
   const content={mode:'new' as const,sourceMessageRef:null,senderConnectionId:null,to:['private@example.test'],cc:[],bcc:[],subject:'private draft reference',text:'body',html:null,inReplyTo:null,references:[],attachmentIds:[]};
   const draft=await applications.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.draft.fixture',operations:['mail.draft'],semantics:'write'},async context=>applications.drafts.create(applications.contexts.actor(context),{operationId:randomUUID(),content}));
   await expect(applications.bindTerminal(sender,{projectId,target,source:{kind:'draft',draftId:draft.id,revision:draft.revision,contentHash:'0'.repeat(64)}})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
   const draftBinding=await applications.bindTerminal(sender,{projectId,target,source:{kind:'draft',draftId:draft.id,revision:draft.revision,contentHash:draft.contentHash}});
   await applications.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.draft.fixture',operations:['mail.draft'],semantics:'write'},async context=>applications.drafts.update(applications.contexts.actor(context),{operationId:randomUUID(),draftId:draft.id,expectedRevision:draft.revision,content:{...content,text:'new revision'}}));
   await expect(async()=>applications.insertTerminal(sender,{bindingId:draftBinding.id,operationId:randomUUID()})).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect(readFileSync(inputReport,'utf8')).toBe(expected);expect(readFileSync(untouched).length).toBe(0);
   expect(sqlite.prepare('SELECT COUNT(*) AS n FROM mail_send_grants').get()).toEqual({n:0});
   const revoked=await applications.bindTerminal(sender,{projectId,target,source});await applications.selections.setGlobalEnabled('mail',false,1);
   await expect(async()=>applications.insertTerminal(sender,{bindingId:revoked.id,operationId:randomUUID()})).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(readFileSync(inputReport,'utf8')).toBe(expected);expect(real.has(first.ptyId)).toBe(true);
   writeFileSync(stop,'owned fixture exit');await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopped'),{timeout:10000});await vi.waitFor(()=>expect(consumers()).toEqual([]));expect(existsSync(first.task.runtimeSnapshot!.manifestPath)).toBe(false);
   expect(await applications.nativeMessages.verify(homeSource)).toBe(false);await applications.selections.setGlobalEnabled('mail',true,2);for(const path of [report,inputReport,stop])rmSync(path);
   const resumed=await tasks.open({taskId:first.task.id}),nextRun=resumed.task.runtimeSnapshot!.runId;expect(nextRun).not.toBe(runId);await vi.waitFor(()=>expect(existsSync(report),transcript).toBe(true),{timeout:10000});const second=JSON.parse(readFileSync(report,'utf8')) as {initialArgument:string;result:{isError?:boolean}};expect(second.result.isError).not.toBe(true);expect(second.initialArgument).toBe(nativeId);expect(second.initialArgument).not.toBe(homePrompt);expect((await applications.nativeMessages.read(nextRun)).messages).toEqual([]);expect(sqlite.prepare('SELECT COUNT(*) AS n FROM mail_send_grants').get()).toEqual({n:0});
   if(process.env.WY_M10_INPUT_EVIDENCE_ROOT){const dir=process.env.WY_M10_INPUT_EVIDENCE_ROOT;mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'actual-argv-and-resume.json'),JSON.stringify({layer:'actual OS PTY/kernel/native MCP with synthetic CLI and native user JSON',initial:{taskId:first.task.id,runId,ptyId:first.ptyId,cliPid:observed.cliPid,bridgePid:observed.bridgePid,argument:observed.initialArgument,source:homeSource},resumed:{runId:nextRun,ptyId:resumed.ptyId,cliPid:managed.runs.get(nextRun).pid,argument:second.initialArgument,nativeUserMatches:0},sendGrants:0,actualAgents:false})+'\n',{flag:'wx',mode:0o600});}
   writeFileSync(stop,'owned resumed fixture exit');await vi.waitFor(()=>expect(managed.runs.get(nextRun).state).toBe('stopped'),{timeout:10000});await vi.waitFor(()=>expect(consumers()).toEqual([]));

  }finally{tasks.dispose();real.killAll();if(oldShell===undefined)delete process.env.SHELL;else process.env.SHELL=oldShell;}
 },30000);
 it('opens genuine no-snapshot Codex history with every managed Skill disabled and no application bridge',async()=>{
  const first=await create();tasks.kill(first.task.id);await vi.waitFor(()=>expect(consumers()).toEqual([]));
  const id=randomUUID(),stamp=Date.now();drizzle(sqlite,{schema}).insert(schema.tasks).values({id,projectId,cwd,aiProfileId:codexId,aiProfileName:'historical fixture',runner:'codex',nativeSessionId:'old-owned-native',title:'old history',firstMessage:'',runtimeSnapshot:null,configVersion:0,stateRoot:join(home,'.codex'),createdAt:stamp,updatedAt:stamp}).run();
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const opened=await tasks.open({taskId:id}),runId=opened.task.runtimeSnapshot!.runId,argv=ptys.launches.at(-1)!.args,flags=argv.find(a=>a.startsWith('skills.config='))!;
  expect((parseToml(flags).skills as {config:{enabled:boolean}[]}).config.every(item=>item.enabled===false)).toBe(true);expect(argv.join('\n')).not.toContain('--bootstrap');expect(argv.join('\n')).not.toContain('mcp_servers.');expect(opened.task.runtimeSnapshot?.selfCheck.issues).toEqual(['HISTORY_CAPABILITIES_UNKNOWN']);expect(()=>managed.runs.assertActive(runId)).toThrow('不签发');expect(managed.runs.inputContext(id,opened.ptyId)).toBeNull();expect(consumers()).toHaveLength(1);
  await new Promise<void>(done=>setTimeout(done,250));expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id)).toEqual({runtime_snapshot:null});tasks.kill(id);await vi.waitFor(()=>expect(consumers()).toEqual([]));expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id)).toEqual({runtime_snapshot:null});expect(sqlite.prepare('SELECT schema_version,retention_state FROM capability_session_snapshots WHERE task_id=?').get(id)).toEqual({schema_version:0,retention_state:'hold'});
 });
 it('preserves old M4 metadata byte-for-byte during a guarded open, self-check, native ID discovery and exit',async()=>{
  const id=randomUUID(),stamp=Date.now(),previous=JSON.stringify({runId:randomUUID(),projectId,configVersion:1,configHash:'a'.repeat(64),manifestPath:join(root,'old-run/manifest.json'),auditPath:join(root,'old-audit.jsonl'),skills:[],mcp:[],selfCheck:{status:'passed',issues:[],at:stamp}});drizzle(sqlite,{schema}).insert(schema.tasks).values({id,projectId,cwd,aiProfileId:codexId,aiProfileName:'old M4 fixture',runner:'codex',nativeSessionId:null,title:'old M4 metadata',firstMessage:'',runtimeSnapshot:previous,configVersion:1,stateRoot:join(home,'.codex'),createdAt:stamp,updatedAt:stamp}).run();
  const opened=await tasks.open({taskId:id}),date=new Date(),folder=join(home,'.codex/sessions',String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0'));mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'rollout-private-history-native.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'history-native-verified',cwd,timestamp:new Date(Date.now()+50).toISOString(),originator:'codex_cli_rs'}})+'\n');
  await vi.waitFor(()=>expect(tasks.get(id).nativeSessionId).toBe('history-native-verified'),{timeout:4000});expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id)).toEqual({runtime_snapshot:previous});tasks.kill(id);await vi.waitFor(()=>expect(managed.runs.get(opened.task.runtimeSnapshot!.runId).state).toBe('stopped'));expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id)).toEqual({runtime_snapshot:previous});
 });
 it.each(['claude-code','codex'] as const)('retains verified original %s M4 sources during guarded resume without claiming migration complete',async runner=>{
  const id=randomUUID(),nativeSessionId=randomUUID(),stamp=Date.now(),original=capabilities.prepare({projectId,taskId:id,runner:runner==='codex'?'codex':'claude',cwd,home,profileArgs:[]}),raw=JSON.stringify(original.snapshot,null,2),stateRoot=join(home,runner==='codex'?'.codex':'.claude');
  drizzle(sqlite,{schema}).insert(schema.tasks).values({id,projectId,cwd,aiProfileId:runner==='codex'?codexId:claudeId,runner:runner==='codex'?'codex':'claude',nativeSessionId,title:'real original M4 producer fixture',runtimeSnapshot:raw,configVersion:original.snapshot.configVersion,stateRoot,createdAt:stamp,updatedAt:stamp}).run();
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const opened=await tasks.open({taskId:id}),record=sqlite.prepare('SELECT source_record_json,state,evidence_json FROM capability_legacy_migration_preparations WHERE task_id=?').get(id) as {source_record_json:string;state:string;evidence_json:string};
  expect(record).toMatchObject({source_record_json:raw,state:'prepared'});expect(JSON.parse(record.evidence_json)).toMatchObject({taskId:id,runner,runtimeHash:capabilities.runtimeIdentity().hash});expect(sqlite.prepare('SELECT COUNT(*) n FROM capability_session_refs WHERE task_id=?').get(id)).toEqual({n:3});
  expect(managed.legacyPreparationWarnings.has(id)).toBe(false);expect(ptys.launches.at(-1)!.args.join('\n')).not.toContain('--bootstrap');expect(()=>managed.runs.assertActive(opened.task.runtimeSnapshot!.runId)).toThrow('不签发');expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id)).toEqual({runtime_snapshot:raw});
  tasks.kill(id);await vi.waitFor(()=>expect(managed.runs.get(opened.task.runtimeSnapshot!.runId).state).toBe('stopped'));expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id)).toEqual({runtime_snapshot:raw});expect(sqlite.prepare('SELECT state FROM capability_legacy_migration_preparations WHERE task_id=?').get(id)).toEqual({state:'prepared'});original.release();
 });
 it('reports a damaged original M4 source while preserving metadata and ordinary native Agent availability',async()=>{
  const id=randomUUID(),stamp=Date.now(),original=capabilities.prepare({projectId,taskId:id,runner:'codex',cwd,home,profileArgs:[]}),raw=JSON.stringify(original.snapshot),file=original.snapshot.skills[0].path;writeFileSync(file,'damaged original private projection');
  drizzle(sqlite,{schema}).insert(schema.tasks).values({id,projectId,cwd,aiProfileId:codexId,runner:'codex',nativeSessionId:'old-private-native',title:'damaged original source',runtimeSnapshot:raw,configVersion:original.snapshot.configVersion,stateRoot:join(home,'.codex'),createdAt:stamp,updatedAt:stamp}).run();
  const opened=await tasks.open({taskId:id});expect(ptys.live.has(opened.ptyId)).toBe(true);expect(managed.legacyPreparationWarnings.get(id)).toBe('RESOURCE_RECOVERY_REQUIRED');expect(sqlite.prepare('SELECT * FROM capability_legacy_migration_preparations WHERE task_id=?').get(id)).toBeUndefined();expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id)).toEqual({runtime_snapshot:raw});expect(readFileSync(file,'utf8')).toBe('damaged original private projection');tasks.kill(id);await vi.waitFor(()=>expect(managed.runs.get(opened.task.runtimeSnapshot!.runId).state).toBe('stopped'));original.release();
 });
 it('does not disguise malformed nonempty history as an empty capability selection',async()=>{
  const id=randomUUID(),stamp=Date.now(),previous=JSON.stringify({unrecognized:'not permission evidence'});drizzle(sqlite,{schema}).insert(schema.tasks).values({id,projectId,cwd,aiProfileId:codexId,runner:'codex',title:'bad history',runtimeSnapshot:previous,createdAt:stamp,updatedAt:stamp}).run();await expect(tasks.open({taskId:id})).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});expect(ptys.launches).toEqual([]);expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id)).toEqual({runtime_snapshot:previous});
 });
 it('does not demote a recorded v2 session when the task loses its capability pointer',async()=>{
  const first=await create();tasks.kill(first.task.id);await vi.waitFor(()=>expect(consumers()).toEqual([]));const row=sqlite.prepare('SELECT snapshot_json,retention_state,legacy_status FROM capability_session_snapshots WHERE task_id=?').get(first.task.id),stored=JSON.parse((sqlite.prepare('SELECT runtime_snapshot AS json FROM tasks WHERE id=?').get(first.task.id) as {json:string}).json);delete stored.sessionCapabilities;const raw=JSON.stringify(stored);sqlite.prepare('UPDATE tasks SET runtime_snapshot=? WHERE id=?').run(raw,first.task.id);
  await expect(tasks.open({taskId:first.task.id})).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});expect(ptys.launches).toHaveLength(1);expect(sqlite.prepare('SELECT snapshot_json,retention_state,legacy_status FROM capability_session_snapshots WHERE task_id=?').get(first.task.id)).toEqual(row);expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(first.task.id)).toEqual({runtime_snapshot:raw});
 });
 it('revokes the private broker even if an owned PTY stop fails and retains the actual child lease',async()=>{
  const first=await create(),runId=first.task.runtimeSnapshot!.runId,stop=vi.spyOn(ptys,'kill').mockImplementationOnce(()=>{throw new Error('private owned stop failure');}),closing=managed.dispose();expect(managed.dispose()).toBe(closing);
  try{await closing;throw new Error('expected close failure');}catch(error){expectedDisposeError=error;expect(error).toMatchObject({code:'RUN_STOP_FAILED'});}finally{stop.mockRestore();}
  expect(()=>managed.broker.endpoint).toThrow('尚未启动');expect(managed.runs.get(runId).state).toBe('stopping');expect(sqlite.prepare("SELECT state FROM capability_resource_leases WHERE owner_id=? AND owner_kind='run'").get(runId)).toEqual({state:'active'});expect(ptys.live.has(first.ptyId)).toBe(true);tasks.kill(first.task.id);await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopped'));await vi.waitFor(()=>expect(consumers()).toEqual([]));
 });
 it('rejects replacing the registry after a task has begun and does not fork after an invalid pointer',async()=>{
  const first=await create();expect(()=>tasks.attachManagedCapabilities(managed)).toThrow('已经固定');tasks.kill(first.task.id);await vi.waitFor(()=>expect(consumers()).toEqual([]));const stored=JSON.parse((sqlite.prepare('SELECT runtime_snapshot AS json FROM tasks WHERE id=?').get(first.task.id) as {json:string}).json);stored.sessionCapabilities.taskId='unrelated';sqlite.prepare('UPDATE tasks SET runtime_snapshot=? WHERE id=?').run(JSON.stringify(stored),first.task.id);await expect(tasks.open({taskId:first.task.id})).rejects.toThrow('不属于');expect(ptys.launches).toHaveLength(1);
 });
});
