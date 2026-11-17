import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import type { AgentStore } from './agent-store';
import { DriverError } from './driver';
export type QueueRow = { queue_id: string; directory_identity: string; task_id: string; run_id: string | null; kind: 'read' | 'write'; state: 'queued' | 'active' | 'released' | 'canceled'; accepted_order: number };
export interface DrainProof { nativeExited: boolean; descendantsDrained: boolean; businessDrained: boolean; admissionFrozen: boolean }
const within = (parent: string, child: string) => { const r = relative(parent, child); return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith('../')); };
/** Only registered roots are examined; realpath aliases and overlapping project directories share one outer root. */
export function directoryIdentity(cwd: string, registered: readonly string[]) {
  const actual = realpathSync(cwd);
  const roots = registered.map(p => { try { return realpathSync(p); } catch { return null; } }).filter((p): p is string => !!p && within(p, actual));
  if (!roots.length) throw new DriverError('REJECTED', '工作目录不属于已登记的工作根，不能取得写入资格');
  const root = roots.sort((a, b) => a.length - b.length)[0], stat = statSync(root);
  if (!stat.isDirectory()) throw new DriverError('REJECTED', '登记工作根不是目录');
  return { root, identity: `${root}:${stat.dev}:${stat.ino}` };
}
function overlappingIdentity(a: string, b: string) {
  if (a===b) return true;
  const x=/^(.*):(\d+):(\d+)$/.exec(a),y=/^(.*):(\d+):(\d+)$/.exec(b);
  return !!x&&!!y&&(x[2]===y[2]&&x[3]===y[3]||within(x[1],y[1])||within(y[1],x[1]));
}
/** Persistent FIFO. Only host-derived complete read policies may request read; untrusted labels remain write. */
export class DirectoryQueue {
  constructor(private readonly store: AgentStore) {}
  enter(taskId: string, identity: string, trustedRead = false): QueueRow {
    return this.store.tx(emit => {
      const existing = this.forTask(taskId); if (existing) { if (existing.directory_identity !== identity) throw new DriverError('STATE', '任务的工作根占用仍未释放'); return existing; }
      const id = randomUUID(), order = (this.store.sqlite.prepare('SELECT COALESCE(MAX(accepted_order),0)+1 AS n FROM agent_directory_queue').get() as { n: number }).n;
      this.store.sqlite.prepare("INSERT INTO agent_directory_queue(queue_id,directory_identity,task_id,kind,state,accepted_order,created_at) VALUES(?,?,?,?,'queued',?,?)").run(id, identity, taskId, trustedRead ? 'read' : 'write', order, new Date().toISOString());
      emit(taskId, 'directory.queued', { queueId: id, order }); return this.get(id)!;
    });
  }
  get(id: string) { return this.store.sqlite.prepare('SELECT * FROM agent_directory_queue WHERE queue_id=?').get(id) as QueueRow | undefined; }
  forTask(taskId: string) { return this.store.sqlite.prepare("SELECT * FROM agent_directory_queue WHERE task_id=? AND state IN ('queued','active') ORDER BY accepted_order LIMIT 1").get(taskId) as QueueRow | undefined; }
  acquire(id: string): boolean {
    return this.store.tx(emit => {
      const row = this.get(id); if (!row || !['queued', 'active'].includes(row.state)) return false; if (row.state === 'active') return true;
      const serial=(this.store.sqlite.prepare('SELECT rowid AS n FROM agent_directory_queue WHERE queue_id=?').get(id) as {n:number}).n;
      if (row.kind === 'write' && (this.store.sqlite.prepare("SELECT rowid AS serial,* FROM agent_directory_queue WHERE kind='write' AND state IN ('active','queued') AND queue_id<>?").all(id) as (QueueRow&{serial:number})[]).some(other=>overlappingIdentity(row.directory_identity,other.directory_identity)&&(other.state==='active'||other.serial<serial))) return false;
      this.store.sqlite.prepare("UPDATE agent_directory_queue SET state='active' WHERE queue_id=? AND state='queued'").run(id); emit(row.task_id, 'directory.acquired', { queueId: id }); return true;
    });
  }
  hasQueuedCompetitor(taskId: string) {
    const q=this.forTask(taskId);if(!q)return false;
    return (this.store.sqlite.prepare("SELECT directory_identity FROM agent_directory_queue WHERE task_id<>? AND kind='write' AND state='queued'").all(taskId) as {directory_identity:string}[]).some(other=>overlappingIdentity(q.directory_identity,other.directory_identity));
  }
  bind(id: string, runId: string) {
    const row = this.get(id), run = this.store.run(runId);
    if (!row || row.state !== 'active' || run?.task_id !== row.task_id || row.run_id && row.run_id !== runId) throw new DriverError('STATE', '运行与目录资格不符');
    this.store.sqlite.prepare('UPDATE agent_directory_queue SET run_id=? WHERE queue_id=?').run(runId, id);
  }
  release(id: string, proof: DrainProof) {
    if (!Object.values(proof).every(v => v === true)) throw new DriverError('STATE', '退出、后代或业务仍未排空，保留目录占用');
    return this.store.tx(emit => { const r = this.get(id); if (!r || r.state !== 'active') return false; this.store.sqlite.prepare("UPDATE agent_directory_queue SET state='released',ended_at=? WHERE queue_id=?").run(new Date().toISOString(), id); emit(r.task_id, 'directory.released', { queueId: id, proof }); return true; });
  }
  cancel(taskId: string) { this.store.tx(emit => { const changed = this.store.sqlite.prepare("UPDATE agent_directory_queue SET state='canceled',ended_at=? WHERE task_id=? AND state='queued'").run(new Date().toISOString(), taskId); if(changed.changes)emit(taskId, 'directory.canceled', {}); }); }
}
