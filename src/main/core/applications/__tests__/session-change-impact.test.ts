import Database from 'better-sqlite3';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import {SessionChangeImpactService} from '../session-change-impact';
let db:Database.Database,impact:SessionChangeImpactService;
const live=new Set<string>();
beforeEach(()=>{
 db=new Database(':memory:');db.pragma('foreign_keys=ON');runBundledMigrations(db);live.clear();
 for(const [id,archived] of [['p1',null],['p2',null],['p3',1],['p4',null]] as const)db.prepare('INSERT INTO projects(id,name,archived_at,created_at,updated_at) VALUES(?,?,?,1,1)').run(id,'PRIVATE_PROJECT_NAME',archived);
 const rows=[['t1','p1','claude',null,true],['t2','p2','codex',null,true],['t3','p1','codex',null,true],['stopped','p1','claude',null,false],['archived','p1','claude',1,true],['archived-project','p3','claude',null,true],['no-project',null,'claude',null,true]] as const;
 for(const [id,project,runner,archived,running] of rows){db.prepare('INSERT INTO tasks(id,project_id,cwd,runner,title,archived_at,created_at,updated_at) VALUES(?,?,?,?,?,?,1,1)').run(id,project,'/synthetic/'+(project??'none'),runner,'PRIVATE_TASK_TITLE',archived);if(running)live.add(id);}
 db.prepare("INSERT INTO application_catalog_state(app_id,added,enabled,revision,updated_at) VALUES('zentao',1,1,1,'now')").run();
 db.prepare("INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,policy_revision,updated_at) VALUES('p2','zentao',0,1,1,'now')").run();
 for(const [id,scope,project,runner] of [['source','user',null,'codex'],['same-target','user',null,'codex'],['project','project','/synthetic/p1','codex'],['project-other','project','/synthetic/p1','claude']] as const)db.prepare("INSERT INTO capability_registry(id,kind,name,runner,source_path,source_scope,project_root,source_label,validity,issues,managed,enabled,present,discovered_at,scanned_at) VALUES(?,'skill',?,?,'/private-source',?,?,?,'valid','[]',1,1,1,1,1)").run(id,id,runner,scope,project,'private-source-label');
 impact=new SessionChangeImpactService(db,id=>live.has(id)?'pty-'+id:null,()=> 'fixed-check-time');
});
afterEach(()=>db.close());
it('counts only live unarchived tasks in plugin-available projects, including default-on projects',()=>{
 expect(impact.inspect({kind:'plugin',appId:'zentao'})).toEqual({runningCount:2,globalDisabled:false,checkedAt:'fixed-check-time'});
 db.prepare("INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,policy_revision,updated_at) VALUES('p1','zentao',0,1,1,'now')").run();expect(impact.inspect({kind:'plugin',appId:'zentao'}).runningCount).toBe(0);
});
it('scopes project toggles and gives global-off priority without a spurious restart count',()=>{
 expect(impact.inspect({kind:'plugin',appId:'zentao',projectId:'p1'}).runningCount).toBe(2);expect(impact.inspect({kind:'plugin',appId:'zentao',projectId:'p4'}).runningCount).toBe(0);
 db.prepare("UPDATE application_catalog_state SET enabled=0 WHERE app_id='zentao'").run();expect(impact.inspect({kind:'plugin',appId:'zentao',projectId:'p1'})).toMatchObject({runningCount:0,globalDisabled:true});
 expect(impact.inspect({kind:'plugin',appId:'zentao'}).runningCount).toBe(2);
});
it('limits management to the other runner and unions batches rather than double-counting tasks',()=>{
 expect(impact.inspect({kind:'capability',ids:['source'],management:true}).runningCount).toBe(2);
 expect(impact.inspect({kind:'capability',ids:['source','same-target','source'],management:true}).runningCount).toBe(2);
 expect(impact.inspect({kind:'capability',ids:['source','project-other'],management:true}).runningCount).toBe(3);
});
it('limits project capability effects to the exact source root while user and standard capabilities cover all live tasks',()=>{
 expect(impact.inspect({kind:'capability',ids:['project'],management:false}).runningCount).toBe(2);expect(impact.inspect({kind:'capability',ids:['project'],management:true}).runningCount).toBe(1);
 expect(impact.inspect({kind:'capability',ids:['source'],management:false}).runningCount).toBe(4);expect(impact.inspect({kind:'builtin',id:'smartdd-project-context'}).runningCount).toBe(4);
 live.delete('t1');expect(impact.inspect({kind:'capability',ids:['project'],management:true}).runningCount).toBe(0);
});
it('returns count-only as-of-click metadata with no writes, private names, source paths or account data',()=>{
 const before=db.prepare('SELECT total_changes() AS n').get();const reply=impact.inspect({kind:'capability',ids:['source'],management:false});expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
 expect(Object.keys(reply).sort()).toEqual(['checkedAt','globalDisabled','runningCount']);expect(JSON.stringify(reply)).not.toMatch(/PRIVATE|private-source|t1|pty-/);
});
it('validates metadata query scope instead of accepting unknown options or host resources',()=>{
 expect(()=>impact.inspect({kind:'capability',ids:['missing'],management:false})).toThrow('来源能力');expect(()=>impact.inspect({kind:'plugin',appId:'zentao',projectId:'missing'})).toThrow('项目不存在');
 expect(()=>impact.inspect({kind:'builtin',id:'unknown'})).toThrow();expect(()=>impact.inspect({kind:'builtin',id:'smartdd-project-context',command:'ignore'} as never)).toThrow();
});
