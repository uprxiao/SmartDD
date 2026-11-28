import {afterEach,describe,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runBundledMigrations} from '@main/db/migrations';
import {ScheduleStore} from './store';
import {ScheduleWorkspaces} from './workspace';
import {scheduledWorkspaceForTask} from './workspace-authority';
import {AgentStore} from '../agent/agent-store';
import type {ScheduleConfig,SchedulePlan} from '@shared/schedule';
const cleanup:(()=>void|Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const config:ScheduleConfig={title:'计划',prompt:'只测试自己的文件夹',projectId:null,dirId:null,cwd:null,workspace:'directory',baseRef:null,destination:'new',boundTask:null,profileId:'p',tier:'ask',delegation:false,notifyCompleted:false};
const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'m16-schedule-workspace-')),db=new Database(':memory:');
  cleanup.push(()=>{db.close();rmSync(root,{recursive:true,force:true});});
  db.pragma('foreign_keys=ON');runBundledMigrations(db);
  const home=join(root,'home'),user=join(root,'data'),repo=join(root,'repo'),plain=join(root,'plain'),child=join(repo,'child');
  for(const dir of [home,user,repo,child,plain])mkdirSync(dir,{recursive:true});
  git(repo,'init','-b','main');git(repo,'config','user.name','M16 test fixture');git(repo,'config','user.email','fixture@example.invalid');
  writeFileSync(join(repo,'value.txt'),'main');writeFileSync(join(child,'only.txt'),'registered child');
  git(repo,'add','.');git(repo,'commit','-m','main');
  git(repo,'checkout','-b','feature');writeFileSync(join(repo,'value.txt'),'feature');git(repo,'add','value.txt');git(repo,'commit','-m','feature');
  const base=git(repo,'rev-parse','HEAD');git(repo,'checkout','main');writeFileSync(join(repo,'value.txt'),'dirty main');
  db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('j','Git fixture',1,1),('d','Directory fixture',1,1)");
  const insert=db.prepare('INSERT INTO project_dirs(id,project_id,label,path,created_at,updated_at) VALUES(?,?,?,?,1,1)');
  insert.run('j1','j','repo',repo);insert.run('j2','j','child',child);insert.run('d1','d','plain',plain);
  const store=new ScheduleStore(db),workspaces=new ScheduleWorkspaces(db,home,user);
  const save=(patch:Partial<ScheduleConfig>)=>store.save({config:{...config,...patch},schedule:{type:'interval',minutes:60,zone:'UTC'},grace:60,enabled:false});
  function claim(plan:SchedulePlan,key:string){const c=store.claim(plan.id,{now:Date.now(),trigger:'manual',expected:plan.revision,requestId:key});if(!('run'in c))throw Error('claim failed');return store.begin(c.run.id,Date.now());}
  return{root,db,repo,plain,child,home,user,base,store,workspaces,save,claim};
}
describe('M16 real Git/workspace preparation in isolated temp repositories',()=>{
  it('A09/A10 resolves exact registered child and isolates managed/local workspace with no fabricated Project',async()=>{
    const f=fixture(),p=f.save({projectId:'j',dirId:'j2'});expect(await f.workspaces.prepare(f.claim(p,'one'))).toBe(realpathSync(f.child));
    const managed=f.save({}),dir=join(f.user,'schedule-workspaces',managed.id);
    expect(existsSync(dir)).toBe(false);
    const first=f.claim(managed,'managed-a');expect(await f.workspaces.prepare(first)).toBe(realpathSync(dir));
    f.store.finish(first.id,'completed',Date.now());expect(await f.workspaces.prepare(f.claim(managed,'managed-b'))).toBe(realpathSync(dir));
    const local=f.save({cwd:f.plain});expect(await f.workspaces.prepare(f.claim(local,'local'))).toBe(realpathSync(f.plain));
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({count:2});
  });
  it('A11 rejects worktree on a non-Git registered directory and invalid selected branch',async()=>{
    const f=fixture();
    await expect(f.workspaces.validate({...config,projectId:'d',dirId:'d1',workspace:'plan-worktree',baseRef:'main'})).rejects.toThrow();
    await expect(f.workspaces.validate({...config,projectId:'j',dirId:'j1',workspace:'plan-worktree',baseRef:'missing-ref'})).rejects.toThrow();
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_workspace_links').get()).toEqual({count:0});
    expect(existsSync(join(f.home,'.willyou','worktrees'))).toBe(false);
  });
  it('A12 creates one plan-owned worktree pinned to actual selected commit, independent of subsequent base advancement',async()=>{
    const f=fixture(),p=f.save({projectId:'j',dirId:'j1',workspace:'plan-worktree',baseRef:'feature'});
    const first=f.claim(p,'first'),path=await f.workspaces.prepare(first);expect(git(path,'rev-parse','HEAD')).toBe(f.base);
    expect(readFileSync(join(path,'value.txt'),'utf8')).toBe('feature');expect(readFileSync(join(f.repo,'value.txt'),'utf8')).toBe('dirty main');
    const branch=git(path,'branch','--show-current');f.store.finish(first.id,'completed',Date.now());
    const main=git(f.repo,'rev-parse','main');git(f.repo,'branch','-f','feature',main);
    const second=f.claim(p,'second');expect(await f.workspaces.prepare(second)).toBe(path);
    expect(git(path,'branch','--show-current')).toBe(branch);expect(git(path,'rev-parse','HEAD')).toBe(f.base);expect(second.taskId).not.toBe(first.taskId);
    expect(f.store.run(second.id)?.workspaceId).toBe(f.store.run(first.id)?.workspaceId);
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_workspace_links').get()).toEqual({count:1});
    f.store.archive(p.id,p.revision);expect(existsSync(path)).toBe(true);expect(git(path,'rev-parse','HEAD')).toBe(f.base);
  });
  it('records the existing plan-owned link on each bound reuse occurrence, without a new Git worktree',async()=>{
    const f=fixture(),p=f.save({projectId:'j',dirId:'j1',workspace:'plan-worktree',baseRef:'feature',destination:'reuse'});
    const first=f.claim(p,'first'),cwd=await f.workspaces.prepare(first);const original=f.store.run(first.id)!.workspaceId;
    f.store.finish(first.id,'completed',Date.now());const two=f.claim(p,'second');
    expect(two.taskId).toBe(first.taskId);expect(await f.workspaces.reuseBoundPlan(two,cwd)).toBe(cwd);
    expect(f.store.run(two.id)?.workspaceId).toBe(original);expect(f.workspaces.listForPlan(p.id)).toHaveLength(1);
  });
  it('A13 new-per-run uses independently resolved base and real separate branch/path, never copies dirty main',async()=>{
    const f=fixture(),p=f.save({projectId:'j',dirId:'j1',workspace:'run-worktree',baseRef:'feature'});
    const one=f.claim(p,'one'),a=await f.workspaces.prepare(one);expect(git(a,'rev-parse','HEAD')).toBe(f.base);f.store.finish(one.id,'completed',Date.now());
    const main=git(f.repo,'rev-parse','main');git(f.repo,'branch','-f','feature',main);
    const two=f.claim(p,'two'),b=await f.workspaces.prepare(two);
    expect(a).not.toBe(b);expect(git(a,'branch','--show-current')).not.toBe(git(b,'branch','--show-current'));expect(git(b,'rev-parse','HEAD')).toBe(main);
    expect(readFileSync(join(b,'value.txt'),'utf8')).toBe('main');expect(readFileSync(join(f.repo,'value.txt'),'utf8')).toBe('dirty main');
  });
  it('only the exact scheduled task owns the actual registered Git worktree, never an unrelated task or modified branch',async()=>{
    const f=fixture(),p=f.save({projectId:'j',dirId:'j1',workspace:'plan-worktree',baseRef:'feature'});
    const run=f.claim(p,'one'),cwd=await f.workspaces.prepare(run),tasks=new AgentStore(f.db);
    const selection={profileId:'fixture',driverId:'codex-app-server' as const,tier:'ask' as const};
    tasks.createTask({taskId:run.taskId!,projectId:'j',dirId:'j1',cwd,title:'owned',selection});
    expect(scheduledWorkspaceForTask(f.db,run.taskId!,f.home)?.path).toBe(cwd);
    const unrelated=tasks.createTask({projectId:'j',dirId:'j1',cwd,title:'unrelated',selection});
    expect(scheduledWorkspaceForTask(f.db,unrelated,f.home)).toBeUndefined();
    expect(()=>scheduledWorkspaceForTask(f.db,run.taskId!,f.plain)).toThrow();
    const original=git(cwd,'branch','--show-current');git(cwd,'checkout','--detach');
    expect(()=>scheduledWorkspaceForTask(f.db,run.taskId!,f.home)).toThrow(/登记身份/);
    git(cwd,'checkout',original);expect(scheduledWorkspaceForTask(f.db,run.taskId!,f.home)?.branch).toBe(original);
  });
  it('A14 explicit clean removal checks real references, retains branch, and never recreates the cleaned owner',async()=>{
    const f=fixture(),p=f.save({projectId:'j',dirId:'j1',workspace:'plan-worktree',baseRef:'feature'});
    const first=f.claim(p,'one'),cwd=await f.workspaces.prepare(first),w=f.workspaces.listForPlan(p.id)[0];
    f.store.finish(first.id,'completed',Date.now());const tasks=new AgentStore(f.db);
    tasks.createTask({taskId:first.taskId!,projectId:'j',dirId:'j1',cwd,title:'current',selection:{profileId:'p',driverId:'codex-app-server',tier:'ask'}});
    await expect(f.workspaces.cleanup(p.id,w.id)).rejects.toThrow(/引用/);
    expect(existsSync(cwd)).toBe(true);
    tasks.deleteTask(first.taskId!,()=>{f.db.prepare('DELETE FROM agent_events WHERE task_id=?').run(first.taskId);f.db.prepare('DELETE FROM agent_tasks WHERE task_id=?').run(first.taskId);});
    writeFileSync(join(cwd,'dirty.txt'),'do not remove');
    await expect(f.workspaces.cleanup(p.id,w.id)).rejects.toThrow();
    expect(existsSync(join(cwd,'dirty.txt'))).toBe(true);rmSync(join(cwd,'dirty.txt'));
    await f.workspaces.cleanup(p.id,w.id);expect(existsSync(cwd)).toBe(false);expect(git(f.repo,'rev-parse',w.branch!)).toBe(f.base);
    const next=f.claim(p,'two');await expect(f.workspaces.prepare(next)).rejects.toThrow(/已由用户清理/);
  });
  it('A14 validates exact durable prepared result, flags missing tree rather than creating a duplicate',async()=>{
    const f=fixture(),p=f.save({projectId:'j',dirId:'j1',workspace:'plan-worktree',baseRef:'feature'});
    const one=f.claim(p,'one'),a=await f.workspaces.prepare(one);expect(existsSync(a)).toBe(true);
    f.db.prepare("UPDATE schedule_workspace_links SET status='preparing' WHERE owner_id=?").run(p.id);
    expect(await f.workspaces.prepare(one)).toBe(a);
    f.store.finish(one.id,'completed',Date.now());git(f.repo,'worktree','remove',a);
    const two=f.claim(p,'two');await expect(f.workspaces.prepare(two)).rejects.toThrow();
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM schedule_workspace_links').get()).toEqual({count:1});
    expect(f.db.prepare('SELECT status FROM schedule_workspace_links WHERE owner_id=?').get(p.id)).toEqual({status:'needs_review'});
    expect(existsSync(a)).toBe(false);
  });
});
