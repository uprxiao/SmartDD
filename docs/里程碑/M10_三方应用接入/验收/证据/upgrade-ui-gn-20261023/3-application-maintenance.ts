import type {ApplicationId} from './application-connections';
export interface ApplicationVersionReference {taskId:string;title:string|null;projectId:string;runner:string;deleted:boolean;retention:string;}
export interface ApplicationVersionUsage {
 appId:ApplicationId;version:string;packageHash:string;resourceId:string;state:string;defaultForNewSessions:boolean;
 sessionRefCount:number;tombstoneRefCount:number;activeRunCount:number;references:ApplicationVersionReference[];
 sourceBytes:number|null;projectionBytes:number|null;reclaimableBytes:number|null;
 integrity:'valid'|'invalid'|'missing'|'removed'|'unknown';compatibility:'compatible'|'incompatible'|'unknown';
 retentionReasons:string[];issues:string[];canCleanup:boolean;planHash:string;
}
export interface ApplicationVersions {upgrade?:ApplicationUpgradeReport;appId:ApplicationId;items:ApplicationVersionUsage[];checkedAt:string;recoveryPending:number;}
export interface ApplicationVersionCleanup {appId:ApplicationId;packageHash:string;planHash:string;}
export interface ApplicationVersionCleanupResult {packageHash:string;operationId:string;state:'removed';removedFileBytes:number;}

export interface ApplicationUpgradeReport {
 state:'checked'|'unavailable';
 targets:{appId:string;version:string;packageHash:string}[];
 preflight:null|{requiredBytes:number;availableBytes:string;issues:{code:string;packageHash?:string;taskId?:string;connectionId?:string}[]};
}
