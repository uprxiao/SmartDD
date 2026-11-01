import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import type {ResourceStore} from '../../resource-store';
/** Retained ZenTao source notices; package contracts and returned wording stay unchanged. */
export function zentaoConnectionNotice(store:ResourceStore,snapshot:CapabilitySessionSnapshotV2,appId:string):string|null{
 const selected=snapshot.packages.find(p=>p.appId===appId);if(!selected)return null;
 const row=store.sqlite.prepare(`SELECT s.pending_operation_id,b.connection_id,b.identity_revision,c.name,c.app_id,c.provider_id,c.identity_revision AS actual_identity_revision
  FROM application_project_settings s LEFT JOIN application_project_bindings b ON b.project_id=s.project_id AND b.app_id=s.app_id AND b.slot='zentao'
  LEFT JOIN application_connections c ON c.id=b.connection_id WHERE s.project_id=? AND s.app_id='zentao'`).get(snapshot.projectId) as {pending_operation_id:string|null;connection_id:string|null;identity_revision:number|null;name:string|null;app_id:string|null;provider_id:string|null;actual_identity_revision:number|null}|undefined;
 if(row&&row.pending_operation_id!==null)return '项目正在切换禅道连接；本次相关新调用暂不可用，不要自动重放旧请求。';
 if(selected.bindings.length>1)return '原会话禅道来源身份待核验；请检查项目选用，不要推定来源或改投旧请求。';
 const original=selected.bindings[0]??null,current=row?.connection_id??null;
 if(current&&(row?.app_id!=='zentao'||row.provider_id!=='zentao'||row.identity_revision!==row.actual_identity_revision))return '当前禅道来源身份待核验；不要将旧来源对象引用改投其他连接。';
 if((original?.connectionId??null)===current&&(!original||original.identityRevision===row?.identity_revision))return null;
 const label=(id:string|null,name:string|null)=>id?JSON.stringify((name??'原连接').slice(0,128))+' ('+id.slice(0,128)+')':'未选用';
 const old=original?store.sqlite.prepare('SELECT name FROM application_connections WHERE id=?').get(original.connectionId) as {name:string}|undefined:undefined;
 return '禅道来源已变化：本会话创建时为 '+label(original?.connectionId??null,old?.name??null)+'，本项目当前为 '+label(current,row?.name??null)+'。沿用原工具版本与动作上限；旧来源对象引用不会改投当前来源，需在当前来源重新查询。';
}
