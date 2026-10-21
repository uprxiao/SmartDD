import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { SessionLaunchRestriction } from '@shared/application-session-diagnostics';
import type { ResourceStore } from './resource-store';
import { canonicalJson, digest } from './manifest';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const launchRestrictionSchema=z.object({schema:z.literal(1),runId:z.uuid(),taskId:z.string().min(1).max(128),snapshotHash:hash,selectionHash:hash,reason:z.enum(['managed_launch_payload_too_large','fixed_application_resources_unavailable']),issueCode:z.enum(['AGENT_ADAPTER_UNSUPPORTED','CAPABILITY_UNAVAILABLE']),restrictedAt:z.iso.datetime()}).strict().refine(v=>v.reason==='managed_launch_payload_too_large'?v.issueCode==='AGENT_ADAPTER_UNSUPPORTED':v.issueCode==='CAPABILITY_UNAVAILABLE');
/** Read-only evidence. This receipt never grants native or application authority. */
export function readLaunchRestriction(store:ResourceStore,runId:string,taskId:string,selectionHash:string):SessionLaunchRestriction|null{
 const row=store.sqlite.prepare('SELECT evidence_json,evidence_hash,restricted_at FROM capability_run_restrictions WHERE run_id=?').get(runId) as {evidence_json:string;evidence_hash:string;restricted_at:string}|undefined;
 if(!row)return null;
 try{const value=launchRestrictionSchema.parse(JSON.parse(row.evidence_json));if(digest(canonicalJson(value))!==row.evidence_hash||value.runId!==runId||value.taskId!==taskId||value.selectionHash!==selectionHash||value.restrictedAt!==row.restricted_at)throw new Error();return value;}
 catch{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原生启动限制回执损坏，保留原记录且不推断应用就绪');}
}
