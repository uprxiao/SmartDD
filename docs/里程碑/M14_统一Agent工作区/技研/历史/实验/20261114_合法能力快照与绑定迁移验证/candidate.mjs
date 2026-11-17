// Research-only binding envelope; not a production migration or session registry.
import {z} from 'zod';
import actual from './actual.cjs';
const {storedCapabilitySessionSnapshotSchema:snapshotSchema,canonicalJson,digest}=actual;
export const envelopeSchema=z.object({format:z.literal('m14-capability-envelope-probe-v1'),taskId:z.string().min(1),bindingId:z.string().uuid(),capabilitySessionId:z.string().uuid(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),snapshot:snapshotSchema}).strict().superRefine((v,c)=>{
  if(v.taskId!==v.snapshot.taskId||v.contentHash!==digest(canonicalJson(v.snapshot)))c.addIssue({code:'custom',message:'content identity mismatch'});
});
export function envelope(snapshot,bindingId,capabilitySessionId){return envelopeSchema.parse({format:'m14-capability-envelope-probe-v1',taskId:snapshot.taskId,bindingId,capabilitySessionId,contentHash:digest(canonicalJson(snapshot)),snapshot});}
export function install(db){db.exec(`
CREATE TABLE probe_binding(task_id TEXT NOT NULL,binding_id TEXT PRIMARY KEY, UNIQUE(task_id,binding_id));
CREATE TABLE probe_cap(cap_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,binding_id TEXT NOT NULL,UNIQUE(cap_id,task_id,binding_id),FOREIGN KEY(task_id,binding_id) REFERENCES probe_binding(task_id,binding_id));
CREATE TABLE probe_revision(cap_id TEXT NOT NULL,task_id TEXT NOT NULL,binding_id TEXT NOT NULL,content_hash TEXT NOT NULL,envelope_json TEXT NOT NULL,PRIMARY KEY(cap_id,content_hash),FOREIGN KEY(cap_id,task_id,binding_id) REFERENCES probe_cap(cap_id,task_id,binding_id));
CREATE TABLE probe_ref(cap_id TEXT NOT NULL,content_hash TEXT NOT NULL,ref_id TEXT NOT NULL,ref_kind TEXT NOT NULL,ref_hash TEXT NOT NULL,relative_path TEXT NOT NULL,PRIMARY KEY(cap_id,content_hash,ref_id),FOREIGN KEY(cap_id,content_hash) REFERENCES probe_revision(cap_id,content_hash),FOREIGN KEY(ref_id) REFERENCES capability_resources(resource_id));
`);}
export function put(store,input,refs){
  const e=envelopeSchema.parse(input),db=store.sqlite;
  for(const ref of refs){const r=store.get(ref.ref_id);if(r.kind!==ref.ref_kind||r.contentHash!==ref.ref_hash||r.relativePath!==ref.relative_path)throw Error('reference identity mismatch');}
  db.transaction(()=>{
    db.prepare('INSERT OR IGNORE INTO probe_binding VALUES(?,?)').run(e.taskId,e.bindingId);
    db.prepare('INSERT OR IGNORE INTO probe_cap VALUES(?,?,?)').run(e.capabilitySessionId,e.taskId,e.bindingId);
    const bytes=canonicalJson(e),known=db.prepare('SELECT envelope_json FROM probe_revision WHERE cap_id=? AND content_hash=?').get(e.capabilitySessionId,e.contentHash);
    if(known&&known.envelope_json!==bytes)throw Error('revision conflict');
    db.prepare('INSERT OR IGNORE INTO probe_revision VALUES(?,?,?,?,?)').run(e.capabilitySessionId,e.taskId,e.bindingId,e.contentHash,bytes);
    for(const r of refs)db.prepare('INSERT OR IGNORE INTO probe_ref VALUES(?,?,?,?,?,?)').run(e.capabilitySessionId,e.contentHash,r.ref_id,r.ref_kind,r.ref_hash,r.relative_path);
  }).immediate();
  return e;
}
export function authorize(store,scope){
  const row=store.sqlite.prepare('SELECT envelope_json FROM probe_revision WHERE cap_id=? AND content_hash=? AND task_id=? AND binding_id=?').get(scope.capabilitySessionId,scope.contentHash,scope.taskId,scope.bindingId);
  if(!row)throw Error('scope mismatch');
  const e=envelopeSchema.parse(JSON.parse(row.envelope_json));
  if(['capabilitySessionId','bindingId','taskId','contentHash'].some(k=>e[k]!==scope[k]))throw Error('stored scope mismatch');
  return e;
}
