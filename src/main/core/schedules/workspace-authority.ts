import type Database from 'better-sqlite3';
import {execFileSync} from 'node:child_process';
import {realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {DriverError} from '../agent/driver';

type Owned={id:string;owner_kind:string;owner_id:string;project_id:string;path:string;repo:string;branch:string;status:string;run_id:string;plan_id:string;dir_id:string|null;cwd:string;task_project:string|null;task_dir:string|null};
/** A scheduled worktree is not a new project root. Only its exact existing
 * task, durable occurrence/link and real physical Git identity grant its root.
 * Ordinary task creation cannot turn an arbitrary path into this authority. */
export function scheduledWorkspaceForTask(db:Database.Database,taskId:string,home:string):{path:string;branch:string}|undefined{
  const row=db.prepare(`SELECT w.id,w.owner_kind,w.owner_id,w.project_id,w.path,w.repo,w.branch,w.status,
     r.id AS run_id,r.plan_id,json_extract(r.snapshot,'$.config.dirId') AS dir_id,
     t.cwd,t.project_id AS task_project,t.dir_id AS task_dir
    FROM schedule_occurrences r JOIN schedule_workspace_links w ON w.id=r.workspace_id JOIN tasks t ON t.id=r.task_id
    WHERE r.task_id=? AND (w.owner_kind='plan' AND w.owner_id=r.plan_id OR w.owner_kind='run' AND w.owner_id=r.id)
    ORDER BY r.claimed_at DESC,r.rowid DESC LIMIT 1`).get(taskId) as Owned|undefined;
  if(!row)return undefined;
  const invalid=()=>new DriverError('REJECTED','定时任务工作树的登记身份已变化，需要修正');
  try{
    if(row.status!=='ready'||!row.project_id||row.project_id!==row.task_project||row.dir_id!==row.task_dir||row.branch!=='willyou/schedule-'+row.id)throw invalid();
    const root=realpathSync(join(home,'.willyou','worktrees'));
    if(row.path!==join(root,'schedule-'+row.id)||row.path!==realpathSync(row.path)||row.cwd!==row.path||!statSync(row.path).isDirectory())throw invalid();
    const registered=db.prepare('SELECT d.path FROM project_dirs d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.id=? AND p.archived_at IS NULL').get(row.dir_id,row.project_id) as {path:string}|undefined;
    if(!registered)throw invalid();
    const env={...process.env};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR'])delete env[key];
    const git=(cwd:string,args:string[])=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:2000}).trim();
    const repo=realpathSync(git(registered.path,['rev-parse','--show-toplevel']));
    if(repo!==row.repo||repo!==realpathSync(row.repo))throw invalid();
    const actualCommon=realpathSync(git(row.path,['rev-parse','--path-format=absolute','--git-common-dir']));
    const expectedCommon=realpathSync(git(repo,['rev-parse','--path-format=absolute','--git-common-dir']));
    if(actualCommon!==expectedCommon||git(row.path,['branch','--show-current'])!==row.branch)throw invalid();
    return {path:row.path,branch:row.branch};
  }catch{throw invalid();}
}
