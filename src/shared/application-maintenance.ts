import type {ApplicationId} from './application-connections';
export interface ApplicationVersionReference {taskId:string;title:string|null;projectId:string;runner:string;deleted:boolean;retention:string;}
export interface ApplicationVersionUsage {
 appId:ApplicationId;version:string;packageHash:string;resourceId:string;state:string;defaultForNewSessions:boolean;
 sessionRefCount:number;tombstoneRefCount:number;activeRunCount:number;references:ApplicationVersionReference[];
 sourceBytes:number|null;projectionBytes:number|null;reclaimableBytes:number|null;
 integrity:'valid'|'invalid'|'missing'|'removed'|'unknown';compatibility:'compatible'|'incompatible'|'unknown';
 retentionReasons:string[];issues:string[];canCleanup:boolean;planHash:string;
 cleanupRecovery?:{operationId:string;planHash:string;state:string;canCancel:boolean;issueCode:string|null};
 /** Read-only graph proposal. canCleanup remains the actual supported action. */
 publication?:ApplicationPublicationRecord;
 cleanupGraph?:{planHash:string;deleteOrder:string[];retained:{resourceId:string;reasons:string[]}[];issues:string[];requiresSharedCoordinator:boolean};
}
export interface ApplicationVersions {upgrade?:ApplicationUpgradeReport;appId:ApplicationId;items:ApplicationVersionUsage[];checkedAt:string;recoveryPending:number;}
export interface ApplicationVersionCleanup {appId:ApplicationId;packageHash:string;planHash:string;waitToken?:string;}
export interface ApplicationVersionCleanupResult {packageHash:string;operationId:string;state:'removed';removedFileBytes:number;}
export interface ApplicationCleanupCancel {appId:ApplicationId;packageHash:string;operationId:string;planHash:string;}
export interface ApplicationCleanupCanceled {packageHash:string;operationId:string;cancelOperationId:string;state:'canceled';}

export interface ApplicationUpgradeIssue {code:string;causeCode?:string;packageHash?:string;taskId?:string;connectionId?:string}
export interface ApplicationUpgradeImpact extends ApplicationUpgradeIssue {
 appId:string|null;appName:string|null;version:string|null;
 taskTitle:string|null;connectionName:string|null;
 operations:string[]|null;scope:'connection'|'package'|'unknown';verified:boolean;target?:boolean;
}
export interface ApplicationUpgradeReport {
 state:'checked'|'unavailable';
 targets:{appId:string;version:string;packageHash:string}[];
 preflight:null|{requiredBytes:number;availableBytes:string;issues:ApplicationUpgradeIssue[]};
 /** Read-only presentation; never used as activation or authorization input. */
 impacts?:ApplicationUpgradeImpact[];
}

/** Display only. The original request/result and owner-scoped cancellation authorize work. */
export type ApplicationCleanupPhase='checking'|'waiting'|'executing';
export interface ApplicationCleanupProgress {waitToken:string;phase:'waiting'|'executing';}
export function applicationCleanupProgressText(phase:ApplicationCleanupPhase):string{
 return phase==='executing'?'正在核对并清理版本文件；已进入清理处理，不能取消等待。完成前不报告释放空间。':phase==='waiting'?'正在等待版本资源空闲；尚未开始清理，可以取消等待。无关 Agent 可继续工作。':'正在核对清理请求；尚未收到处理阶段。';
}

/** Durable publication stage only: neither Agent loading nor current connection health. */
export function applicationVersionStage(state:string):{title:string;note:string}{
 switch(state){
  case 'staged':return{title:'准备未完成',note:'版本尚未完成准备，不可作为新会话的可用版本。'};
  case 'verified':return{title:'已校验，发布未完成',note:'校验记录不代表最终目录已发布；完成发布前不会成为新会话默认版本。'};
  case 'recovery-required':return{title:'恢复待核查',note:'原发布或恢复尚未完成；保留原记录和资源，不自动换用其他版本。'};
  case 'ready':return{title:'已发布',note:'发布阶段不表示 Agent 已发现、读取或连接已可用。'};
  case 'deleting':return{title:'清理未完成',note:'清理尚未完成，具体处理或恢复结果按原记录核对。'};
  case 'removed':return{title:'文件已清理',note:'版本身份和原有业务数据保留。'};
  default:return{title:'阶段待核查',note:'当前资源阶段无法确认；保留原记录，不视为可用版本。'};
 }
}

export interface ApplicationPublicationRecord {state:'preparing'|'verified'|'published'|'failed'|'committed'|'unknown';errorCode:string|null;updatedAt:string|null;}
/** Display only; never print the operation plan, path or raw error payload. */
export function applicationPublicationRecordText(record:ApplicationPublicationRecord):string{
 const labels={preparing:'准备阶段已登记',verified:'校验记录已保存',published:'最终目录已发布，提交未完成',failed:'原操作失败',committed:'原发布已完成',unknown:'原记录待核查'};
 const state=Object.hasOwn(labels,record.state)?labels[record.state]:'原记录待核查';
 if(record.state!=='failed')return '发布记录：'+state;
 const reasons:Record<string,string>={INSTALL_FAILED:'发布未完成，请核对原可信包后恢复。',HASH_MISMATCH:'原内容校验不符，保留现场并核对可信包。',OWNERSHIP_CONFLICT:'原路径或目录归属不符，保留双方内容。',RESOURCE_BUSY:'原发布或资源仍有占用，保留现场等待核查。',CANCELED:'原准备已取消，未切换默认版本。'};
 return '发布记录：'+state+'；'+(record.errorCode&&Object.hasOwn(reasons,record.errorCode)?reasons[record.errorCode]:'失败原因待核验，保留原记录。');
}

/** Shared version-file display; no resource or authorization access. */
export const applicationVersionBytes=(n:number|null)=>n===null?'尚未测量':n<1024?n+' 字节':n<1024*1024?(n/1024).toFixed(1)+' KB':(n/1024/1024).toFixed(1)+' MB';
