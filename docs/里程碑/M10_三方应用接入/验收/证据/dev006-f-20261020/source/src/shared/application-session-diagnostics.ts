import type {ApplicationId,ApplicationProvider} from './application-connections';
export interface SessionPreparationEvidence {
 schema:1;runId:string;selectionHash:string;cliVersion:string|null;adapterHash:string;
 state:'prepared'|'unavailable';issueCode:string|null;manifestPath:string;configPaths:string[];preparedAt:string;
}
export interface SessionBridgeEvidence {schema:1;runId:string;bridgeId:string;pid:number;startedAt:string;observedAt:string;source:'kernel-peer';}
export interface SessionRunDiagnostic {
 id:string;state:string;startedAt:string;endedAt:string|null;current:boolean;
 preparation:SessionPreparationEvidence|null;preparationIssue:string|null;
 bridge:{connected:boolean;observedAt:string|null;issueCode:string|null};
}
export interface SessionConnectionDiagnostic {
 slot:ApplicationProvider;id:string|null;name:string|null;originalId:string|null;originalName:string|null;health:string;testedAt:string|null;
 selection:'same'|'changed'|'missing'|'unverified';compatibility:'compatible'|'incompatible'|'unverified';issueCode:string|null;
}
export interface SessionApplicationDiagnostic {
 appId:ApplicationId;name:string;fixedVersion:string|null;defaultVersion:string|null;packageHash:string|null;
 policy:'enabled'|'disabled'|'unverified';resourceState:'verified'|'unavailable'|'unverified';issueCode:string|null;
 skills:{id:string;name:string;sourceHash:string;projectionPath:string}[];permissions:string[];connections:SessionConnectionDiagnostic[];
 evidence:{skillDiscovery:'unverified';skillRead:'unverified';toolRequests:number;successfulToolRequests:number;latestToolAt:string|null;latestErrorCode:string|null;latestEffectState:string|null};
}
export interface ApplicationSessionDiagnostic {
 taskId:string;projectId:string|null;title:string;runner:string;selection:'fixed'|'unknown-history'|'corrupt'|'not-recorded';
 snapshotHash:string|null;agentState:'running'|'stopped'|'unverified';canNewSession:boolean;createdCliVersion:string|null;currentRun:SessionRunDiagnostic|null;recentRuns:SessionRunDiagnostic[];
 applications:SessionApplicationDiagnostic[];issues:string[];checkedAt:string;
}
