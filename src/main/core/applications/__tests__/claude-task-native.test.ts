import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
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

/** Native CLI software integration in explicit print/stream mode. This does
 * not replace regular interactive TUI, packaged-App or real reasoning tests.
 */
it.runIf(process.platform==='darwin'&&!!process.env.WILLYOU_P1_CLAUDE_BINARY)('loads the frozen plugin Skill and calls the real plugin through native Claude Messages, then resumes the same history after update',async()=>{
 const root=realpathSync(mkdtempSync('/private/tmp/willyou-m13-native-claude-')),home=join(root,'home'),cwd=join(root,'project'),config=join(home,'.claude');mkdirSync(home);mkdirSync(cwd);mkdirSync(join(cwd,'.git'));mkdirSync(config);
 writeFileSync(join(config,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,theme:'dark',lastOnboardingVersion:'2.1.322',projects:{[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}}));
 const model=await loopbackMessages(root),binary=realpathSync(process.env.WILLYOU_P1_CLAUDE_BINARY!);
 const sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);const db=drizzle(sqlite,{schema});
 const secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets),profiles=new AiProfileService(db,secrets);
 const projectId=projects.createProject({name:'P1 isolated native Claude',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;
 const env={CLAUDE_CONFIG_DIR:config,ANTHROPIC_BASE_URL:model.url,ANTHROPIC_API_KEY:'p1-synthetic-not-a-real-key',ANTHROPIC_MODEL:'synthetic-p1',ANTHROPIC_DEFAULT_SONNET_MODEL:'synthetic-p1',ANTHROPIC_DEFAULT_OPUS_MODEL:'synthetic-p1',ANTHROPIC_DEFAULT_HAIKU_MODEL:'synthetic-p1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
 // Explicit allowlist belongs only to this synthetic print-mode fixture. It
 // does not establish a default-permission or interactive approval pass.
 // allowedTools is variadic. A following fixed-arity option terminates its
 // values so the final literal prompt is not swallowed as another tool name.
 const profileArgs=['--bare','--print','--verbose','--output-format','stream-json','--permission-mode','default','--allowedTools','Skill,mcp__*','--model','synthetic-p1'];
 // Bare mode deliberately omits the Skill tool; its supported explicit slash
 // entry expands the supplied plugin Skill before the first model request.
 const prompt=(marker:string)=>'/willyou-demo-tracker:query '+marker;
 const profileInput=(marker:string)=>({name:'P1 Claude local Messages fixture',runner:'claude' as const,executable:binary,args:[...profileArgs,prompt(marker)],env:Object.entries(env).map(([name,value])=>({name,value,secret:name==='ANTHROPIC_API_KEY'})),color:null,isDefault:true});
 const profileId=profiles.create(profileInput('P1_CLAUDE_A')).id;
 const capabilities=new CapabilityService({db,projects,secrets,userData:root}),ptys=new PtyManager(),reader=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity'));
 const support=new AgentSupportService(new ResourceStore(sqlite,root),capabilities,resolve('out/capability-bundles-compatibility-v1'));let applications:ApplicationService|undefined,managed:ManagedTaskCapabilities|undefined,tasks:TaskService|undefined,created:Awaited<ReturnType<TaskService['create']>>|undefined,terminal='',passed=false;
 const evidence:Record<string,unknown>={schema:1,root,home,cwd,config,binaryHash:digest(readFileSync(binary)),actualNativeClaude:true,actualPty:true,mode:'explicit print/stream-json output, argv prompt, synthetic MCP allowlist',packagedApp:false,realModel:false,copyDailyAuth:false};
 const spawn=ptys.spawn.bind(ptys),launches:unknown[]=[];vi.spyOn(ptys,'spawn').mockImplementation(options=>{launches.push({command:options.command,args:options.args});return spawn(options);});
 const exits:{id:string;code:number;signal?:number}[]=[];ptys.on('exit',(id:string,code:number,signal?:number)=>exits.push({id,code,signal}));ptys.on('data',(_id:string,data:string)=>{terminal+=data;});const rows=()=>sqlite.prepare('SELECT run_id,kind,state,pid,process_started_at FROM capability_run_processes ORDER BY rowid').all();
 try{
  await support.initialize();tasks=new TaskService({db,ptys,profiles,projects,capabilities,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}),onChanged:()=>{}});
  applications=new ApplicationService(support.store,{secrets,projects,tasks,activePty:id=>tasks!.activePty(id),requireSender:()=>{},mailWorker:join(root,'unused'),foxmailNative:join(root,'unused-native'),processes:reader,plugins:{processes:reader,runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[home]}}});await applications.recover();
  managed=await ManagedTaskCapabilities.open(support,capabilities,applications,{helper:resolve('out/native/willyou-process-identity'),processes:reader,stopPty:id=>ptys.kill(id),pollMs:30});tasks.attachManagedCapabilities(managed);
  // Prepare the fixture's explicit read grant using the host's real generated
  // native tool name before fork. Claude does not treat mcp__* as an arbitrary
  // server wildcard. This test-only permission setup never changes a run plan,
  // native identity or approval result, and does not claim default-mode coverage.
  const prepare=managed.prepare.bind(managed);vi.spyOn(managed,'prepare').mockImplementation(async input=>{const launch=await prepare(input),session=await managed!.sessions.get(input.taskId),name=session.snapshot.adapterBinding.nativeToolNames[pluginMcpToolName('demo-tracker.items.list')];if(!name)throw Error('Exact synthetic native tool missing');model.setTarget(name);launch.profileArgs=(launch.profileArgs??input.profile.args).map(a=>a==='Skill,mcp__*'?'Skill,'+name:a);return launch;});
  const f=pluginFixture();f.manifest.permissions=[];f.manifest.providers=[];f.manifest.capabilities['demo-tracker.items.list'].slots=[];Object.assign(f.manifest,{skills:['skills']});f.files.set('skills/query/SKILL.md',Buffer.from('---\nname: query\ndescription: Native Claude synthetic plugin fixture\n---\nP1_CLAUDE_SKILL_V1\n{{WILLYOU_APPLICATION}}\n{{WILLYOU_ENTRYPOINTS}}\n'));
  const runtime=(version:string,title:string)=>Buffer.from(`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:${JSON.stringify(version)}}:{items:[{id:'synthetic',title:${JSON.stringify(title)}}]}})+'\\n');});`);
  const install=async(version:string)=>{f.manifest.version=version;f.files.set('runtime/main.mjs',runtime(version,'P1 Claude '+version));f.files.set('skills/query/SKILL.md',Buffer.from(f.files.get('skills/query/SKILL.md')!.toString().replace('P1_CLAUDE_SKILL_V1','P1_CLAUDE_SKILL_'+(version==='0.1.0'?'V1':'V2'))));const dir=join(root,'plugin-'+version);for(const[path,bytes]of f.bundle()){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);}const check=await applications!.plugins!.inspect('software-fixture',dir,'directory');await applications!.plugins!.install('software-fixture',check.token);};
  await install('0.1.0');created=await tasks.create({projectId,dirId:null,aiProfileId:profileId,firstMessage:''});const runId=created.task.runtimeSnapshot!.runId,nativeId=created.task.nativeSessionId;expect(nativeId).toMatch(/^[a-f0-9-]{36}$/);evidence.first={runId,nativeId};
  const stored=await managed.sessions.get(created.task.id);model.setTarget(stored.snapshot.adapterBinding.nativeToolNames[pluginMcpToolName('demo-tracker.items.list')]);
  const frozen=join(support.store.root,'plugin-skills',runId,'packages/demo-tracker/payload/skills/query/SKILL.md');expect(readFileSync(frozen,'utf8')).toContain('P1_CLAUDE_SKILL_V1');
  await viWait(()=>expect(model.outputs.get('P1_CLAUDE_A')).toContain('P1 Claude 0.1.0'),25000);await viWait(()=>expect(terminal).toContain('P1_CLAUDE_A_DONE'),5000);expect(model.requests.some(r=>JSON.stringify(r.body).includes('P1_CLAUDE_SKILL_V1'))).toBe(true);
  expect(sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:1});
  await viWait(()=>expect(ptys.count).toBe(0),10000);await viWait(()=>expect(managed!.runs.get(runId).state).toBe('stopped'),6000);expect(tasks.get(created.task.id).recovery).toBe('resumable');expect(existsSync(frozen)).toBe(false);
  const historyPath=claudeSessionFile(config,cwd,nativeId!,false);expect(historyPath).not.toBeNull();const firstHistory=readFileSync(historyPath!,'utf8');expect(firstHistory).toContain(nativeId);expect(firstHistory).toContain('P1_CLAUDE_A');evidence.firstHistory={path:historyPath,sha256:digest(firstHistory)};
  await install('0.2.0');profiles.update(profileId,profileInput('P1_CLAUDE_B'));
  created=await tasks.open({taskId:created.task.id});const next=created.task.runtimeSnapshot!.runId;expect(created.task.nativeSessionId).toBe(nativeId);expect(next).not.toBe(runId);await viWait(()=>expect(model.outputs.get('P1_CLAUDE_B')).toContain('P1 Claude 0.2.0'),25000);await viWait(()=>expect(terminal).toContain('P1_CLAUDE_B_DONE'),5000);expect(model.requests.some(r=>JSON.stringify(r.body).includes('P1_CLAUDE_SKILL_V2'))).toBe(true);expect(model.failures).toEqual([]);evidence.resumed={runId:next,nativeId:created.task.nativeSessionId};
  expect(sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:2});evidence.actualHostInvocationCount=2;
  const resumedBody=JSON.stringify(model.requests.at(-1)!.body);expect(resumedBody).toContain('P1_CLAUDE_A');expect(resumedBody).toContain('P1_CLAUDE_B');expect(resumedBody).toContain('P1 Claude 0.1.0');
  await viWait(()=>expect(ptys.count).toBe(0),10000);await viWait(()=>expect(managed!.runs.get(next).state).toBe('stopped'),6000);expect(exits.map(e=>e.code)).toEqual([0,0]);expect(claudeSessionFile(config,cwd,nativeId!,false)).toBe(historyPath);const finalHistory=readFileSync(historyPath!,'utf8');expect(finalHistory).toContain('P1_CLAUDE_B');expect(finalHistory).not.toBe(firstHistory);evidence.finalHistory={path:historyPath,sha256:digest(finalHistory),raw:finalHistory};passed=true;
 }catch(error){evidence.failure={message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined};throw error;}
 finally{
  evidence.terminal=terminal;evidence.exits=exits;evidence.launches=launches;evidence.model={requests:model.requests,outputs:Object.fromEntries(model.outputs),failures:model.failures};evidence.rowsBeforeCleanup=rows();const cleanup:Record<string,unknown>={};
  try{if(created)tasks?.kill(created.task.id);tasks?.dispose();await applications?.dispose();await managed?.dispose();await viWait(()=>expect(ptys.count).toBe(0),6000);cleanup.ptys=ptys.count;cleanup.rows=rows();}catch(error){cleanup.error=String(error);passed=false;}finally{capabilities.dispose();await model.close();vi.restoreAllMocks();}
  evidence.cleanup=cleanup;evidence.status=passed?'passed':'failed';const path=process.env.WILLYOU_P1_CLAUDE_TASK_EVIDENCE;if(path){if(!path.startsWith('/private/tmp/willyou-m13-'))throw Error('Private evidence path required');writeFileSync(path,JSON.stringify(evidence,null,2)+'\n');}sqlite.close();if(passed)rmSync(root,{recursive:true,force:true});expect(cleanup).not.toHaveProperty('error');
 }
},90000);

// Use the runner's bounded polling rather than fixed startup sleeps.
async function viWait(assertion:()=>void,timeout:number){await vi.waitFor(assertion,{timeout,interval:50});}
