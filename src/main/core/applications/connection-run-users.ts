import {z} from 'zod';
import {storedCapabilitySessionSnapshotSchema} from '@shared/application-session-v3';
import type {ResourceStore} from './resource-store';
import {digest} from './manifest';
const bindings=z.array(z.object({appId:z.string(),slot:z.string(),connectionId:z.uuid().nullable(),identityRevision:z.number().int().positive().nullable(),bindingRevision:z.number().int().nonnegative()}).strict());
/** Deletion depends on the live run's connection, never just task creation. */
export function connectionRunUsers(store:ResourceStore,appId:string,connectionId:string){
 const rows=store.sqlite.prepare("SELECT r.run_id,r.task_id,COALESCE(t.title,r.task_id) task_name,r.binding_mode,r.bindings_json,r.snapshot_hash,COALESCE(v.snapshot_json,s.snapshot_json) snapshot_json FROM capability_runs r LEFT JOIN tasks t ON t.id=r.task_id LEFT JOIN capability_snapshot_versions v ON v.task_id=r.task_id AND v.snapshot_hash=r.snapshot_hash LEFT JOIN capability_session_snapshots s ON s.task_id=r.task_id AND s.snapshot_hash=r.snapshot_hash WHERE r.state NOT IN ('stopped','failed') ORDER BY r.run_id").all() as {run_id:string;task_id:string;task_name:string;binding_mode:string;bindings_json:string;snapshot_hash:string;snapshot_json:string|null}[];
 return rows.filter(r=>{try{if(r.binding_mode==='run'&&(appId==='mail'||appId==='browser'))return bindings.parse(JSON.parse(r.bindings_json)).some(b=>b.appId===appId&&b.connectionId===connectionId);if(!r.snapshot_json||digest(r.snapshot_json)!==r.snapshot_hash)return true;const snapshot=storedCapabilitySessionSnapshotSchema.parse(JSON.parse(r.snapshot_json));return snapshot.packages.some(p=>p.appId===appId&&p.bindings.some(b=>b.connectionId===connectionId))||snapshot.schema===3&&snapshot.externalPlugins?.some(p=>p.appId===appId&&p.connections.some(c=>c.connectionId===connectionId));}catch{return true;}}).map(r=>({runId:r.run_id,taskId:r.task_id,name:r.task_name}));
}
