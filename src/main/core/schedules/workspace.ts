import {mkdir,realpath,stat} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import type {ScheduleRun} from '@shared/schedule';
import {runWorkspaceCommand} from '../agent/git-workspaces';
import {realpathSync,statSync} from 'node:fs';
function registeredProjectCwd(db:Database.Database,projectId:string,dirId:string){const row=db.prepare('SELECT d.path FROM project_dirs d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.id=? AND p.archived_at IS NULL').get(dirId,projectId) as {path:string}|undefined;if(!row)throw new Error('原项目目录不可用');const cwd=realpathSync(row.path);if(!statSync(cwd).isDirectory())throw new Error('原项目目录不可用');return cwd;}
type Link={id:string;owner_kind:string;owner_id:string;project_id:string|null;repo:string|null;path:string;base_ref:string|null;base_commit:string|null;branch:string|null;status:string};
export class ScheduleWorkspaces{
  constructor(private readonly db:Database.Database,private readonly home:string,private readonly userData:string){}
  private link(kind:string,id:string){return this.db.prepare('SELECT * FROM schedule_workspace_links WHERE owner_kind=? AND owner_id=?').get(kind,id) as Link|undefined;}
  private async checked(path:string){const cwd=await realpath(path);if(!(await stat(cwd)).isDirectory())throw new Error('工作目录不可用');return cwd;}
  private async git(cwd:string,args:string[]){const result=await runWorkspaceCommand(cwd,'git',args);if(result.code!==0)throw new Error('Git 工作区准备失败：'+result.stderr.slice(-500));return result.stdout.trim();}
  async validate(config:ScheduleRun['snapshot']['config']):Promise<void>{
    if(config.projectId)registeredProjectCwd(this.db,config.projectId,config.dirId!);
    else if(config.cwd){if(!isAbsolute(config.cwd))throw new Error('请选择绝对工作目录');await this.checked(config.cwd);}
    if(config.workspace!=='directory'){
      const cwd=registeredProjectCwd(this.db,config.projectId!,config.dirId!);await this.git(cwd,['rev-parse','--show-toplevel']);await this.git(cwd,['rev-parse','--verify','--end-of-options',config.baseRef!+'^{commit}']);
    }
  }
  listForPlan(planId:string):Link[]{return this.db.prepare("SELECT DISTINCT w.* FROM schedule_workspace_links w LEFT JOIN schedule_occurrences r ON r.workspace_id=w.id WHERE w.owner_kind='plan' AND w.owner_id=? OR w.owner_kind='run' AND r.plan_id=? ORDER BY w.path").all(planId,planId) as Link[];}
  /** User-triggered ordinary Git removal; never force, remove a branch, or
   * clean a directory that still has an actual task/occurrence owner. */
  async cleanup(planId:string,id:string):Promise<void>{
    const row=this.listForPlan(planId).find(w=>w.id===id);
    if(!row||row.status!=='ready'||!row.repo||!row.branch)throw new Error('工作树登记不可用');
    const checkReferences=()=>{
      const live=this.db.prepare("SELECT t.cwd FROM tasks t JOIN agent_tasks a ON a.task_id=t.id").all() as {cwd:string}[];
      if(live.some(t=>{try{const cwd=realpathSync(t.cwd);return cwd===row.path||cwd.startsWith(row.path+'/');}catch{return t.cwd===row.path||t.cwd.startsWith(row.path+'/');}}))throw new Error('仍有任务引用此工作树，请先处理任务');
      if(this.db.prepare("SELECT 1 FROM schedule_occurrences WHERE workspace_id=? AND status IN ('claimed','preparing','dispatching','running','waiting','unknown')").get(id))throw new Error('工作树仍有正在运行的任务');
    };
    checkReferences();const root=await this.checked(join(this.home,'.willyou','worktrees')),path=await this.checked(row.path);
    if(path!==row.path||path!==join(root,'schedule-'+row.id)||row.branch!=='willyou/schedule-'+row.id)throw new Error('工作树路径或分支身份发生变化');
    const common=await this.checked(await this.git(path,['rev-parse','--path-format=absolute','--git-common-dir'])),expected=await this.checked(await this.git(row.repo,['rev-parse','--path-format=absolute','--git-common-dir']));
    if(common!==expected||await this.git(path,['branch','--show-current'])!==row.branch)throw new Error('工作树仓库身份发生变化');
    checkReferences();await this.git(row.repo,['worktree','remove',row.path]);
    this.db.prepare("UPDATE schedule_workspace_links SET status='archived',reason=NULL WHERE id=?").run(id);
  }
  async reuseBoundPlan(run:ScheduleRun,cwd:string):Promise<string>{
    const link=this.link('plan',run.planId);
    if(!link||link.status!=='ready'||link.path!==cwd)throw new Error('原绑定计划的工作树身份不可用');
    // The normal exact owner/path/Git checks also attach the same immutable
    // workspace_id to this occurrence, without resolving or creating another tree.
    return this.prepare(run);
  }
  async prepare(run:ScheduleRun):Promise<string>{
    const c=run.snapshot.config;
    if(c.workspace==='directory'){
      if(c.projectId)return registeredProjectCwd(this.db,c.projectId,c.dirId!);
      if(c.cwd)return this.checked(c.cwd);
      const dir=join(this.userData,'schedule-workspaces',run.planId);await mkdir(dir,{recursive:true,mode:0o700});return this.checked(dir);
    }
    const kind=c.workspace==='plan-worktree'?'plan':'run',owner=kind==='plan'?run.planId:run.id;
    let link=this.link(kind,owner);
    if(!link){
      const cwd=registeredProjectCwd(this.db,c.projectId!,c.dirId!),repo=await this.checked(await this.git(cwd,['rev-parse','--show-toplevel'])),commit=await this.git(cwd,['rev-parse','--verify','--end-of-options',c.baseRef!+'^{commit}']);
      const id=randomUUID(),requestedRoot=join(this.home,'.willyou','worktrees'),branch='willyou/schedule-'+id;
      await mkdir(requestedRoot,{recursive:true,mode:0o700});const root=await this.checked(requestedRoot),path=join(root,'schedule-'+id);
      this.db.prepare('INSERT INTO schedule_workspace_links(id,owner_kind,owner_id,project_id,repo,path,base_ref,base_commit,branch,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,\'preparing\',?)').run(id,kind,owner,c.projectId,repo,path,c.baseRef,commit,branch,Date.now());
      link=this.link(kind,owner)!;
      try{await this.git(repo,['worktree','add','-b',branch,path,commit]);}catch(error){this.db.prepare("UPDATE schedule_workspace_links SET status='needs_review',reason=? WHERE id=?").run(error instanceof Error?error.message:'工作树准备失败',id);throw error;}
    }
    if(link.status==='archived')throw new Error('该计划工作树已由用户清理，请重新选择工作区');
    // No retry of an ambiguous worktree creation; confirm the exact durable path/branch first.
    try{
      const path=await this.checked(link.path),common=await this.checked(await this.git(path,['rev-parse','--path-format=absolute','--git-common-dir'])),expected=await this.checked(await this.git(link.repo!,['rev-parse','--path-format=absolute','--git-common-dir']));
      if(path!==resolve(link.path)||common!==expected||await this.git(path,['branch','--show-current'])!==link.branch)throw new Error('工作树身份发生变化');
      if(link.status!=='ready'&&await this.git(path,['rev-parse','HEAD'])!==link.base_commit)throw new Error('工作树准备提交无法核对');
      this.db.prepare("UPDATE schedule_workspace_links SET status='ready',reason=NULL WHERE id=?").run(link.id);
      this.db.prepare('UPDATE schedule_occurrences SET workspace_id=? WHERE id=?').run(link.id,run.id);return path;
    }catch(error){this.db.prepare("UPDATE schedule_workspace_links SET status='needs_review',reason=? WHERE id=?").run('工作树身份无法核对',link.id);throw error;}
  }
}
