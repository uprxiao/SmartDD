import {ApplicationError} from '@shared/applications';
import {applicationImpactQuerySchema,type ApplicationImpact,type ApplicationImpactQuery} from '@shared/application-impact';
import type {ApplicationId,ApplicationProvider} from '@shared/application-connections';
import type {ResourceStore} from './resource-store';
import {taskUsesApplication} from './application-run-policy';
type Connection={id:string;name:string;providerId:ApplicationProvider;enabled:number;authorization:'connected'|'disconnected'};
const changed=()=>new ApplicationError('REVISION_CONFLICT','配置已变化，请关闭并重新打开此操作');
/** Pure SQL metadata view. Revocation impact remains inspectable even if package
 * bytes, credentials or a historical snapshot are unavailable. No policy writes. */
export class ApplicationImpactService {
 constructor(private readonly store:ResourceStore){}
 inspect(input:ApplicationImpactQuery):ApplicationImpact{
  const q=applicationImpactQuerySchema.parse(input);
  return this.store.sqlite.transaction(()=>this.read(q)).deferred();
 }
 private read(q:ApplicationImpactQuery):ApplicationImpact{
  const db=this.store.sqlite;let appId:ApplicationId,projectIds:string[];
  const columns='id,name,provider_id AS providerId,enabled,auth_state AS authorization';let connections:Connection[];
  if(q.kind==='disconnect'){
   const row=db.prepare('SELECT app_id AS appId,revision,'+columns+' FROM application_connections WHERE id=?').get(q.connectionId) as (Connection&{appId:ApplicationId;revision:number})|undefined;
   if(!row)throw new ApplicationError('NOT_FOUND','该连接不存在');if(row.revision!==q.expectedRevision)throw changed();appId=row.appId;
   connections=[row];projectIds=(db.prepare('SELECT DISTINCT project_id AS id FROM application_project_bindings WHERE app_id=? AND connection_id=? ORDER BY project_id').all(appId,q.connectionId) as {id:string}[]).map(p=>p.id);
  }else if(q.kind==='remove'){
   appId=q.appId;const row=db.prepare('SELECT revision FROM application_catalog_state WHERE app_id=?').get(appId) as {revision:number}|undefined;if((row?.revision??0)!==q.expectedRevision)throw changed();
   connections=db.prepare('SELECT '+columns+' FROM application_connections WHERE app_id=? ORDER BY name,id').all(appId) as Connection[];
   projectIds=(db.prepare('SELECT project_id AS id FROM application_project_settings WHERE app_id=? ORDER BY project_id').all(appId) as {id:string}[]).map(p=>p.id);
  }else{
   appId='zentao';const project=db.prepare('SELECT 1 FROM projects WHERE id=?').get(q.projectId);if(!project)throw new ApplicationError('NOT_FOUND','该项目不存在');
   const setting=db.prepare("SELECT binding_revision AS revision,pending_operation_id AS pending FROM application_project_settings WHERE project_id=? AND app_id='zentao'").get(q.projectId) as {revision:number;pending:string|null}|undefined;
   if((setting?.revision??0)!==q.expectedRevision)throw changed();if(setting&&setting.pending!==null)throw new ApplicationError('RESOURCE_BUSY','此项目正在切换禅道连接，请稍后核对');
   connections=db.prepare('SELECT '+columns+' FROM application_connections WHERE id IN (SELECT connection_id FROM application_project_bindings WHERE project_id=? AND app_id=?) ORDER BY name,id').all(q.projectId,appId) as Connection[];projectIds=[q.projectId];
  }
  const projects=projectIds.map(id=>{
   const p=db.prepare('SELECT p.name,p.archived_at AS archived,s.enabled FROM projects p LEFT JOIN application_project_settings s ON s.project_id=p.id AND s.app_id=? WHERE p.id=?').get(appId,id) as {name:string;archived:number|null;enabled:number|null}|undefined;
   if(!p)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','受影响项目的引用待核查，请重新载入');
   const bindings=db.prepare('SELECT connection_id AS id,slot FROM application_project_bindings WHERE project_id=? AND app_id=?'+(q.kind==='disconnect'?' AND connection_id=?':'')+' ORDER BY slot').all(id,appId,...(q.kind==='disconnect'?[q.connectionId]:[])) as {id:string;slot:ApplicationProvider}[];
   return{id,name:p.name,enabled:p.enabled===1,archived:p.archived!==null,connections:bindings};
  });
  const runs:ApplicationImpact['runs']=[];
  if(q.kind==='switch'){
   const rows=db.prepare("SELECT r.run_id AS id,r.task_id AS taskId,r.state,r.project_id AS runProject,t.title,t.project_id AS taskProject FROM capability_runs r LEFT JOIN tasks t ON t.id=r.task_id WHERE (r.project_id=? OR t.project_id=?) AND r.state NOT IN ('stopped','failed') ORDER BY r.started_at,r.run_id").all(q.projectId,q.projectId) as {id:string;taskId:string;state:string;runProject:string;title:string|null;taskProject:string|null}[];
   for(const row of rows){if(row.runProject!==q.projectId||row.taskProject!==null&&row.taskProject!==q.projectId)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','受影响会话的项目归属待核查');if(taskUsesApplication(this.store,q.projectId,row.taskId,'zentao'))runs.push({id:row.id,taskId:row.taskId,title:row.title??'会话 '+row.taskId,state:row.state});}
  }
  return{kind:q.kind,appId,checkedAt:new Date().toISOString(),connections:connections.map(c=>({id:c.id,name:c.name,providerId:c.providerId,enabled:c.enabled===1,authorization:c.authorization})),projects,runs};
 }
}
