import type Database from 'better-sqlite3';
/** An explicit task-scoped application identity. The existing capability bridge
 * uses a nonempty scope-key column named project_id; no synthetic project is
 * created, and no project-scoped selection or credential is inherited. */
const prefix='standalone-task-';
export function standaloneKey(taskId:string){return prefix+taskId;}
export function standaloneTaskId(key:string):string|null{return /^standalone-task-[a-f0-9-]{36}$/.test(key)?key.slice(prefix.length):null;}
export function verifyStandaloneScope(db:Database.Database,key:string,expectedTaskId?:string):string|null{
  const id=standaloneTaskId(key);if(!id||expectedTaskId&&expectedTaskId!==id)return null;
  return db.prepare('SELECT 1 FROM tasks t JOIN agent_tasks a ON a.task_id=t.id WHERE t.id=? AND t.project_id IS NULL AND t.dir_id IS NULL AND a.archived_at IS NULL').get(id)?id:null;
}
export function taskApplicationScope(db:Database.Database,taskId:string):string|null{
  const row=db.prepare('SELECT t.project_id,t.dir_id,a.archived_at FROM tasks t LEFT JOIN agent_tasks a ON a.task_id=t.id WHERE t.id=?').get(taskId) as {project_id:string|null;dir_id:string|null;archived_at:string|null}|undefined;
  if(!row||row.archived_at)return null;
  if(row.project_id)return row.project_id;
  const key=standaloneKey(taskId);return verifyStandaloneScope(db,key,taskId)?key:null;
}
