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
  const report=join(root,'native-report.json'),stop=join(root,'stop-native'),command=join(root,'native-cli-fixture'),quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'",script=resolve('src/main/core/applications/__tests__/fixtures/managed-native-cli.mjs');
  writeFileSync(command,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(script)+' "$@"\n',{mode:0o700});
  const profile=profiles.create({name:'private actual process fixture',runner:'codex',executable:command,args:[],env:[{name:'ELECTRON_RUN_AS_NODE',value:'1',secret:false},{name:'WY_M10_TEST_REPORT',value:report,secret:false},{name:'WY_M10_TEST_STOP',value:stop,secret:false}],color:null,isDefault:false});
  for(const skill of capabilities.list(projectId))capabilities.setEnabled(projectId,skill.id,false);capabilities.setEnabled(projectId,MCP_CAPABILITY,false);
  tasks=new TaskService({db,ptys:real,profiles,projects,capabilities,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin',SHELL:'/bin/sh'}),onChanged:()=>{}});
  applications=new ApplicationService(support.store,{secrets,projects,tasks,activePty:id=>tasks.activePty(id),requireSender:()=>{},mailWorker:join(root,'unused-worker'),foxmailNative:join(root,'unused-native'),processes});await applications.recover();
  managed=await ManagedTaskCapabilities.open(support,capabilities,applications,{helper:resolve('out/native/willyou-process-identity'),stopPty:id=>real.kill(id),pollMs:20});tasks.attachManagedCapabilities(managed);
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const oldShell=process.env.SHELL;process.env.SHELL='/bin/sh';let transcript='';real.on('data',(_id,data)=>{transcript+=data;});
  try{
   const first=await create(profile.id),runId=first.task.runtimeSnapshot!.runId;
   await vi.waitFor(()=>expect(existsSync(report),transcript).toBe(true),{timeout:10000});const observed=JSON.parse(readFileSync(report,'utf8')) as {cliPid:number;bridgePid:number;result:{isError?:boolean}};
   expect(observed.result.isError).not.toBe(true);expect(managed.runs.get(runId).pid).toBe(observed.cliPid);const child=sqlite.prepare("SELECT state,pid FROM capability_run_processes WHERE run_id=? AND kind='bridge'").get(runId);expect(child).toEqual({state:'active',pid:observed.bridgePid});expect(consumers()).toHaveLength(1);
   const diagnostic=await applications.sessionDiagnostics.inspect(first.task.id);expect(diagnostic.currentRun).toMatchObject({id:runId,current:true,preparation:{state:'prepared',cliVersion:'0.162.1'},bridge:{connected:true,observedAt:expect.any(String)}});expect(diagnostic.applications.find(a=>a.appId==='mail')).toMatchObject({fixedVersion:'1.0.0',resourceState:'verified',evidence:{skillDiscovery:'unverified',skillRead:'unverified',toolRequests:1,successfulToolRequests:1}});
   writeFileSync(stop,'owned fixture exit');await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopped'),{timeout:10000});await vi.waitFor(()=>expect(consumers()).toEqual([]));expect(existsSync(first.task.runtimeSnapshot!.manifestPath)).toBe(false);
  }finally{tasks.dispose();real.killAll();if(oldShell===undefined)delete process.env.SHELL;else process.env.SHELL=oldShell;}
 },20000);
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
