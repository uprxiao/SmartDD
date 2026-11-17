import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { AgentStore } from '../agent/agent-store';
import { FileSourceResolver } from './sources';
const clean:(()=>void)[]=[];afterEach(()=>clean.splice(0).forEach(f=>f()));
function fixture(strategy='git'){
 const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','project',1,1); INSERT INTO project_dirs(id,project_id,label,path,created_at,updated_at) VALUES('d','p','main','/main',1,1),('other','p','other','/other',1,1)");
 const store=new AgentStore(sqlite),selection={driverId:'codex-app-server' as const,profileId:'fixture',tier:'ask'},parent=store.createTask({projectId:'p',dirId:'d',cwd:'/main/sub',title:'parent',selection}),child=store.createTask({projectId:'p',dirId:null,cwd:'/main/sub',title:'child',parentTaskId:parent,selection});
 sqlite.prepare("INSERT INTO agent_delegations(delegation_id,parent_task_id,child_task_id,target_json,access,request_key,delivery_state,created_at,updated_at) VALUES('delegate',?,?,?,'write','fixture','queued','now','now')").run(parent,child,JSON.stringify({strategy}));
 const resolver=new FileSourceResolver(drizzle(sqlite,{schema}));clean.push(()=>sqlite.close());return{sqlite,child,parent,resolver};
}
it('A19/A66: a Git child never falls back to the main project; ready worktrees expose their full root and branch only',()=>{
 const f=fixture();expect(()=>f.resolver.sources({kind:'task',taskId:f.child})).toThrow('尚未就绪');
 f.sqlite.prepare("INSERT INTO agent_workspaces(workspace_id,task_id,child_task_id,kind,repo_root,path,branch,base_commit,state,created_at,updated_at) VALUES('workspace',?,?,'git_worktree','/main','/private-worktree','main_willyou_child',?,'ready','now','now')").run(f.parent,f.child,'a'.repeat(40));
 expect(f.resolver.sources({kind:'task',taskId:f.child})).toEqual([{kind:'task-cwd',id:f.child,path:'/private-worktree',label:'工作副本 · main_willyou_child',projectId:'p'}]);
 expect(f.resolver.sources({kind:'task',taskId:f.parent}).map(r=>r.path)).toEqual(['/main/sub','/main','/other']);
});
it('A31: a shared-directory child keeps a separate task source and cannot import other parent project roots',()=>{
 const f=fixture('serial');expect(f.resolver.sources({kind:'task',taskId:f.child}).map(r=>r.path)).toEqual(['/main/sub']);
});
