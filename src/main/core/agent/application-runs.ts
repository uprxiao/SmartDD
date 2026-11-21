import { setTimeout as delay } from 'node:timers/promises';
import { storedCapabilitySessionSnapshotSchema } from '@shared/application-session-v3';
import { ApplicationError } from '@shared/applications';
import type { ProcessIdentityReader } from '../applications/process-identity';
import { sha256, type AgentStore } from './agent-store';
import type { AgentRunService } from './agent-run-service';
import type { AgentTaskService } from './agent-task-service';

export interface AgentApplicationRuns {
  runningInProject(projectId: string, appId: string): number;
  stopProject(projectId: string, appId: string): Promise<boolean>;
}

interface SelectionRun {
  run_id: string;
  task_id: string;
  binding_id: string;
  generation: number;
  owner_instance_id: string;
  pid: number | null;
  process_started_at: string | null;
  state: string;
  launch_plan_hash: string;
  snapshot_json: string | null;
  content_hash: string | null;
}

export function applicationRunsForAgent(
  store: AgentStore,
  runs: AgentRunService,
  tasks: AgentTaskService,
  processes: ProcessIdentityReader,
  ownerInstanceId: string,
): AgentApplicationRuns {
  const active = store.sqlite.prepare(`SELECT r.run_id,r.task_id,r.binding_id,r.generation,r.owner_instance_id,
    r.pid,r.process_started_at,r.state,r.launch_plan_hash,s.snapshot_json,s.content_hash
    FROM capability_runs r JOIN agent_bindings b ON b.binding_id=r.binding_id AND b.task_id=r.task_id
    LEFT JOIN agent_capability_sessions s ON s.capability_session_id=r.capability_session_id AND s.binding_id=b.binding_id
    WHERE r.project_id=? AND r.state IN ('preparing','prepared','active','stopping','orphaned')`);
  const matching = (projectId: string, appId: string) => (active.all(projectId) as SelectionRun[]).filter(row => {
    try {
      if (!row.snapshot_json || sha256(row.snapshot_json) !== row.content_hash) throw new Error();
      const scope = JSON.parse(row.snapshot_json);
      if (scope.runId !== row.run_id) throw new Error();
      if (scope.kind === 'native') return false;
      // The eventual business binding is checked against the pending selection before it can start.
      if (scope.kind === 'run_preparing' && row.state === 'preparing' && !row.pid && scope.launchPlanHash === row.launch_plan_hash) return false;
      if (scope.kind !== 'business') throw new Error();
      const snapshot = storedCapabilitySessionSnapshotSchema.parse(scope.snapshot);
      if (snapshot.taskId !== row.task_id || snapshot.projectId !== projectId) throw new Error();
      return snapshot.packages.some(item => item.appId === appId);
    } catch {
      throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '无法核验受影响运行的应用范围，已保留原连接选择');
    }
  });
  return {
    runningInProject: (projectId, appId) => matching(projectId, appId).length,
    async stopProject(projectId, appId) {
      const affected = matching(projectId, appId);
      const owned = (row: SelectionRun) => {
        const run = runs.runForTask(row.task_id) ?? runs.closingForTask(row.task_id);
        return row.owner_instance_id === ownerInstanceId && run?.runId === row.run_id &&
          run.bindingId === row.binding_id && run.generation === row.generation &&
          (!row.pid || (row.process_started_at && processes.state({ pid: row.pid, startedAt: row.process_started_at }) === 'running'));
      };
      if (!affected.every(owned)) return false;
      const deadline = performance.now() + 5000;
      const stop = Promise.all(affected.map(async row => {
        if (runs.runForTask(row.task_id)?.runId === row.run_id) await tasks.stop(row.task_id, false, row.run_id);
        await runs.close(row.run_id);
      }));
      const timeout = new AbortController();
      try {
        if (!await Promise.race([stop.then(() => true), delay(5000, false, { signal: timeout.signal })])) return false;
        while (matching(projectId, appId).length) {
          if (performance.now() >= deadline) return false;
          await delay(20);
        }
        return true;
      } finally {
        timeout.abort();
      }
    },
  };
}
