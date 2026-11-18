import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { createProjectControllers } from '../projects/controller';
import { ProjectService } from '../projects/project-service';
import { AgentStore } from './agent-store';
import { AgentTaskService } from './agent-task-service';
import { AgentRunService } from './agent-run-service';
import { AgentProjectResources } from './project-resources';
import { GitWorkspaces, runWorkspaceCommand } from './git-workspaces';
import { DelegationService } from './delegation-service';
import { AgentManualTerminals } from './manual-terminal';
import { directoryIdentity } from './directory-queue';
import { Emitter, type DriverInstance, type TurnInput } from './driver';
import { TurnDiffs } from './turn-diffs';
import { runDiffJob, type DiffJob, type TreeRef } from './turn-diff-worker';
import { registeredProjectCwd, type AgentWorkspace } from './wiring';
import { createAgentTaskController } from './controller';
import { registerRPCRouter } from '@shared/ipc/rpc';

const close: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of close.splice(0)) await dispose(); });
const stamp = '2026-11-18T00:00:00Z';
class RemovalDriver implements DriverInstance {
  readonly driverId = 'codex-app-server' as const;
  events = new Emitter();
  on = this.events.on.bind(this.events);
  closeCalls = 0;
  beforeExit?: () => Promise<void>;
  async open() { this.events.emit({type:'process',pid:55555}); return { nativeId: 'fixture-native', confirmed: true, defaultModel: 'fixture-model' }; }
  async startTurn(input: TurnInput) {
    this.events.emit({type:'turn.started',nativeTurnId:'fixture-turn',clientInputId:input.clientInputId});
    return { nativeTurnId:'fixture-turn' };
  }
  async respond() {}
  async interrupt() {}
  async close() {
    this.closeCalls++;
    await this.beforeExit?.();
    this.events.emit({type:'exit',code:0,signal:null});
  }
}
function fixture(execute: (job: DiffJob) => Promise<unknown> = runDiffJob, runningTasks?: (projectId: string, matches?: (taskId: string) => boolean) => number) {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'m14-project-cleanup-')));
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  runBundledMigrations(db);
  const orm = drizzle(db,{schema});
  const service = new ProjectService(orm,new SecretsStore(orm,{isAvailable:()=>true,encrypt:Buffer.from,decrypt:value=>value.toString()}));
  const store = new AgentStore(db,{artifactDir:join(root,'agent-artifacts')});
  const instances: RemovalDriver[] = [];
  const runs = new AgentRunService({store,drivers:new Map([['codex-app-server',{id:'codex-app-server',command:'fixture',create:()=>{const instance=new RemovalDriver();instances.push(instance);return instance;}}]]),processes:{read:pid=>({pid,startedAt:'fixture-process-start'}),state:()=>'unknown'},host:{instanceId:'fixture',pid:process.pid,startedAt:null}});
  const tasks = new AgentTaskService({store,runs,userData:root,profileDriver:()=> 'codex-app-server',resolveLaunch:async()=>{throw Error('Unexpected native launch');}});
  const storage = join(root,'agent-diffs');
  const diffs = new TurnDiffs({store,storage,execute,changed:()=>{}});
  const ptys=new Set<string>();
  const terminals = new AgentManualTerminals({
    ptys:{spawn:()=>{ptys.add('fixture-pty');return 'fixture-pty';},has:id=>ptys.has(id),kill:id=>{ptys.delete(id);},on:()=>{}},
    taskCwd:id=>store.task(id)!.cwd,baseEnv:()=>({}),
  });
  const resources = new AgentProjectResources({store,tasks,diffs,terminals,userData:root});
  tasks.attachAttachmentCleanup((id,value)=>resources.discardAttachments(id,value));
  const projects = createProjectControllers(service,{agentTasks:resources,runningTasks}).projects;
  const makeProject = (name:string) => {
    const cwd = join(root,name);
    mkdirSync(cwd);
    return {cwd,project:service.createProject({name,aliases:[],description:'',rulesPath:null},[{path:cwd,label:name}])};
  };
  const create = (p:ReturnType<typeof makeProject>,title:string,parentTaskId?:string) =>
    store.createTask({projectId:p.project.id,dirId:p.project.dirs[0].id,cwd:p.cwd,title,parentTaskId,selection:{driverId:'codex-app-server',profileId:'test',tier:'ask'}});
  close.push(async()=>{await resources.close();await diffs.close();await runs.closeAll();db.close();rmSync(root,{recursive:true,force:true});});
  const open = (taskId:string) => runs.open({taskId,driverId:'codex-app-server',profileId:'test',tier:'ask',executable:{path:'/fixture',version:'0.169.0'},stateRoot:root,cwd:store.task(taskId)!.cwd,env:{},compatibility:{}});
  const coordination = (command?: typeof runWorkspaceCommand, drained: (runId: string) => Promise<boolean> = async () => true) => {
    const git = new GitWorkspaces({store,home:root,command});
    const profile = (id:string) => ({profileId:id,driverId:'codex-app-server' as const,name:id,revision:'fixture',available:true,trustedRead:false,models:['fixture-model']});
    const co = new DelegationService({store,runs,tasks,git,profile,profiles:()=>[profile('test')],roots:id=>[store.task(id)!.cwd],project:id=>({id:id!,name:'fixture'}),drained});
    close.unshift(()=>co.close());
    return {co,git};
  };
  return {root,db,store,tasks,runs,instances,terminals,open,coordination,diffs,resources,storage,service,projects,create,makeProject};
}

it.each([
  { action: 'archive', proven: true },
  { action: 'delete', proven: true },
  { action: 'archive', proven: false },
  { action: 'delete', proven: false },
])('waits for directory release to $action the task family (exit verified: $proven)', async ({ action, proven }) => {
  const f = fixture(), p = f.makeProject('idle-owner');
  const parent = f.create(p, 'parent'), child = f.create(p, 'child', parent);
  let startDrain!: (runId: string) => void;
  let finishDrain!: (proven: boolean) => void;
  const drainStarted = new Promise<string>(resolve => { startDrain = resolve; });
  const proof = new Promise<boolean>(resolve => { finishDrain = resolve; });
  const { co } = f.coordination(undefined, runId => {
    startDrain(runId);
    return proof;
  });
  const q = co.queue.enter(parent, directoryIdentity(p.cwd, [p.cwd]).identity);
  expect(co.queue.acquire(q.queue_id)).toBe(true);
  const run = await f.open(parent);
  co.opened(parent, run);
  expect(f.tasks.taskBlockers(parent, action === 'delete')).toEqual([]);
  const result = Promise.resolve(action === 'archive'
    ? f.tasks.archive(parent)
    : f.projects.delete(p.project.id, { deleteSecrets: false, agentTaskDeletionConfirmation: f.resources.inspect(p.project.id).confirmation }));
  const early = vi.fn();
  void result.then(early, early);
  try {
    const owner = await Promise.race([drainStarted, result.then(() => 'completed before drain')]);
    expect(owner).toBe(run.runId);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(early).not.toHaveBeenCalled();
    expect(f.store.task(parent)?.archived_at).toBeNull();
    expect(f.store.task(child)?.archived_at).toBeNull();
    expect(co.queue.get(q.queue_id)?.state).toBe('active');
  } finally {
    finishDrain(proven);
  }
  if (!proven) {
    await expect(result).rejects.toThrow('委派或工作副本尚未收口');
    expect(f.store.task(parent)?.archived_at).toBeNull();
    expect(f.store.task(child)?.archived_at).toBeNull();
    expect(co.queue.get(q.queue_id)?.state).toBe('active');
    return;
  }
  await result;
  if (action === 'archive') {
    expect(f.store.task(parent)?.archived_at).toBeTruthy();
    expect(f.store.task(child)?.archived_at).toBeTruthy();
    expect(co.queue.get(q.queue_id)?.state).toBe('released');
  } else {
    expect(f.store.task(parent)).toBeUndefined();
    expect(f.store.task(child)).toBeUndefined();
  }
});

it('G4 resolves registered cwd and rejects foreign, archived and missing directories',()=>{
  const f=fixture(), a=f.makeProject('registered'), b=f.makeProject('other');
  const alias=join(f.root,'alias');
  symlinkSync(a.cwd,alias,'dir');
  const dir=a.project.dirs[0];
  f.db.prepare('UPDATE project_dirs SET path=? WHERE id=?').run(alias,dir.id);
  const ws = { tasks:f.tasks,projectCwd:(proj:string,dirId:string)=>registeredProjectCwd(f.db,proj,dirId) } as AgentWorkspace;
  const rpc=createAgentTaskController(ws,()=>{});
  const handlers=new Map<string,Function>();
  registerRPCRouter(rpc,{handle:(name:string,fn:Function)=>handlers.set(name,fn)} as never);
  const input={projectId:a.project.id,dirId:dir.id,cwd:b.cwd,title:'wrong supplied cwd',profileId:'test',tier:'ask' as const};
  const created=handlers.get('agentTasks.create')!({},input) as {taskId:string};
  expect(f.store.task(created.taskId)?.cwd).toBe(a.cwd);
  expect(()=>registeredProjectCwd(f.db,b.project.id,dir.id)).toThrow('当前活动项目');
  f.service.setArchived(a.project.id,true);
  expect(()=>registeredProjectCwd(f.db,a.project.id,dir.id)).toThrow('当前活动项目');
  f.service.setArchived(a.project.id,false);
  renameSync(a.cwd,a.cwd+'-moved');
  expect(()=>registeredProjectCwd(f.db,a.project.id,dir.id)).toThrow('已不可用');
});

it('G5 archives a family atomically, leaves history and bindings readable and restores the same identities',async()=>{
  const f=fixture(), p=f.makeProject('archive-project'), parent=f.create(p,'parent'), child=f.create(p,'child',parent);
  const binding=f.store.createBinding({task_id:child,driver_id:'codex-app-server',profile_id:'test',continuation_hash:'a'.repeat(64),state_root:f.root,cwd_identity:p.cwd});
  const item=f.store.addHostItem(child,null,'system_notice',{detail:'archived history'});
  const request=f.store.insertNativeRequest({taskId:child,origin:{taskId:child,bindingId:binding,runId:'completed',generation:1,turnId:null,nativeRequest:'approval'},kind:'command',payload:{}});
  await expect(f.tasks.archive(parent)).rejects.toThrow('child');
  expect(f.tasks.list()).toHaveLength(2);
  f.store.retireRequest(request,'closed');
  await f.tasks.archive(parent);
  expect(f.tasks.list()).toEqual([]);
  f.service.setArchived(p.project.id,true);
  expect(f.tasks.listArchived()).toMatchObject([{taskId:parent,projectArchived:true}]);
  expect(f.tasks.snapshot(child).archivedAt).toBeTruthy();
  expect(f.tasks.itemBody(child,item,0).chunk).toContain('archived history');
  expect(()=>f.tasks.saveDraft(child,{text:'bad'},0)).toThrow('已归档');
  await expect(f.tasks.submit(child,{text:'bad',clientInputId:'bad-write',expectedSelectionRevision:1})).rejects.toThrow('已归档');
  f.tasks.unarchive(parent);
  expect(f.store.binding(binding)?.task_id).toBe(child);
  expect(f.tasks.list()).toHaveLength(2);
  await f.tasks.archive(child);
  expect(f.tasks.listArchived()).toMatchObject([{taskId:child,parentTaskId:parent}]);
  f.tasks.unarchive(child);
  expect(f.tasks.list().find(item=>item.taskId===child)?.parentTaskId).toBe(parent);
});

it('A78 deletes archived Agent records and registered resources, preserves worktree and M13 history, and retries failed snapshot cleanup',async()=>{
  const f=fixture(), p=f.makeProject('delete-project'), other=f.makeProject('other-project');
  const parent=f.create(p,'parent'), child=f.create(p,'child',parent), survivor=f.create(other,'survivor');
  const binding=f.store.createBinding({task_id:parent,driver_id:'codex-app-server',profile_id:'test',continuation_hash:'a'.repeat(64),state_root:f.root,cwd_identity:p.cwd});
  f.store.insertRun({runId:'run',taskId:parent,bindingId:binding,generation:1,projectId:p.project.id,driverId:'codex-app-server',owner:{instanceId:'fixture',pid:process.pid,startedAt:null},launchPlanHash:'b'.repeat(64)});
  f.db.prepare("UPDATE capability_runs SET state='stopped' WHERE run_id='run'").run();
  f.db.prepare(`INSERT INTO application_invocations(operation_id,run_id,request_id,request_hash,project_id,task_id,app_id,package_hash,tool_name,contract_major,semantics,state,effect_state,started_at)
    VALUES('operation','run','request','hash',?,?,'mail','package','read',1,'read','succeeded','read-only',?)`).run(p.project.id,parent,stamp);
  const request=f.store.insertNativeRequest({taskId:parent,origin:{taskId:parent,bindingId:binding,runId:'run',generation:1,turnId:null,nativeRequest:'approval'},kind:'command',payload:{}});
  await expect(f.projects.delete(p.project.id,{deleteSecrets:false})).rejects.toThrow('parent');
  expect(f.projects.deletePreview(p.project.id).blockers[0]?.reasons).toContain('有待处理请求');
  f.store.retireRequest(request,'resolved');
  const git = async (...args:string[]) => {
    const r=await runWorkspaceCommand(p.cwd,'git',args);
    expect(r.code,r.stderr).toBe(0);
    return r.stdout.trim();
  };
  await git('init','-qb','main');
  writeFileSync(join(p.cwd,'source.txt'),'source code');
  await git('add','source.txt');
  await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
  const native=join(f.root,'native-session');writeFileSync(native,'native history');
  const worktree=join(f.root,'retained-worktree');
  await git('worktree','add','-b','child',worktree,'HEAD');
  f.db.prepare(`INSERT INTO agent_workspaces(workspace_id,task_id,child_task_id,kind,repo_root,path,branch,state,created_at,updated_at)
    VALUES('worktree',?,?,'git_worktree',?,?,'child','ready',?,?)`).run(parent,child,p.cwd,worktree,stamp,stamp);
  f.db.prepare(`INSERT INTO agent_delegations(delegation_id,parent_task_id,child_task_id,target_json,access,request_key,delivery_state,created_at,updated_at)
    VALUES('child',?,?,'{}','write','key','delivered',?,?)`).run(parent,child,stamp,stamp);
  const a=f.tasks.prepareAttachment(child,null,{name:'fixture.png',dataBase64:'YWJj'});
  f.tasks.saveDraft(child,{text:'archive me',attachments:[a]},0);
  const prepared=f.tasks.prepareAttachment(child,null,{name:'unsent.png',dataBase64:'ZWZn'});
  const turn=f.store.acceptTurn({taskId:child,clientInputId:'turn-fixture',text:'snapshots',sourceKind:'user'}).turn.turn_id;
  f.store.endTurn(turn,'completed');
  const ref=await runDiffJob({cwd:p.cwd,storage:f.storage,turnId:turn,side:'before',action:'capture'}) as TreeRef;
  await git('update-ref','refs/willyou/turns/unregistered/before',ref.commit);
  f.db.prepare("INSERT INTO agent_turn_changes(turn_id,task_id,before_ref,status) VALUES(?,?,?,'incomplete')").run(turn,child,JSON.stringify(ref));
  await f.tasks.archive(parent);
  expect(existsSync(a.storedPath!)).toBe(true);
  expect(await git('rev-parse',ref.ref)).toBe(ref.commit);
  expect(f.projects.deletePreview(p.project.id)).toMatchObject({taskCount:2,archivedCount:2,worktrees:[worktree],blockers:[]});
  await expect(f.projects.delete(p.project.id,{deleteSecrets:false})).rejects.toThrow('重新查看');
  const confirmation=f.projects.deletePreview(p.project.id).confirmation!;
  renameSync(p.cwd,p.cwd+'-moved');
  await f.projects.delete(p.project.id,{deleteSecrets:false,agentTaskDeletionConfirmation:confirmation});
  expect(f.store.task(parent)).toBeUndefined();
  expect(f.store.task(child)).toBeUndefined();
  expect(f.store.task(survivor)).toBeTruthy();
  expect(f.db.prepare('SELECT operation_id FROM application_invocations').pluck().all()).toEqual(['operation']);
  expect(f.db.pragma('foreign_key_check')).toEqual([]);
  await vi.waitFor(()=>expect(f.db.prepare("SELECT attempts FROM agent_pending_cleanup WHERE kind='snapshot'").get()).toEqual({attempts:1}));
  await vi.waitFor(()=>expect(existsSync(a.storedPath!)||existsSync(prepared.storedPath!)).toBe(false));
  renameSync(p.cwd+'-moved',p.cwd);
  f.db.prepare('UPDATE agent_pending_cleanup SET next_attempt_at=0').run();
  await f.resources.retry();
  expect(f.db.prepare('SELECT COUNT(*) FROM agent_pending_cleanup').pluck().get()).toBe(0);
  expect(await git('for-each-ref','--format=%(refname)','refs/willyou')).toBe('refs/willyou/turns/unregistered/before');
  expect(existsSync(native)&&existsSync(worktree)&&existsSync(join(p.cwd,'source.txt'))).toBe(true);
});

it('G2 removes unreferenced draft and canceled queue copies, and sweeps expired unattached files',()=>{
  const f=fixture(), p=f.makeProject('attachment-project'), task=f.create(p,'task');
  const a=f.tasks.prepareAttachment(task,null,{name:'file.png',dataBase64:'YWJj'});
  f.tasks.saveDraft(task,{text:'x',attachments:[a]},0);
  const turn=f.store.acceptTurn({taskId:task,clientInputId:'cancel-me',text:'cancel',sourceKind:'user',attachments:[a]}).turn.turn_id;
  f.tasks.saveDraft(task,{text:'x',attachments:[]},1);
  expect(existsSync(a.storedPath!)).toBe(true);
  f.tasks.cancelQueued(task,turn);
  expect(existsSync(a.storedPath!)).toBe(false);
  const old=f.tasks.prepareAttachment(task,null,{name:'stale.png',dataBase64:'YWJj'});
  const prior=new Date(Date.now()-25*3600_000);
  utimesSync(old.storedPath!,prior,prior);utimesSync(join(old.storedPath!,'..'),prior,prior);
  return vi.waitFor(()=>expect(existsSync(old.storedPath!)).toBe(false));
});

it('G2 reclaims the oldest eligible archived shadow snapshot before active history and retains a read lease',async()=>{
  const f=fixture(), p=f.makeProject('shadow-project'), live=f.create(p,'live'), archived=f.create(p,'archived');
  const snapshot=async(taskId:string,n:number)=>{
    writeFileSync(join(p.cwd,'changing.bin'),randomBytes(90*1024));
    const turnId=f.store.acceptTurn({taskId,clientInputId:'snapshot-'+n,text:'test',sourceKind:'user'}).turn.turn_id;
    f.store.endTurn(turnId,'completed');
    const ref=await runDiffJob({cwd:p.cwd,storage:f.storage,turnId,side:'before',action:'capture'}) as TreeRef;
    f.db.prepare("INSERT INTO agent_turn_changes(turn_id,task_id,before_ref,status) VALUES(?,?,?,'complete')").run(turnId,taskId,JSON.stringify(ref));
    return {turnId,ref};
  };
  const active=await snapshot(live,0), held=await snapshot(archived,1), eligible=await snapshot(archived,2);
  await f.tasks.archive(archived);
  const size=await runDiffJob({cwd:p.cwd,storage:f.storage,turnId:'shadow-space',action:'space'}) as {bytes:number};
  const diffs=new TurnDiffs({store:f.store,storage:f.storage,storageLimit:Math.ceil(size.bytes*1.06),execute:runDiffJob,changed:()=>{}});
  const lease=diffs.hold(archived,held.turnId);
  try {
    const binding=f.store.createBinding({task_id:live,driver_id:'codex-app-server',profile_id:'test',continuation_hash:'a'.repeat(64),state_root:f.root,cwd_identity:p.cwd});
    f.store.insertRun({runId:'shadow-run',taskId:live,bindingId:binding,generation:1,projectId:p.project.id,driverId:'codex-app-server',owner:{instanceId:'fixture',pid:process.pid,startedAt:null},launchPlanHash:'b'.repeat(64)});
    const turnId=f.store.acceptTurn({taskId:live,clientInputId:'next-snapshot',text:'test',sourceKind:'user'}).turn.turn_id;
    writeFileSync(join(p.cwd,'changing.bin'),randomBytes(90*1024));
    await diffs.before(live,turnId,'shadow-run');
    expect(diffs.turn(archived,eligible.turnId).reason).toBe('快照已清理（空间回收）');
    expect(diffs.turn(archived,held.turnId).status).toBe('complete');
    expect(diffs.turn(live,active.turnId).status).toBe('complete');
    expect(diffs.turn(live,turnId).status).toBe('capturing');
  } finally { diffs.releaseView(archived,lease); await diffs.close(); }
});

it('G2 paginates all retained turns and retrieves older turns by exact ID',()=>{
  const f=fixture(), p=f.makeProject('paged-project'), task=f.create(p,'paged');
  const turnIds=Array.from({length:56},(_,index)=>{
    const id=f.store.acceptTurn({taskId:task,clientInputId:'turn-'+index,text:'diff',sourceKind:'user'}).turn.turn_id;
    f.db.prepare("INSERT INTO agent_turn_changes(turn_id,task_id,status,incomplete_reason) VALUES(?,?,'none',?)").run(id,task,index.toString());
    return id;
  });
  const first=f.diffs.page(task);
  expect(first.items.map(row=>row.recordNumber)).toEqual(Array.from({length:50},(_,i)=>56-i));
  const second=f.diffs.page(task,first.next!);
  expect(second.items.map(row=>row.turnId)).toEqual(turnIds.slice(0,6).reverse());
  expect(second.items.map(row=>row.recordNumber)).toEqual([6,5,4,3,2,1]);
  expect(second.next).toBeNull();
  expect(f.diffs.turn(task,turnIds[0])).toMatchObject({reason:'0',recordNumber:1});
});

async function expectRemovalRefused(f: ReturnType<typeof fixture>, projectId: string, taskId: string, reason: string) {
  const project=f.service.getProject(projectId), task=f.store.task(taskId);
  const run=f.runs.runForTask(taskId), record=run && f.store.run(run.runId);
  const preview=f.projects.deletePreview(projectId);
  expect(preview.blockers).toContainEqual(expect.objectContaining({taskId,reasons:expect.arrayContaining([reason])}));
  await expect(f.projects.delete(projectId,{deleteSecrets:false,agentTaskDeletionConfirmation:preview.confirmation!})).rejects.toThrow(reason);
  expect(f.service.getProject(projectId)).toEqual(project);
  expect(f.store.task(taskId)).toEqual(task);
  expect(f.runs.runForTask(taskId)).toEqual(run);
  if(run)expect(f.store.run(run.runId)).toEqual(record);
  expect(f.instances.every(instance=>instance.closeCalls===0)).toBe(true);
}

it.each(['active turn','background command','active Codex goal'] as const)('R2 refuses deletion with an %s',async state=>{
  const f=fixture(), p=f.makeProject('running'), task=f.create(p,'task'), run=await f.open(task);
  if(state==='active turn')await f.runs.submit(run.runId,{clientInputId:'live',text:'work'});
  if(state==='background command')f.instances[0].events.emit({type:'node.state',nodeId:'background-shell',state:'running'});
  if(state==='active Codex goal')f.instances[0].events.emit({type:'goal',objective:'finish the work',status:'active'});
  expect(f.runs.busy(run.runId)).toBe(state==='active turn');
  expect(f.runs.nativeBusy(run.runId)).toBe(state==='background command');
  expect(f.store.goal(task)?.status==='active').toBe(state==='active Codex goal');
  await expectRemovalRefused(f,p.project.id,task,'运行尚未收口，请先停止任务或等待完成');
});

it('R2 refuses deletion while a delegated child is unfinished',async()=>{
  const f=fixture(), p=f.makeProject('parent'), task=f.create(p,'parent'), run=await f.open(task);
  const {co}=f.coordination();
  co.setMode(task,true);
  await f.runs.submit(run.runId,{clientInputId:'parent-live',text:'parent work'});
  const child=await co.delegate(run.runId,{requestKey:'unfinished-child',profileId:'test',title:'child',instructions:'work'});
  const childBefore=f.store.task(child.childTaskId);
  expect(co.hasUnfinishedChildren(task)).toBe(true);
  await expectRemovalRefused(f,p.project.id,task,'委派或工作副本尚未收口');
  expect(f.store.task(child.childTaskId)).toEqual(childBefore);
});

it('R2 refuses deletion while Git worktree dependency preparation is pending',async()=>{
  const f=fixture(), p=f.makeProject('prepare-worktree'), task=f.create(p,'parent'), run=await f.open(task);
  for(const args of [['init','-qb','main'],['config','user.name','Fixture'],['config','user.email','fixture@example.invalid']]){
    expect((await runWorkspaceCommand(p.cwd,'git',args)).code).toBe(0);
  }
  writeFileSync(join(p.cwd,'pnpm-lock.yaml'),'lockfileVersion: 9');
  expect((await runWorkspaceCommand(p.cwd,'git',['add','-A'])).code).toBe(0);
  expect((await runWorkspaceCommand(p.cwd,'git',['commit','-qm','base'])).code).toBe(0);
  let release!:()=>void;
  const installing=new Promise<void>(resolve=>{release=resolve;});
  const {co,git}=f.coordination(async(cwd,command,args,options)=>{
    if(command!=='pnpm')return runWorkspaceCommand(cwd,command,args,options);
    await installing;
    return {code:0,stdout:'',stderr:''};
  });
  co.setMode(task,true);
  const child=await co.delegate(run.runId,{requestKey:'prepare-child',profileId:'test',title:'child',instructions:'work',workspaceMode:'worktree'});
  try {
    await vi.waitFor(()=>expect(git.workspace(child.childTaskId)?.state).toBe('preparing'));
    expect(co.blocked(child.childTaskId)).toBe(true);
    const before=git.workspace(child.childTaskId);
    await expectRemovalRefused(f,p.project.id,child.childTaskId,'委派或工作副本尚未收口');
    expect(git.workspace(child.childTaskId)).toEqual(before);
    expect(f.runs.runForTask(task)?.runId).toBe(run.runId);
  } finally { release(); }
});

it('R2 refuses deletion while a manual terminal is running',async()=>{
  const f=fixture(), p=f.makeProject('manual'), task=f.create(p,'task');
  const {ptyId}=f.terminals.open(task);
  await expectRemovalRefused(f,p.project.id,task,'手动终端仍在运行');
  expect(f.terminals.activePty(task)).toBe(ptyId);
});

it('R1/R2 closes an idle native session before deleting an unarchived task with an open diff',async()=>{
  const activeIds = new Set<string>();
  const f=fixture(runDiffJob, (_projectId, matches) => [...activeIds].filter(id => matches?.(id) ?? true).length);
  const p=f.makeProject('idle'), task=f.create(p,'task'), run=await f.open(task);
  activeIds.add(task);
  const legacyTask = 'running-old-terminal';
  f.db.prepare('INSERT INTO tasks(id,project_id,cwd,title,runner,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(legacyTask,p.project.id,p.cwd,'Old terminal','codex',1,1);
  activeIds.add(legacyTask);
  const blocked = f.projects.deletePreview(p.project.id);
  expect(blocked.legacyRunning).toBe(1);
  expect(() => f.projects.delete(p.project.id,{deleteSecrets:false,agentTaskDeletionConfirmation:blocked.confirmation!})).toThrow('有 1 个任务正在运行');
  activeIds.delete(legacyTask);
  const turnId=f.store.acceptTurn({taskId:task,clientInputId:'finished',text:'work',sourceKind:'user'}).turn.turn_id;
  f.store.endTurn(turnId,'completed');
  f.tasks.attachDiffs(f.diffs);
  f.db.prepare("INSERT INTO agent_turn_changes(turn_id,task_id,status) VALUES(?,?,'complete')").run(turnId,task);
  const token=f.diffs.hold(task,turnId);
  const release=vi.spyOn(f.diffs,'releaseView');
  expect(f.store.task(task)?.archived_at).toBeNull();
  expect(f.runs.busy(run.runId)).toBe(false);
  const preview=f.projects.deletePreview(p.project.id);
  expect(preview.blockers).toEqual([]);
  expect(preview.legacyRunning).toBe(0);
  let entered!:()=>void, allowExit!:()=>void;
  const closing=new Promise<void>(resolve=>{entered=resolve;});
  const allow=new Promise<void>(resolve=>{allowExit=resolve;});
  f.instances[0].beforeExit=async()=>{entered();await allow;};
  const removal=f.projects.delete(p.project.id,{deleteSecrets:false,agentTaskDeletionConfirmation:preview.confirmation!});
  try {
    await closing;
    expect(release).toHaveBeenCalledWith(task,token);
    expect(()=>f.diffs.hold(task,turnId)).toThrow('任务正在删除');
    expect(f.store.task(task)).toBeTruthy();
  } finally { allowExit(); }
  await removal;
  expect(f.instances[0].closeCalls).toBe(1);
  expect(f.runs.runForTask(task)).toBeUndefined();
  expect(f.store.run(run.runId)?.state).toBe('stopped');
  expect(f.store.task(task)).toBeUndefined();
  expect(()=>f.diffs.hold(task,turnId)).toThrow('任务不存在');
  expect(()=>f.service.getProject(p.project.id)).toThrow();
});

it('R1 still refuses deletion while snapshot capture is in progress',async()=>{
  let started!:()=>void, finish!:()=>void;
  const captureStarted=new Promise<void>(resolve=>{started=resolve;});
  const captureFinish=new Promise<void>(resolve=>{finish=resolve;});
  const f=fixture(async job=>{
    if(job.action==='capture'){started();await captureFinish;}
    return runDiffJob(job);
  }), p=f.makeProject('capturing'), task=f.create(p,'task'), run=await f.open(task);
  const turnId=f.store.acceptTurn({taskId:task,clientInputId:'finished',text:'work',sourceKind:'user'}).turn.turn_id;
  f.store.endTurn(turnId,'completed');
  f.tasks.attachDiffs(f.diffs);
  const work=f.diffs.before(task,turnId,run.runId);
  try{
    await captureStarted;
    await expectRemovalRefused(f,p.project.id,task,'正在捕获差异快照');
  } finally { finish();await work; }
});

it('R4 runs captures in parallel and makes cleanup exclusive before allowing the next capture',async()=>{
  function gate() {
    let release!:()=>void;
    const wait=new Promise<void>(resolve=>{release=resolve;});
    return {wait,release};
  }
  const inCapture=gate(), inCleanup=gate(), captureReady=gate(), cleanupReady=gate();
  const calls: DiffJob[] = [];
  const f=fixture(async job=>{
    calls.push(job);
    if(job.action==='capture' && calls.filter(x=>x.action==='capture').length<=2) {
      if(calls.length===2)captureReady.release();
      await inCapture.wait;
    }
    if(job.action==='release'){cleanupReady.release();await inCleanup.wait;return {released:true};}
    const stat=statSync(job.cwd);
    return {cwd:job.cwd,ino:String(stat.ino),dev:String(stat.dev),private:true,privateBytes:256};

  }), p=f.makeProject('parallel');
  writeFileSync(join(p.cwd,'source.txt'),'source');
  const next=()=>{
    const task=f.create(p,'parallel task');
    const turnId=f.store.acceptTurn({taskId:task,clientInputId:'input',text:'work',sourceKind:'user'}).turn.turn_id;
    const binding=f.store.createBinding({task_id:task,driver_id:'codex-app-server',profile_id:'test',continuation_hash:'a'.repeat(64),state_root:f.root,cwd_identity:p.cwd});
    f.store.insertRun({runId:task,taskId:task,bindingId:binding,generation:1,projectId:p.project.id,driverId:'codex-app-server',owner:{instanceId:'fixture',pid:process.pid,startedAt:null},launchPlanHash:'b'.repeat(64)});
    return f.diffs.before(task,turnId,task);
  };
  const first=next(),second=next();
  try{
    await captureReady.wait;
    const cleanup=f.diffs.cleanupRemovedTurn({turn_id:'cleanup',before_ref:JSON.stringify({cwd:p.cwd,private:false}),after_ref:null});
    const third=next();
    expect(calls.map(call=>call.action)).toEqual(['capture','capture']);
    inCapture.release();
    await cleanupReady.wait;
    expect(calls.map(call=>call.action)).toEqual(['capture','capture','release']);
    inCleanup.release();
    await Promise.all([first,second,cleanup,third]);
    expect(calls.map(call=>call.action)).toEqual(['capture','capture','release','capture']);
    expect(calls.at(-1)?.knownPrivateBytes).toBeGreaterThan(0);
    expect(f.db.prepare('SELECT COUNT(*) FROM agent_turn_changes WHERE before_ref IS NOT NULL').pluck().get()).toBe(3);
  } finally { inCapture.release();inCleanup.release(); }
});

it('R4 persists exponential retry up to one hour across cleanup attempts',async()=>{
  const f=fixture();
  await f.resources.close(); // Exercise due-row scheduling with the periodic runner stopped.
  const now=vi.spyOn(Date,'now');
  const t=Date.now();
  f.db.prepare("INSERT INTO agent_pending_cleanup(cleanup_id,kind,resource_json) VALUES('retry','snapshot',?)")
    .run(JSON.stringify({turn_id:'missing',before_ref:JSON.stringify({cwd:join(f.root,'missing')})}));
  try {
    for(let attempt=0,time=t;attempt<9;attempt++){
      now.mockReturnValue(time);
      await f.resources.retry();
      const next=time+Math.min(3600_000,60_000*2**attempt);
      expect(f.db.prepare("SELECT attempts,next_attempt_at FROM agent_pending_cleanup WHERE cleanup_id='retry'").get())
        .toEqual({attempts:attempt+1,next_attempt_at:next});
      now.mockReturnValue(next-1);
      await f.resources.retry();
      expect(f.db.prepare("SELECT attempts FROM agent_pending_cleanup WHERE cleanup_id='retry'").pluck().get()).toBe(attempt+1);
      time=next;
    }
  } finally { now.mockRestore(); }
});

it('S07 shows the pending stop until native completion and only closes the same run on explicit force stop',async()=>{
  const f=fixture(), p=f.makeProject('stopping'), task=f.create(p,'task'), run=await f.open(task);
  await f.runs.submit(run.runId,{clientInputId:'pending-stop',text:'work'});
  await f.tasks.stop(task);
  const progress=f.tasks.snapshot(task).stopping!;
  expect(progress.runId).toBe(run.runId);
  await expect(f.tasks.forceStop(task,run.runId,progress.requestedAt)).rejects.toThrow('仍在等待原生响应');
  const now=vi.spyOn(Date,'now').mockReturnValue(progress.forceAt);
  try{
    await expect(f.tasks.forceStop(task,run.runId,progress.requestedAt-1)).rejects.toThrow('已变化');
    expect(f.instances[0].closeCalls).toBe(0);
    await f.tasks.forceStop(task,run.runId,progress.requestedAt);
    expect(f.instances[0].closeCalls).toBe(1);
    expect(f.tasks.snapshot(task).stopping).toBeNull();
    const replacement=await f.open(task);
    await expect(f.tasks.forceStop(task,run.runId,progress.requestedAt)).rejects.toThrow('已变化');
    expect(f.runs.runForTask(task)?.runId).toBe(replacement.runId);
  } finally { now.mockRestore(); }
});
