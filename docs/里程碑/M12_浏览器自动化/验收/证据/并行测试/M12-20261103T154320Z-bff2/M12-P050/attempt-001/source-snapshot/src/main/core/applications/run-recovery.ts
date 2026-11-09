import {canonicalJson} from './manifest';
import type {ResourceStore} from './resource-store';
import type {ProcessIdentityReader} from './process-identity';
import type {RunRow,ProcessRow} from './run-registry';
import {withResourceLock} from './resource-lock';
const TERMINAL=new Set(['stopped','failed']),PROCESS_DONE=new Set(['exited','canceled']);
const now=()=>new Date().toISOString();
/** Called under the original C lock and SQLite transaction. Does not signal a process or release long-lived session refs. */
export function finishCapabilityRun(store:ResourceStore,runId:string):void {
    const row = store.sqlite.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(runId) as RunRow; if (TERMINAL.has(row.state) || row.revocation_state !== 'revoked') return;
    if (!store.sqlite.prepare("SELECT 1 FROM capability_run_processes WHERE run_id=? AND kind='cli'").get(runId)) return;
    if (store.sqlite.prepare("SELECT 1 FROM capability_run_processes WHERE run_id=? AND state NOT IN ('exited','canceled')").get(runId) || store.sqlite.prepare("SELECT 1 FROM capability_run_activities WHERE run_id=? AND state='active'").get(runId)) return;
    const timestamp = now();
    store.sqlite.prepare("UPDATE capability_runs SET state='stopped',ended_at=? WHERE run_id=?").run(timestamp,runId);
    store.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE owner_kind='run' AND owner_id=? AND state<>'released'").run(timestamp,runId);
}
/** Shared by normal run recovery and exclusive startup before distribution activation.
 * Unknown/missing kernel identities remain protected by the original protocol. */
export async function recoverCapabilityRuns(store:ResourceStore,identities:ProcessIdentityReader,owned:(runId:string)=>boolean=()=>false):Promise<{runId:string;state:'running'|'unknown'|'stopped'|'orphaned'}[]> {
    const rows = store.sqlite.prepare("SELECT * FROM capability_runs WHERE state NOT IN ('stopped','failed')").all() as RunRow[], result: { runId: string;state: 'running' | 'unknown' | 'stopped' | 'orphaned' }[] = [];
    for (const row of rows) {
      if (owned(row.run_id)) { result.push({ runId: row.run_id,state: 'running' }); continue; }
      const owner = row.owner_pid && row.owner_started_at ? identities.state({ pid: row.owner_pid,startedAt: row.owner_started_at }) : 'unknown';
      if (owner !== 'stopped') { result.push({ runId: row.run_id,state: owner }); continue; }
      const processes = store.sqlite.prepare('SELECT * FROM capability_run_processes WHERE run_id=? ORDER BY process_id').all(row.run_id) as ProcessRow[];
      const observations = processes.map(p => ({ p,state: PROCESS_DONE.has(p.state) || p.state === 'reserved' ? 'stopped' : p.pid && p.process_started_at ? identities.state({ pid: p.pid,startedAt: p.process_started_at }) : 'unknown' }));
      const state = await withResourceLock(store.root,() => store.sqlite.transaction(() => {
        const fresh = store.sqlite.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(row.run_id) as RunRow, currentProcesses = store.sqlite.prepare('SELECT * FROM capability_run_processes WHERE run_id=? ORDER BY process_id').all(row.run_id);
        if (canonicalJson(fresh) !== canonicalJson(row) || canonicalJson(currentProcesses) !== canonicalJson(processes)) return 'unknown' as const;
        const timestamp = now();
        for (const { p,state } of observations) if (state === 'stopped' && !PROCESS_DONE.has(p.state)) store.sqlite.prepare('UPDATE capability_run_processes SET state=?,ended_at=? WHERE process_id=?').run(p.state === 'reserved' ? 'canceled' : 'exited',timestamp,p.process_id);
        store.sqlite.prepare("UPDATE capability_run_activities SET state='owner-stopped',ended_at=? WHERE run_id=? AND state='active'").run(timestamp,row.run_id);
        store.sqlite.prepare("UPDATE capability_runs SET state='orphaned',revocation_state='revoked',error_code='HOST_INTERRUPTED' WHERE run_id=?").run(row.run_id);
        finishCapabilityRun(store,row.run_id);
        if ((store.sqlite.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(row.run_id) as RunRow).state === 'stopped') return 'stopped' as const;
        store.sqlite.prepare("UPDATE capability_resource_leases SET state='recovery-required' WHERE owner_kind='run' AND owner_id=? AND state<>'released'").run(row.run_id); return 'orphaned' as const;
      }).immediate()); result.push({ runId: row.run_id,state });
    }
    return result;
}
