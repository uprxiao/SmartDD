import type Database from 'better-sqlite3';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {browserDigest} from './artifacts';
import type {BrowserOperations} from './operations';
import type {BrowserPage} from './page-registry';
import type {BrowserScope} from './service';

export const checkpointInput=z.strictObject({checkpointId:z.string().uuid()});
export const browserActionCheckpoint=z.strictObject({
  id:z.string().uuid(),
  after:z.string().uuid().optional(),
  selector:z.string().trim().min(1).max(512),
  text:z.string().min(1).max(512).optional(),
});
type CheckpointSpec=z.output<typeof browserActionCheckpoint>;
export type BrowserCheckpoint=CheckpointSpec&{
  originalRun:string;requestId:string;operationId:string;command:string;bindingId:string;
  projectId:string;profileId:string;pageId:string;origin:string;
  verified?:{at:string;generation:string;urlSha256:string};
};

export class BrowserCheckpoints {
  constructor(private readonly database:Database.Database,private readonly operations:BrowserOperations){}
  private key(taskId:string,id:string){return `browserCheckpoint.v1:${taskId}:${id}`;}
  private binding(scope:BrowserScope){
    const run=this.database.prepare("SELECT binding_id FROM capability_runs WHERE run_id=? AND task_id=? AND project_id=? AND state='active'")
      .get(scope.runId,scope.taskId,scope.projectId) as {binding_id:string|null}|undefined;
    if(!run?.binding_id)throw new ApplicationError('SCOPE_DENIED','检查点需要当前任务的已登记运行');
    return run.binding_id;
  }
  private read(taskId:string,id:string):BrowserCheckpoint|undefined{
    const row=this.database.prepare('SELECT value FROM app_settings WHERE key=?').get(this.key(taskId,id)) as {value:string}|undefined;
    return row?JSON.parse(row.value):undefined;
  }
  private save(scope:{taskId:string},record:BrowserCheckpoint){
    this.database.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
      .run(this.key(scope.taskId,record.id),JSON.stringify(record),Date.now());
  }
  get(scope:BrowserScope,id:string){
    const record=this.forTask(scope.taskId,scope.projectId,id);
    if(record.bindingId!==this.binding(scope))
      throw new ApplicationError('SCOPE_DENIED','检查点不属于当前任务和执行器绑定');
    return record;
  }
  forTask(taskId:string,projectId:string,id:string){
    const record=this.read(taskId,id);
    if(!record||record.projectId!==projectId)
      throw new ApplicationError('SCOPE_DENIED','检查点不属于当前任务');
    return record;
  }
  result(record:BrowserCheckpoint){
    const action=this.operations.receipt(record.originalRun,record.requestId);
    return{
      checkpointId:record.id,pageId:record.pageId,operationId:record.operationId,
      action:{state:action.state,effectState:'effectState' in action?action.effectState:'unknown'},
      business:record.verified?'verified':'needs-review',
      ...(record.verified?{evidence:record.verified}:{}),
    };
  }
  assertUnrecorded(scope:BrowserScope,id:string){
    if(!this.read(scope.taskId,id))return;
    this.get(scope,id);
    throw new ApplicationError('REQUEST_CONFLICT','该业务步骤已经有原执行记录，请先查看或核对');
  }
  dispatch(scope:BrowserScope,page:BrowserPage,spec:CheckpointSpec,command:string){
    return this.database.transaction(()=>{
      this.assertUnrecorded(scope,spec.id);
      if(spec.after){
        const previous=this.get(scope,spec.after);
        if(!previous.verified||previous.pageId!==page.id||previous.profileId!==page.profileId)
          throw new ApplicationError('RESOURCE_BUSY','前置业务步骤尚待核对');
      }
      const origin=URL.parse(page.contents.getURL())?.origin;
      if(page.taskId!==scope.taskId||!origin||!/^https?:\/\//.test(origin))
        throw new ApplicationError('SCOPE_DENIED','业务检查点需要当前任务获准的网页');
      this.save(scope,{...spec,originalRun:scope.runId,requestId:scope.requestId,operationId:scope.operationId,
        command,bindingId:this.binding(scope),projectId:page.projectId,profileId:page.profileId,pageId:page.id,origin});
    })();
  }
  verify(record:BrowserCheckpoint,page:BrowserPage){
    const current=this.forTask(page.taskId,record.projectId,record.id);
    if(current.pageId!==page.id||current.profileId!==page.profileId||URL.parse(page.contents.getURL())?.origin!==current.origin)
      throw new ApplicationError('INTENT_STALE','待核对的原标签、身份或站点已变化');
    // Retain a verifiable URL fingerprint without persisting newly observed
    // query tokens or authentication state from a site.
    current.verified={at:new Date().toISOString(),generation:page.references.documentGeneration,urlSha256:browserDigest(page.contents.getURL())};
    this.save(page,current);
    return this.result(current);
  }
}
