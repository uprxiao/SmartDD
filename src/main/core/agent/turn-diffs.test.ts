import {it,expect,afterEach} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,statSync,utimesSync,realpathSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {GitWorkspaces,runWorkspaceCommand} from './git-workspaces';
import {runDiffJob,type TreeRef} from './turn-diff-worker';
import {TurnDiffs} from './turn-diffs';import {AgentStore} from './agent-store';import {runBundledMigrations} from '../../db/migrations';
const roots:string[]=[];afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'m14-turn-diff-'));roots.push(root);const cwd=join(root,'work'),storage=join(root,'shadow');mkdirSync(cwd);return{root,cwd,storage};}
const git=async(cwd:string,...args:string[])=>{const r=await runWorkspaceCommand(cwd,'git',args);if(r.code)throw Error(r.stderr);return r.stdout.trim();};
it('A65/A73: real Git snapshots preserve HEAD and the user index, include unstaged/deleted/binary files, and never follow outside symlink bytes',async()=>{
 const f=fixture();await git(f.cwd,'init','-q','-b','main');await git(f.cwd,'config','user.name','Fixture');await git(f.cwd,'config','user.email','fixture@example.invalid');writeFileSync(join(f.cwd,'a.txt'),'base\n');writeFileSync(join(f.cwd,'gone.txt'),'gone\n');await git(f.cwd,'add','-A');await git(f.cwd,'commit','-qm','base');writeFileSync(join(f.cwd,'a.txt'),'staged\n');await git(f.cwd,'add','a.txt');writeFileSync(join(f.cwd,'a.txt'),'before\n');writeFileSync(join(f.root,'secret'),'outside');symlinkSync(join(f.root,'secret'),join(f.cwd,'link'));
 const head=await git(f.cwd,'rev-parse','HEAD'),index=readFileSync(join(f.cwd,'.git/index'));
 const before=await runDiffJob({...f,action:'capture',turnId:'turn1',side:'before'}) as TreeRef;
 writeFileSync(join(f.cwd,'a.txt'),'after\n');rmSync(join(f.cwd,'gone.txt'));writeFileSync(join(f.cwd,'binary'),Buffer.from([0,1,2]));
 const after=await runDiffJob({...f,action:'capture',turnId:'turn1',side:'after'}) as TreeRef;const changes=await runDiffJob({...f,action:'changes',turnId:'turn1',before,after}) as any;
 expect(changes.files.map((x:any)=>x.path)).toEqual(['a.txt','binary','gone.txt']);expect(changes.files.find((x:any)=>x.path==='binary').binary).toBe(true);expect(await runDiffJob({...f,action:'patch',turnId:'turn1',before,after,path:'a.txt'})).toMatchObject({patch:expect.stringContaining('+after')});
 expect(await git(f.cwd,'rev-parse','HEAD')).toBe(head);expect(readFileSync(join(f.cwd,'.git/index'))).toEqual(index);expect((await git(f.cwd,'show',before.commit+':link'))).toBe(join(f.root,'secret'));
},15000);

it('A73 captures a registered linked worktree below the private home while preserving the application data exclusion',async()=>{
 const f=fixture(),home=join(realpathSync(f.root),'home'),db=new Database(':memory:');
 mkdirSync(home);
 runBundledMigrations(db);
 const store=new AgentStore(db),workspaces=new GitWorkspaces({store,home});
 const cwd=join(realpathSync(f.cwd),'module');
 mkdirSync(cwd);
 writeFileSync(join(cwd,'a.txt'),'before\n');
 await git(f.cwd,'init','-q','-b','main');
 await git(f.cwd,'add','-A');
 await git(f.cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
 const task=(title:string)=>store.createTask({projectId:null,dirId:null,cwd,title,selection:{profileId:'p',driverId:'codex-app-server',tier:'ask'}});
 const parentId=task('parent'),childId=task('child');
 try {
  const child=await workspaces.create({parentTaskId:parentId,childTaskId:childId,projectId:'fixture',projectName:'Fixture',title:'child',cwd});
  expect(child).not.toBeNull();
  const childCwd=child!.cwd,userData=join(childCwd,'host-data');
  mkdirSync(userData);
  writeFileSync(join(userData,'metadata.txt'),'never captured\n');
  const capture=(taskId:string,turnId:string,side:'before'|'after')=>runDiffJob({
   action:'capture',cwd:childCwd,storage:f.storage,turnId,side,excluded:workspaces.snapshotExclusions(taskId,childCwd,userData),
  }) as Promise<TreeRef>;
  const before=await capture(childId,'registered','before');
  writeFileSync(join(childCwd,'a.txt'),'after\n');
  writeFileSync(join(userData,'metadata.txt'),'still excluded\n');
  const after=await capture(childId,'registered','after');
  const changes=await runDiffJob({action:'changes',cwd:childCwd,storage:f.storage,turnId:'registered',before,after});
  expect(changes).toEqual({files:[{path:'module/a.txt',binary:false,added:1,removed:1}]});
  const patch=await runDiffJob({action:'patch',cwd:childCwd,storage:f.storage,turnId:'registered',before,after,path:'module/a.txt'});
  expect(patch).toMatchObject({beforeText:'before\n',afterText:'after\n',patch:expect.stringContaining('+after')});
  const unrelated=await capture(parentId,'unregistered','before');
  expect(await git(childCwd,'ls-tree','-r','--name-only',unrelated.commit)).toBe('');
 } finally { db.close(); }
},15000);
it('A73: ordinary/SVN roots use a private bare store, respect ignores, and fail without publishing a complete ref on budget exhaustion',async()=>{
 const f=fixture();mkdirSync(join(f.cwd,'.svn'));writeFileSync(join(f.cwd,'.svn','private'),'never');writeFileSync(join(f.cwd,'.gitignore'),'ignored\n');writeFileSync(join(f.cwd,'ignored'),'skip');writeFileSync(join(f.cwd,'a.txt'),'one');const before=await runDiffJob({...f,action:'capture',turnId:'plain',side:'before'}) as TreeRef;expect(before.private).toBe(true);expect(await git(f.cwd,'--git-dir='+before.gitDir,'ls-tree','-r','--name-only',before.commit)).toBe('.gitignore\na.txt');
 await expect(runDiffJob({...f,action:'capture',turnId:'limited',side:'before',limits:{files:1}})).rejects.toThrow('文件数量');expect((await runWorkspaceCommand(f.cwd,'git',['--git-dir='+before.gitDir,'show-ref','--verify','refs/willyou/turns/limited/before'])).code).not.toBe(0);expect(readFileSync(join(f.cwd,'.svn/private'),'utf8')).toBe('never');
});
it('A73: service preserves incomplete first capture, never adopts a later before tree, and restores interrupted captures as incomplete',async()=>{
 const f=fixture(),db=new Database(':memory:');runBundledMigrations(db);const store=new AgentStore(db);const task=store.createTask({projectId:null,dirId:null,cwd:f.cwd,title:'diff',selection:{profileId:'p',driverId:'codex-app-server',tier:'ask'}});const binding=store.createBinding({task_id:task,driver_id:'codex-app-server',profile_id:'p',continuation_hash:'a'.repeat(64),state_root:'/fixture/state',cwd_identity:f.cwd});store.insertRun({runId:'diff-run',taskId:task,bindingId:binding,generation:1,projectId:null,driverId:'codex-app-server',owner:{instanceId:'fixture',pid:process.pid,startedAt:null},launchPlanHash:'b'.repeat(64)});const accepted=store.acceptTurn({taskId:task,clientInputId:'diff-input',text:'work',sourceKind:'user'});let resolve!:(v:any)=>void;const diffs=new TurnDiffs({store,storage:f.storage,changed:()=>{},execute:job=>job.action==='capture'?new Promise(r=>resolve=r):Promise.resolve({released:true})});await diffs.before(task,accepted.turn.turn_id,'diff-run');expect(diffs.list(task)[0]).toMatchObject({status:'incomplete'});resolve({});await diffs.close();db.close();
});
it('A73: incremental stat reuse still detects same-size edits with restored mtime, and rejects tracked files whose parent has become an outside symlink',async()=>{
 const f=fixture();await git(f.cwd,'init','-q','-b','main');await git(f.cwd,'config','user.name','Fixture');await git(f.cwd,'config','user.email','fixture@example.invalid');mkdirSync(join(f.cwd,'dir'));writeFileSync(join(f.cwd,'dir','a'),'first');await git(f.cwd,'add','-A');await git(f.cwd,'commit','-qm','base');
 const before=await runDiffJob({...f,action:'capture',turnId:'cached1',side:'before'}) as TreeRef,unchanged=await runDiffJob({...f,action:'capture',turnId:'cached2',side:'before'}) as TreeRef;expect(unchanged.tree).toBe(before.tree);const prior=statSync(join(f.cwd,'dir','a'));writeFileSync(join(f.cwd,'dir','a'),'other');utimesSync(join(f.cwd,'dir','a'),prior.atime,prior.mtime);const after=await runDiffJob({...f,action:'capture',turnId:'cached1',side:'after'}) as TreeRef;expect(after.tree).not.toBe(before.tree);
 rmSync(join(f.cwd,'dir'),{recursive:true});mkdirSync(join(f.root,'outside'));writeFileSync(join(f.root,'outside','a'),'outside secret');symlinkSync(join(f.root,'outside'),join(f.cwd,'dir'));await expect(runDiffJob({...f,action:'capture',turnId:'escaped',side:'after'})).rejects.toThrow('目录链接越界');
});

it('A73: cancellation leaves neither a complete ref nor temporary snapshot files and never changes source bytes',async()=>{
 const f=fixture();writeFileSync(join(f.cwd,'a'),'source');const controller=new AbortController();await expect(runDiffJob({...f,action:'capture',turnId:'cancelled',side:'before'},{signal:controller.signal,progress:()=>controller.abort(Error('cancelled by user'))})).rejects.toThrow('cancelled');expect(readFileSync(join(f.cwd,'a'),'utf8')).toBe('source');expect((await import('node:fs')).readdirSync(f.storage).some(n=>n.startsWith('index-'))).toBe(false);
});

it('A65 keeps explicit snapshot cancellation after the worker reports a later failure', async () => {
 const f = fixture(), db = new Database(':memory:');
 runBundledMigrations(db);
 const store = new AgentStore(db);
 const taskId = store.createTask({ projectId: null, dirId: null, cwd: f.cwd, title: 'diff', selection: { profileId: 'p', driverId: 'codex-app-server', tier: 'ask' } });
 const bindingId = store.createBinding({ task_id: taskId, driver_id: 'codex-app-server', profile_id: 'p', continuation_hash: 'a'.repeat(64), state_root: f.root, cwd_identity: f.cwd });
 store.insertRun({ runId: 'test-run', taskId, bindingId, generation: 1, projectId: null, driverId: 'codex-app-server', owner: { instanceId: 'fixture', pid: process.pid, startedAt: null }, launchPlanHash: 'b'.repeat(64) });
 const turnId = store.acceptTurn({ taskId, clientInputId: 'cancel-diff', text: 'work', sourceKind: 'user' }).turn.turn_id;
 let started!: () => void, fail!: (error: Error) => void;
 const entered = new Promise<void>(resolve => { started = resolve; });
 const diffs = new TurnDiffs({ store, storage: f.storage, changed: () => {}, execute: () => new Promise((_, reject) => { fail = reject; started(); }) });
 try {
  const capture = diffs.before(taskId, turnId, 'test-run');
  await entered;
  expect(diffs.cancel(taskId, turnId)).toEqual({ canceled: true });
  fail(Error('Git 快照命令超时或超限'));
  await capture;
  const reason = '用户取消差异捕获；本轮不可补造';
  expect(diffs.turn(taskId, turnId)).toMatchObject({ status: 'incomplete', reason, preparing: false });
  expect(store.items(taskId).filter(item => item.type === 'files_changed')).toEqual([expect.objectContaining({ revision: 1, payload: expect.objectContaining({ reason }) })]);
  expect(diffs.cancel(taskId, turnId)).toEqual({ canceled: false });
 } finally { await diffs.close(); db.close(); }
});

it('A34 (D06-81) shows the real reason once a first background snapshot fails after the turn moved on, without overriding cancel', async () => {
 const f = fixture(), db = new Database(':memory:');
 runBundledMigrations(db);
 const store = new AgentStore(db);
 const taskId = store.createTask({ projectId: null, dirId: null, cwd: f.cwd, title: 'diff', selection: { profileId: 'p', driverId: 'codex-app-server', tier: 'ask' } });
 const bindingId = store.createBinding({ task_id: taskId, driver_id: 'codex-app-server', profile_id: 'p', continuation_hash: 'a'.repeat(64), state_root: f.root, cwd_identity: f.cwd });
 store.insertRun({ runId: 'test-run', taskId, bindingId, generation: 1, projectId: null, driverId: 'codex-app-server', owner: { instanceId: 'fixture', pid: process.pid, startedAt: null }, launchPlanHash: 'b'.repeat(64) });
 const turnId = store.acceptTurn({ taskId, clientInputId: 'slow-first', text: 'work', sourceKind: 'user' }).turn.turn_id;
 const fails: ((error: Error) => void)[] = [];
 const diffs = new TurnDiffs({ store, storage: f.storage, changed: () => {}, execute: () => new Promise((_, reject) => { fails.push(reject); }) });
 try {
  await diffs.before(taskId, turnId, 'test-run');
  expect(diffs.turn(taskId, turnId)).toMatchObject({ status: 'incomplete', reason: expect.stringContaining('首次快照仍在后台准备'), preparing: true });
  fails[0](Error('文件数量或内容规模超过已验证范围（20481 文件／10 GiB）'));
  for (let i = 0; i < 50 && diffs.turn(taskId, turnId).preparing; i++) await new Promise(r => setTimeout(r, 10));
  const reason = '首次快照未完成：文件数量或内容规模超过已验证范围（20481 文件／10 GiB）；本轮差异不可用，任务可以继续';
  expect(diffs.turn(taskId, turnId)).toMatchObject({ status: 'incomplete', reason, preparing: false });
  expect(store.items(taskId).filter(item => item.type === 'files_changed').at(-1)).toEqual(expect.objectContaining({ payload: expect.objectContaining({ reason }) }));

  const canceledTurn = store.acceptTurn({ taskId, clientInputId: 'slow-cancel', text: 'more', sourceKind: 'user' }).turn.turn_id;
  await diffs.before(taskId, canceledTurn, 'test-run');
  expect(diffs.cancel(taskId, canceledTurn)).toEqual({ canceled: true });
  fails[1](Error('差异捕获已取消'));
  for (let i = 0; i < 50 && diffs.turn(taskId, canceledTurn).preparing; i++) await new Promise(r => setTimeout(r, 10));
  expect(diffs.turn(taskId, canceledTurn)).toMatchObject({ status: 'incomplete', reason: '用户取消差异捕获；本轮不可补造' });
 } finally { await diffs.close(); db.close(); }
});

it('A65: long Unicode diff bodies use bounded, hash-bound chunks and preserve both original documents exactly',async()=>{
 const f=fixture(),db=new Database(':memory:');runBundledMigrations(db);const store=new AgentStore(db),taskId=store.createTask({projectId:null,dirId:null,cwd:f.cwd,title:'large diff',selection:{driverId:'codex-app-server',profileId:'p',tier:'ask'}}),turn=store.acceptTurn({taskId,clientInputId:'large-diff-input',text:'change',sourceKind:'user'}).turn,body={path:'a.txt',binary:false,patch:'omitted test patch',beforeText:'中🙂\\'.repeat(80000),afterText:'后🙂\\'.repeat(80000)};
 const ref=await runDiffJob({...f,action:'capture',turnId:turn.turn_id,side:'before'}) as TreeRef;
 db.prepare("INSERT INTO agent_turn_changes(turn_id,task_id,before_ref,after_ref,changed_files_json,status) VALUES(?,?,?,?,?,'complete')").run(turn.turn_id,taskId,JSON.stringify(ref),JSON.stringify(ref),'[]');const service=new TurnDiffs({store,storage:f.storage,changed:()=>{},execute:async job=>job.action==='patch'?body:runDiffJob(job)});
 try{const preview=await service.patch(taskId,turn.turn_id,'a.txt');expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThan(256*1024);expect(preview.bodyHash).toBeTruthy();let offset=0,text='';for(let i=0;i<100;i++){const chunk=await service.patchBody(taskId,turn.turn_id,'a.txt',preview.bodyHash!,offset);expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThan(256*1024);text+=chunk.chunk;if(chunk.done)break;expect(chunk.next).toBeGreaterThan(offset);offset=chunk.next;}expect(JSON.parse(text)).toEqual(body);await expect(service.patchBody(taskId,turn.turn_id,'a.txt','0'.repeat(64),0)).rejects.toThrow('版本已变化');}finally{await service.close();db.close();}
});

it('R4 creates and uses one private Git store for two simultaneous cold captures',async()=>{
 const f=fixture();
 writeFileSync(join(f.cwd,'a.txt'),'same bytes');
 const capture=(turnId:string)=>runDiffJob({...f,action:'capture',turnId,side:'before'}) as Promise<TreeRef>;
 const [first,second]=await Promise.all([capture('first'),capture('second')]);
 expect(first.gitDir).toBe(second.gitDir);
 expect(first.tree).toBe(second.tree);
 expect(first.privateBytes).toBeGreaterThan(0);
 expect(await git(f.cwd,'--git-dir='+first.gitDir,'rev-parse',first.ref)).toBe(first.commit);
 expect(await git(f.cwd,'--git-dir='+second.gitDir,'rev-parse',second.ref)).toBe(second.commit);
});
