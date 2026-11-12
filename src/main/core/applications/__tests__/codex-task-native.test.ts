import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {expect,it,vi} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {PtyManager,type SpawnOptions} from '../../../pty-manager';
import {ProjectService} from '../../projects/project-service';
import {AiProfileService} from '../../ai/ai-profile-service';
import {CapabilityService} from '../../capabilities/capability-service';
import {TaskService} from '../../tasks/task-service';
import {ResourceStore} from '../resource-store';
import {AgentSupportService} from '../agent-support-service';
import {ApplicationService} from '../application-service';
import {ManagedTaskCapabilities} from '../task-capability-launcher';
import {MacProcessIdentityReader,type ProcessIdentity} from '../process-identity';
import {fixture as pluginFixture} from '../plugins/__tests__/fixture';
import {digest} from '../manifest';
import {pluginMcpToolName} from '../plugins/session-tools';
import {loopbackResponses} from './fixtures/loopback-responses';
import {CodexResumeRelay} from '../codex-resume-relay';
import {CodexPrivateServer} from '../codex-private-server';

/** Software integration, not packaged-App installation or a real model turn.
 * Uses the real TaskService, PTY, installed Codex, embedded MCP bridge and kernel
 * identity helpers. All home/config/data/plugin contents are synthetic/private.
 */
async function nativeTaskProbe(modelTurn:boolean,changePermissions=false){
 const root=realpathSync(mkdtempSync('/private/tmp/willyou-m13-native-task-')),home=join(root,'home'),cwd=join(root,'project');mkdirSync(home);mkdirSync(cwd);mkdirSync(join(cwd,'.git'));mkdirSync(join(home,'.codex'));
 const binary=realpathSync(process.env.WILLYOU_P1_CODEX_BINARY!),model=modelTurn?await loopbackResponses(root):undefined;
 // Fixture trust is prepared only for this newly created empty project. There
 // are no user prompts, original user files, login data or authentication here.
 writeFileSync(join(home,'.codex/config.toml'),'[projects.'+JSON.stringify(cwd)+']\ntrust_level="trusted"\n');
 const sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);const db=drizzle(sqlite,{schema});
 const secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets),profiles=new AiProfileService(db,secrets);
 const projectId=projects.createProject({name:'P1 native Codex private fixture',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;
 const profileArgs=['--disable','plugins','--disable','shell_snapshot','-c','analytics.enabled=false','-m','synthetic-p1','-c','model_provider="synthetic_p1"','-c','model_providers.synthetic_p1={name="P1 local fixture",base_url='+JSON.stringify(model?.url??'http://127.0.0.1:9/v1')+',wire_api="responses",requires_openai_auth=false}','-s',changePermissions?'workspace-write':'read-only','-a',changePermissions?'never':'on-request','-c','approvals_reviewer="user"','--no-alt-screen'];
 const profileId=profiles.create({name:'P1 isolated Codex',runner:'codex',executable:binary,args:profileArgs,env:[],color:null,isDefault:true}).id;
 const capabilities=new CapabilityService({db,projects,secrets,userData:root}),ptys=new PtyManager(),reader=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity'));
 const support=new AgentSupportService(new ResourceStore(sqlite,root),capabilities,resolve('out/capability-bundles-compatibility-v1'));let applications:ApplicationService|undefined,managed:ManagedTaskCapabilities|undefined,tasks:TaskService|undefined;
 let terminal='',created:Awaited<ReturnType<TaskService['create']>>|undefined,launch:SpawnOptions|undefined,passed=false;
 const events:unknown[]=[],identities:ProcessIdentity[]=[];const recordRows=()=>sqlite.prepare('SELECT run_id,kind,state,pid,process_started_at FROM capability_run_processes ORDER BY rowid').all();
 const resumeReceipts:Record<string,unknown>[]=[];const privatePrepare=CodexPrivateServer.prepare;
 vi.spyOn(CodexPrivateServer,'prepare').mockImplementation((input,authority,processes,options)=>privatePrepare(input,authority,processes,{...options,observeResume:receipt=>{options?.observeResume?.(receipt);if(receipt.result){const r=receipt.result as Record<string,unknown>,thread=r.thread as {id?:string};resumeReceipts.push({threadId:thread?.id,approvalPolicy:r.approvalPolicy,approvalsReviewer:r.approvalsReviewer,sandbox:r.sandbox,activePermissionProfile:r.activePermissionProfile});}}}));
 const relayStart=CodexResumeRelay.prototype.start;vi.spyOn(CodexResumeRelay.prototype,'start').mockImplementation(async function(this:CodexResumeRelay){(this as unknown as {http:import('node:http').Server}).http.on('upgrade',request=>events.push({stage:'native-relay-upgrade',url:request.url}));return relayStart.call(this);});
 const evidence:Record<string,unknown>={schema:1,root,home,cwd,binaryHash:digest(readFileSync(binary)),actualNativeCodex:true,actualPty:true,packagedApp:false,modelTurn,changePermissions,realModel:false,authCopied:false,syntheticPlugin:true};
 const nativeContexts=(nativeId:string)=>{const dir=join(home,'.codex/sessions'),paths=readdirSync(dir,{recursive:true}).filter((p):p is string=>typeof p==='string'&&p.endsWith('-'+nativeId+'.jsonl'));expect(paths).toHaveLength(1);return readFileSync(join(dir,paths[0]),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(r=>r.type==='turn_context').map(r=>({cwd:r.payload.cwd,approvalPolicy:r.payload.approval_policy,approvalsReviewer:r.payload.approvals_reviewer,sandbox:r.payload.sandbox_policy}));};
 ptys.on('data',(id:string,data:string)=>{terminal+=data;if(Buffer.byteLength(terminal)>1024*1024)terminal=terminal.slice(-500000);if(data.includes('\x1b[6n'))ptys.write(id,'\x1b[1;1R');if(data.includes('\x1b[c'))ptys.write(id,'\x1b[?62c');});
 try{
  await support.initialize();expect(support.status().state).toBe('ready');
  tasks=new TaskService({db,ptys,profiles,projects,capabilities,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}),onChanged:()=>{},codexPollMs:30});
  applications=new ApplicationService(support.store,{secrets,projects,tasks,activePty:id=>tasks!.activePty(id),requireSender:()=>{},mailWorker:join(root,'unused-worker'),foxmailNative:join(root,'unused-native'),processes:reader,plugins:{processes:reader,runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[home]}}});await applications.recover();
  managed=await ManagedTaskCapabilities.open(support,capabilities,applications,{helper:resolve('out/native/willyou-process-identity'),processes:reader,stopPty:id=>ptys.kill(id),pollMs:30});tasks.attachManagedCapabilities(managed);
  const f=pluginFixture();f.manifest.providers=[];f.manifest.capabilities['demo-tracker.items.list'].slots=[];Object.assign(f.manifest,{skills:['skills']});f.files.set('skills/query/SKILL.md',Buffer.from('---\nname: query\ndescription: P1 real native task fixture\n---\nP1_FROZEN_SKILL_V1\n{{WILLYOU_APPLICATION}}\n{{WILLYOU_ENTRYPOINTS}}\n'));
  f.files.set('runtime/main.mjs',Buffer.from(`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:'0.1.0'}:{items:[{id:'synthetic',title:'P1 native'}]}})+'\\n');});`));
  const source=join(root,'synthetic-plugin');for(const[path,bytes]of f.bundle()){mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),bytes);}
  // In-memory/private DB setup is not the separately gated desktop install.
  const inspected=await applications.plugins!.inspect('software-fixture',source,'directory');await applications.plugins!.install('software-fixture',inspected.token);
  const spawn=ptys.spawn.bind(ptys);vi.spyOn(ptys,'spawn').mockImplementation(options=>{launch=options;const rows=recordRows() as {kind:string;state:string;pid:number|null;process_started_at:string|null}[];events.push({stage:'before-terminal-fork',rows});expect(rows.filter(r=>r.kind==='bridge'&&r.state==='active'&&r.pid!==null)).toHaveLength(2);expect(rows.filter(r=>r.kind==='cli'&&r.state==='armed')).toMatchObject([{state:'armed',pid:null}]);for(const r of rows)if(r.state==='active'&&r.pid&&r.process_started_at)identities.push({pid:r.pid,startedAt:r.process_started_at});return spawn(options);});
  created=await tasks.create({projectId,dirId:null,aiProfileId:profileId,firstMessage:''});const runId=created.task.runtimeSnapshot!.runId;evidence.runId=runId;expect(launch?.args).toContain('--remote');
  expect(launch?.command).toBe('python3'); // Existing host self-check is retained.
  await vi.waitFor(()=>expect(managed!.broker.hasAuthenticated(runId)).toBe(true),{timeout:20000,interval:50});
  expect(ptys.has(created.ptyId)).toBe(true);expect(managed.bridges.status()).toHaveLength(1);const bridge=managed.bridges.status()[0];identities.push({pid:bridge.pid,startedAt:bridge.startedAt});const native=reader.read(ptys.nativePid(created.ptyId)!);expect(native).not.toBeNull();identities.push(native!);
  const plan=managed.runs.bridgePreparation(runId).plan!;expect(plan.skills).toEqual([expect.objectContaining({nativeName:'willyou-demo-tracker-query'})]);expect(plan.grades.cli).toBe(false);expect(existsSync(join(cwd,'.agents/skills'))).toBe(false);
  const manifest=created.task.runtimeSnapshot!.manifestPath,selfCheck=join(dirname(manifest),'self-check.json');await vi.waitFor(()=>expect(existsSync(selfCheck)).toBe(true));expect(JSON.parse(readFileSync(selfCheck,'utf8'))).toMatchObject({status:'passed',issues:[]});
  evidence.active={run:managed.runs.get(runId),rows:recordRows(),bridges:managed.bridges.status(),planSkills:plan.skills,cliGrade:plan.grades.cli,selfCheck:JSON.parse(readFileSync(selfCheck,'utf8'))};
  let nativeId:string|null=null,frozenSkillPath:string|undefined,frozenSkillBefore:string|undefined;
  if(model){
   const saved=await managed.sessions.get(created.task.id);model.setTarget(saved.snapshot.adapterBinding.nativeToolNames[pluginMcpToolName('demo-tracker.items.list')]);
   const submit=async(marker:string)=>{await vi.waitFor(()=>expect(terminal.lastIndexOf('7501;state=idle')).toBeGreaterThan(terminal.lastIndexOf('7501;state=working')),{timeout:15000,interval:50});const before=terminal.length;expect(await ptys.bracketedPaste(created!.ptyId)).toBe(true);ptys.write(created!.ptyId,'\x1b[200~$willyou-demo-tracker-query '+marker+'\x1b[201~');await vi.waitFor(()=>expect(terminal.slice(before)).toContain(marker),{timeout:5000});ptys.write(created!.ptyId,'\r');};
   await submit('P1_LOOPBACK_A');
   await vi.waitFor(()=>expect(model.outputs.get('P1_LOOPBACK_A')).toContain('P1 native'),{timeout:20000,interval:50});
   await vi.waitFor(()=>expect(terminal).toContain('P1_LOOPBACK_A_DONE'),{timeout:5000});await vi.waitFor(()=>expect(tasks!.get(created!.task.id).nativeSessionId).toMatch(/^[a-f0-9-]{36}$/),{timeout:5000});nativeId=tasks.get(created.task.id).nativeSessionId;
   expect(JSON.stringify(model.requests[0].body)).toContain('P1_FROZEN_SKILL_V1');
   // The private run Skill path is derived from host-owned resource metadata,
   // never from model output or a made-up native history fixture.
   frozenSkillPath=join(support.store.root,'plugin-skills',runId,'packages/demo-tracker/payload/skills/query/SKILL.md');frozenSkillBefore=readFileSync(frozenSkillPath,'utf8');
   f.manifest.version='0.2.0';f.files.set('runtime/main.mjs',Buffer.from(f.files.get('runtime/main.mjs')!.toString().replace("version:'0.1.0'","version:'0.2.0'").replace('P1 native','P1 native v2')));f.files.set('skills/query/SKILL.md',Buffer.from(f.files.get('skills/query/SKILL.md')!.toString().replace('P1_FROZEN_SKILL_V1','P1_FROZEN_SKILL_V2')));
   const next=join(root,'synthetic-plugin-v2');for(const[path,bytes]of f.bundle()){mkdirSync(dirname(join(next,path)),{recursive:true});writeFileSync(join(next,path),bytes);}const inspected=await applications.plugins!.inspect('software-fixture',next,'directory');await applications.plugins!.install('software-fixture',inspected.token);expect(readFileSync(frozenSkillPath!,'utf8')).toBe(frozenSkillBefore);
   evidence.beforeResume={nativeId,runId,source:'actual native history after the synthetic completed turn',firstOutput:model.outputs.get('P1_LOOPBACK_A')};
   const contexts=nativeContexts(nativeId!);expect(contexts.at(-1)).toMatchObject({cwd,approvalPolicy:changePermissions?'never':'on-request',sandbox:{type:changePermissions?'workspace-write':'read-only'}});evidence.firstNativePermissions=contexts;
  }
  tasks.kill(created.task.id);await vi.waitFor(()=>expect(ptys.count).toBe(0),{timeout:6000});await vi.waitFor(()=>expect(managed!.runs.get(runId).state).toBe('stopped'),{timeout:6000});
  for(const identity of identities)expect(reader.state(identity)).toBe('stopped');expect(managed.broker.hasAuthenticated(runId)).toBe(false);expect(managed.bridges.status()).toEqual([]);evidence.stopped={run:managed.runs.get(runId),rows:recordRows(),identities:identities.map(identity=>({...identity,state:reader.state(identity)}))};
  if(model){
   if(changePermissions){const args=[...profileArgs];args[args.indexOf('-s')+1]='read-only';args[args.indexOf('-a')+1]='on-request';profiles.update(profileId,{name:'P1 isolated Codex',runner:'codex',executable:binary,args,env:[],color:null,isDefault:true});}
   expect(tasks.get(created.task.id).recovery).toBe('resumable');created=await tasks.open({taskId:created.task.id});const resumedRun=created.task.runtimeSnapshot!.runId;expect(resumedRun).not.toBe(runId);expect(created.task.nativeSessionId).toBe(nativeId);expect(launch?.args).toContain('resume');expect(launch?.args).toContain(nativeId);await vi.waitFor(()=>expect(managed!.broker.hasAuthenticated(resumedRun)).toBe(true),{timeout:10000});
   await vi.waitFor(()=>expect(terminal.lastIndexOf('7501;state=idle')).toBeGreaterThan(terminal.lastIndexOf('7501;state=working')),{timeout:15000,interval:50});const before=terminal.length;expect(await ptys.bracketedPaste(created.ptyId)).toBe(true);ptys.write(created.ptyId,'\x1b[200~$willyou-demo-tracker-query P1_LOOPBACK_B\x1b[201~');await vi.waitFor(()=>expect(terminal.slice(before)).toContain('P1_LOOPBACK_B'),{timeout:5000});ptys.write(created.ptyId,'\r');await vi.waitFor(()=>expect(model.outputs.get('P1_LOOPBACK_B')).toContain('P1 native v2'),{timeout:20000,interval:50});await vi.waitFor(()=>expect(terminal).toContain('P1_LOOPBACK_B_DONE'),{timeout:5000});expect(model.requests.some(r=>JSON.stringify(r.body).includes('P1_FROZEN_SKILL_V2'))).toBe(true);expect(model.failures).toEqual([]);
   evidence.resumed={nativeId:created.task.nativeSessionId,runId:resumedRun,secondOutput:model.outputs.get('P1_LOOPBACK_B'),rows:recordRows()};tasks.kill(created.task.id);await vi.waitFor(()=>expect(ptys.count).toBe(0),{timeout:6000});await vi.waitFor(()=>expect(managed!.runs.get(resumedRun).state).toBe('stopped'),{timeout:6000});
   const contexts=nativeContexts(nativeId!);evidence.resumedNativePermissions=contexts;expect(contexts.length).toBeGreaterThanOrEqual(2);expect(contexts.at(-1)).toMatchObject({cwd,approvalPolicy:'on-request',sandbox:{type:'read-only'}});
   expect(resumeReceipts).toEqual([expect.objectContaining({threadId:nativeId,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:expect.objectContaining({type:'readOnly',networkAccess:false})})]);
  }passed=true;
 }catch(error){evidence.failure={message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined};throw error;}
 finally{
  // Persist raw observations before offline judgement; cleanup uses only owned
  // TaskService/PTY/backend handles, never process-name matching.
  evidence.events=events;evidence.resumeReceipts=resumeReceipts;evidence.terminal=terminal;if(model)evidence.model={requests:model.requests,outputs:Object.fromEntries(model.outputs),failures:model.failures};evidence.rowsBeforeCleanup=recordRows();
  const cleanup:Record<string,unknown>={};try{if(created)tasks?.kill(created.task.id);tasks?.dispose();await applications?.dispose();await managed?.dispose();await vi.waitFor(()=>expect(ptys.count).toBe(0),{timeout:6000});cleanup.ptys=ptys.count;cleanup.rows=recordRows();}catch(error){cleanup.error=String(error);passed=false;}finally{capabilities.dispose();await model?.close();vi.restoreAllMocks();}
  evidence.cleanup=cleanup;evidence.status=passed?'passed':'failed';const path=process.env.WILLYOU_P1_CODEX_TASK_EVIDENCE;if(path){if(!path.startsWith('/private/tmp/willyou-m13-'))throw Error('Private evidence path required');const suffix=changePermissions?'-changed-permissions':modelTurn?'-loopback':'-startup';writeFileSync(path.replace(/\.json$/,'')+suffix+'.json',JSON.stringify(evidence,null,2)+'\n');}sqlite.close();if(passed)rmSync(root,{recursive:true,force:true});expect(cleanup).not.toHaveProperty('error');
 }
}
it.runIf(process.platform==='darwin'&&!!process.env.WILLYOU_P1_CODEX_BINARY)('delivers plugin skills through the real private Codex backend and remote task terminal, then stops its owned process tree (no model)',()=>nativeTaskProbe(false),45000);
it.runIf(process.platform==='darwin'&&!!process.env.WILLYOU_P1_CODEX_TURN)('calls the actual plugin through native Codex using loopback Responses and resumes real history with the updated private Skill',()=>nativeTaskProbe(true),75000);
it.runIf(process.platform==='darwin'&&!!process.env.WILLYOU_P1_CODEX_TURN)('replaces saved workspace/never permissions with the selected read-only/user policy on actual native history resume',()=>nativeTaskProbe(true,true),75000);
