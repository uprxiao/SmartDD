import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect,it } from 'vitest';
import { existsSync, mkdtempSync,mkdirSync,readFileSync,realpathSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { AgentStore } from './agent-store';
import { GitWorkspaces,runWorkspaceCommand } from './git-workspaces';
import { FileSourceResolver } from '../files/sources';

const command = async(cwd:string,bin:string,...args:string[])=>{
  const result=await runWorkspaceCommand(cwd,bin,args,20_000);
  expect(result.code,result.stderr).toBe(0);
  return result.stdout.trim();
};
const selection={driverId:'codex-app-server' as const,profileId:'fixture',tier:'ask' as const};

it('F16 E06 actual repository and worktree mechanics, isolated plan association feasibility',async()=>{
  const base=realpathSync(mkdtempSync(join(tmpdir(),'m16-e06-real-')));
  const git=join(base,'git'),svnRepo=join(base,'svn-repository'),svn=join(base,'svn-work'),plain=join(base,'plain'),home=join(base,'home'),managed=join(home,'.willyou','standalone','plan-a');
  for(const dir of [git,plain,home,managed])mkdirSync(dir,{recursive:true});
  const sqlite=new Database(join(base,'fixture.db')); sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);
  const store=new AgentStore(sqlite);
  const resolver=new FileSourceResolver(drizzle(sqlite,{schema}));
  const workspaces=new GitWorkspaces({store,home,recoverySafe:async()=>true});
  const g=(...args:string[])=>command(git,'git',...args);
  let evidence:any={base,tools:{git:null,svn:null},observations:{}};
  try{
    evidence.tools={git:await g('--version'),svn:await command(base,'svn','--version','--quiet')};
    await command(base,'svnadmin','create',svnRepo);
    await command(base,'svn','checkout',pathToFileURL(svnRepo).href,svn);
    writeFileSync(join(svn,'versioned.txt'),'real svn fixture');
    await command(svn,'svn','add','versioned.txt');
    await command(svn,'svn','commit','--non-interactive','-m','local fixture');
    expect((await command(svn,'svn','info','--show-item','wc-root'))).toBe(svn);
    expect(await workspaces.detect(svn)).toBeNull();
    expect(await workspaces.detect(plain)).toBeNull();
    await g('init','-qb','main');
    await g('config','user.name','Synthetic QA');await g('config','user.email','qa@example.invalid');
    mkdirSync(join(git,'pkg'));
    writeFileSync(join(git,'pkg','file.txt'),'initial');
    await g('add','-A');await g('commit','-qm','initial');
    await g('switch','-qc','chosen-base');
    writeFileSync(join(git,'pkg','file.txt'),'chosen base');
    await g('add','-A');await g('commit','-qm','explicit chosen branch');
    const chosenCommit=await g('rev-parse','HEAD');
    await g('switch','-q','main');
    writeFileSync(join(git,'main.txt'),'new main');
    await g('add','-A');await g('commit','-qm','fresh main');
    const mainCommit=await g('rev-parse','HEAD');
    writeFileSync(join(git,'uncommitted.txt'),'do not copy');
    expect(chosenCommit).not.toBe(mainCommit);
    expect(await workspaces.detect(join(git,'pkg'))).toEqual({root:git,cwd:join(git,'pkg'),branch:'main'});
    sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('project','Synthetic project',1,1)");
    for(const [id,path] of [['git-dir',git],['svn-dir',svn],['plain-dir',plain]])
      sqlite.prepare("INSERT INTO project_dirs(id,project_id,label,path,created_at,updated_at) VALUES(?,'project',?,?,1,1)").run(id,id,path);
    const makeTask=(title:string,cwd:string,dir:string|null='git-dir',projectId:string|null='project')=>
      store.createTask({projectId,dirId:dir,cwd,title,selection});
    const original=makeTask('original project directory',git);
    expect(store.task(original)?.cwd).toBe(git);
    expect(resolver.sources({kind:'task',taskId:original})[0].path).toBe(git);
    for(const [name,dir,id] of [['SVN',svn,'svn-dir'],['ordinary',plain,'plain-dir']]){
      const task=makeTask(name,dir,id);
      const unavailable=await workspaces.create({parentTaskId:task,childTaskId:task,cwd:dir,projectId:'project',projectName:'Synthetic project',title:name});
      expect(unavailable).toBeNull();
      expect(store.task(task)?.cwd).toBe(dir);
      expect(resolver.sources({kind:'task',taskId:task})[0].path).toBe(dir);
    }
    // Experiment-only ownership seam: pass the actual first top-level task as
    // both identifiers to exercise the existing low-level child-oriented engine.
    // Production needs explicit plan/run ownership and a new top-level launch seam.
    sqlite.exec('CREATE TABLE experiment_plan_workspaces(plan_key TEXT PRIMARY KEY, owner_task TEXT NOT NULL, workspace_id TEXT NOT NULL, path TEXT NOT NULL, branch TEXT NOT NULL, base_commit TEXT NOT NULL)');
    const dedicatedOwner=makeTask('planned dedicated first',join(git,'pkg'));
    const prepare=(owner:string,title:string)=>workspaces.create({parentTaskId:owner,childTaskId:owner,cwd:join(git,'pkg'),projectId:'project',projectName:'Synthetic project',title,expectedRoot:git,expectedBranch:'main',baseCommit:chosenCommit});
    const dedicated=(await prepare(dedicatedOwner,'dedicated plan'))!;
    sqlite.prepare('INSERT INTO experiment_plan_workspaces VALUES(?,?,?,?,?,?)').run('plan-a',dedicatedOwner,dedicated.workspace.workspace_id,dedicated.workspace.path,dedicated.workspace.branch,chosenCommit);
    const readback=sqlite.prepare('SELECT * FROM experiment_plan_workspaces WHERE plan_key=?').get('plan-a') as {owner_task:string;path:string;branch:string};
    const same=(await prepare(readback.owner_task,'dedicated plan'))!;
    expect(same.workspace.workspace_id).toBe(dedicated.workspace.workspace_id);
    const later=makeTask('new top level session same dedicated directory',same.cwd);
    expect(store.task(later)?.cwd).toBe(dedicated.cwd);
    expect(resolver.sources({kind:'task',taskId:later})[0].path).toBe(dedicated.cwd);
    expect(store.task(later)?.parent_task_id).toBeNull();
    const perRunOwners=['run a','run b'].map(title=>makeTask(title,join(git,'pkg')));
    const pair=await Promise.all(perRunOwners.map(id=>prepare(id,'per run plan')));
    expect(new Set(pair.map(r=>r!.workspace.workspace_id)).size).toBe(2);
    expect(new Set(pair.map(r=>r!.workspace.path)).size).toBe(2);
    const all=[dedicated,...pair.map(r=>r!)];
    for(const item of all){
      expect(item.workspace.base_commit).toBe(chosenCommit);
      expect(await command(item.cwd,'git','rev-parse','HEAD')).toBe(chosenCommit);
      expect(readFileSync(join(item.cwd,'file.txt'),'utf8')).toBe('chosen base');
      expect(existsSync(join(item.workspace.path,'uncommitted.txt'))).toBe(false);
      expect(item.workspace.branch).toBeTruthy();
    }
    expect(await g('rev-parse','HEAD')).toBe(mainCommit);
    expect(await g('remote')).toBe('');
    expect(await g('status','--porcelain')).toBe('?? uncommitted.txt');
    sqlite.prepare('DELETE FROM experiment_plan_workspaces WHERE plan_key=?').run('plan-a');
    expect(existsSync(dedicated.workspace.path)).toBe(true);
    expect(await g('show-ref','--hash','refs/heads/'+dedicated.workspace.branch)).toBe(chosenCommit);
    const noProjectTasks=[makeTask('managed isolated workspace',managed,null,null),makeTask('unscoped selected directory',plain,null,null)];
    expect(sqlite.prepare('SELECT count(*) AS n FROM projects').get()).toEqual({n:1});
    for(const [index,task] of noProjectTasks.entries()){
      const actual=store.task(task)!;expect(actual.project_id).toBeNull();expect(actual.dir_id).toBeNull();
      const sources=resolver.sources({kind:'task',taskId:task});
      expect(sources).toEqual([{kind:'task-cwd',id:task,path:[managed,plain][index],label:'任务启动目录',projectId:null}]);
      writeFileSync(join(actual.cwd,'output.txt'),'fixture scoped local file');
      expect(readFileSync(join(actual.cwd,'output.txt'),'utf8')).toBe('fixture scoped local file');
    }
    evidence.observations={mainCommit,chosenCommit,svnCheckout:svn,plain,
      projectCount:1,worktree:[...all.map(r=>({path:r.workspace.path,branch:r.workspace.branch,baseCommit:r.workspace.base_commit,cwd:r.cwd,deps:JSON.parse(r.workspace.deps_result!)}))],
      stableDedicatedReuse:true,distinctPerRun:true,retainedAfterPlanLinkRemoved:true,noProjectTasks:noProjectTasks.map(id=>({id,cwd:store.task(id)!.cwd,sources:resolver.sources({kind:'task',taskId:id})})),
      scope:'real Git/SVN/files/SQLite production services with experiment-only top-level ownership association; no Scheduler, renderer or native Agent'};
    expect(store.task(dedicatedOwner)?.cwd).toBe(join(git,'pkg')); // slot creation does not update launch location itself
    expect(workspaces.workspace(later)).toBeUndefined(); // subsequent top-level task needs explicit association in production
    evidence.status='passed';
  }finally{
    sqlite.close();
    writeFileSync(join(base,'result.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
    console.log('M16_E06_ROOT='+base);
  }
},30_000);
