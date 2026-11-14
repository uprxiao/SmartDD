import type Database from 'better-sqlite3';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {sessionChangeQuerySchema,type SessionChangeImpact,type SessionChangeQuery} from '@shared/session-change-impact';
type Task={id:string;projectId:string|null;cwd:string;runner:string};
type Capability={sourceScope:string;projectRoot:string|null;runner:string};
const physical=(path:string)=>{try{return realpathSync(path);}catch{return resolve(path);}};
/** Actual live PTYs determine running status; old DB run rows never imply a live session.
 * No credentials, process spawning, filesystem writes or task lists leave this service. */
export class SessionChangeImpactService {
 constructor(private readonly db:Database.Database,private readonly activePty:(id:string)=>string|null,private readonly now=()=>new Date().toISOString()){}
 inspect(input:SessionChangeQuery):SessionChangeImpact {
  const q=sessionChangeQuerySchema.parse(input);
  return this.db.transaction(()=>{
   const tasks=(this.db.prepare('SELECT t.id,t.project_id AS projectId,t.cwd,t.runner FROM tasks t LEFT JOIN projects p ON p.id=t.project_id WHERE t.archived_at IS NULL AND (t.project_id IS NULL OR p.id IS NOT NULL AND p.archived_at IS NULL)').all() as Task[]).filter(t=>this.activePty(t.id)!==null);
   let affected:Task[],globalDisabled=false;
   if(q.kind==='plugin'){
    const global=this.db.prepare('SELECT added,enabled FROM application_catalog_state WHERE app_id=?').get(q.appId) as {added:number;enabled:number}|undefined;
    if(!['mail','browser','zentao'].includes(q.appId)&&!this.db.prepare('SELECT 1 FROM plugin_installations WHERE app_id=?').get(q.appId))throw new ApplicationError('NOT_FOUND','该插件不存在');
    globalDisabled=!global||global.added!==1||global.enabled!==1;
    if(q.projectId){
     if(!this.db.prepare('SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL').get(q.projectId))throw new ApplicationError('NOT_FOUND','该项目不存在');
     affected=globalDisabled?[]:tasks.filter(t=>t.projectId===q.projectId);
    }else{
     // A global toggle includes only projects where the plugin is available;
     // global-off itself must not erase the affected scope of a later enable.
     const disabled=new Set((this.db.prepare('SELECT project_id AS id FROM application_project_settings WHERE app_id=? AND enabled=0').all(q.appId) as {id:string}[]).map(p=>p.id));
     affected=tasks.filter(t=>t.projectId!==null&&!disabled.has(t.projectId));
    }
   }else if(q.kind==='builtin')affected=tasks;
   else{
    const caps=[...new Set(q.ids)].map(id=>{
     const row=this.db.prepare('SELECT source_scope AS sourceScope,project_root AS projectRoot,runner FROM capability_registry WHERE id=?').get(id) as Capability|undefined;
     if(!row||!['user','project'].includes(row.sourceScope))throw new ApplicationError('NOT_FOUND','该来源能力不存在或由宿主管理');
     return row;
    });
    affected=tasks.filter(t=>caps.some(c=>(c.sourceScope!=='project'||c.projectRoot!==null&&physical(t.cwd)===physical(c.projectRoot))&&(!q.management||(c.runner==='claude'?t.runner==='codex':c.runner==='codex'?t.runner==='claude':false))));
   }
   return{runningCount:affected.length,globalDisabled,checkedAt:this.now()};
  }).deferred();
 }
}
