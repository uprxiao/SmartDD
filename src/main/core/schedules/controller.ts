import type {IpcMainInvokeEvent} from 'electron';
import {z} from 'zod';
import {createScopedRPCController} from '@shared/ipc/rpc';
import {scheduleSchema,scheduleSaveSchema,type Schedule,type ScheduleSave} from '@shared/schedule';
import type {ScheduleService} from './service';
const id=z.string().uuid(),rev=z.number().int().positive();
export function createScheduleController(service:ScheduleService|undefined,trusted:(e:IpcMainInvokeEvent)=>boolean){
  const host=(e:IpcMainInvokeEvent)=>{if(!trusted(e)||!service)throw new Error('定时任务只允许可信主界面操作');return service;};
  return createScopedRPCController({
    list:(e,includeArchived=false)=>host(e).list(z.boolean().parse(includeArchived)),
    notices:e=>host(e).listNotices(),
    setNotifyEnabled:(e,value:boolean)=>host(e).setNotifyEnabled(z.boolean().parse(value)),
    get:(e,planId:string)=>{const s=host(e),p=s.store.plan(id.parse(planId));if(!p)throw new Error('计划不存在');return{plan:p,history:s.history(planId),workspaces:s.workspaces.listForPlan(planId)};},
    preview:(e,input:{schedule:Schedule;planId?:string;revision?:number})=>{const s=host(e),v=z.strictObject({schedule:scheduleSchema,planId:id.optional(),revision:rev.optional()}).parse(input);return s.store.preview(v.schedule,Date.now(),v.planId,v.revision);},
    save:(e,input:ScheduleSave,confirmedTier=false)=>host(e).save(scheduleSaveSchema.parse(input),z.boolean().parse(confirmedTier)),
    setEnabled:(e,planId:string,revision:number,enabled:boolean)=>host(e).setEnabled(id.parse(planId),rev.parse(revision),z.boolean().parse(enabled)),
    archive:(e,planId:string,revision:number)=>host(e).archive(id.parse(planId),rev.parse(revision)),
    runNow:(e,planId:string,revision:number,requestId:string)=>host(e).runNow(id.parse(planId),rev.parse(revision),id.parse(requestId)),
    cleanupWorkspace:(e,planId:string,revision:number,workspaceId:string)=>host(e).cleanupWorkspace(id.parse(planId),rev.parse(revision),id.parse(workspaceId)),
    bindingPreview:(e,planId:string,revision:number)=>host(e).bindingPreview(id.parse(planId),rev.parse(revision)),
    reconfirm:(e,planId:string,revision:number,token:string)=>host(e).reconfirm(id.parse(planId),rev.parse(revision),z.string().regex(/^[a-f0-9]{64}$/).parse(token)),
    run:(e,runId:string)=>host(e).detail(id.parse(runId)),
    stop:(e,runId:string)=>host(e).stopRun(id.parse(runId)),
    reconcile:(e,runId:string)=>{const s=host(e);s.reconcile();return s.detail(id.parse(runId));},
  });
}
