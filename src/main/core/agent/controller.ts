// M14 任务命令 IPC（技术方案 T1.5 §3）。发送方由 Electron 提供并核对，渲染进程参数不能指定来源、PID 或运行身份。
import type { IpcMainInvokeEvent } from 'electron';
import { createScopedRPCController } from '@shared/ipc/rpc';
import type { AgentWorkspace } from './wiring';
import type { Tier } from './permissions';

export function createAgentTaskController(w: AgentWorkspace | undefined, requireSender: (event: IpcMainInvokeEvent) => void) {
  const run = <T>(event: IpcMainInvokeEvent, fn: (w: AgentWorkspace) => T): T => {
    requireSender(event);
    if (!w) throw new Error('统一 Agent 工作区不可用');
    return fn(w);
  };
  return {
    agentTasks: createScopedRPCController({
      profiles: e => run(e, w => w.profiles()),
      list: e => run(e, w => w.tasks.list()),
      create: (e, req: { projectId: string | null; dirId: string | null; cwd: string; title: string; profileId: string; tier: Tier; model?: string }) => run(e, w => w.tasks.create(req)),
      snapshot: (e, taskId: string) => run(e, w => w.tasks.snapshot(taskId)),
      events: (e, taskId: string, afterSeq: number) => run(e, w => w.tasks.events(taskId, afterSeq)),
      submit: (e, taskId: string, input: { clientInputId: string; text: string; expectedSelectionRevision: number; mode?: 'queue' | 'steer' }) => run(e, w => w.tasks.submit(taskId, input)),
      goal: (e, taskId: string, op: { kind: 'set'; objective: string } | { kind: 'pause' } | { kind: 'resume' } | { kind: 'clear' }) => run(e, w => w.tasks.goal(taskId, op)),
      setSelection: (e, taskId: string, patch: { tier?: Tier; model?: string | null }, expectedRevision: number) => run(e, w => w.tasks.setSelection(taskId, patch, expectedRevision)),
      saveDraft: (e, taskId: string, draft: unknown, expectedRevision: number) => run(e, w => w.tasks.saveDraft(taskId, draft, expectedRevision)),
      stop: (e, taskId: string) => run(e, w => w.tasks.stop(taskId)),
      cancelQueued: (e, taskId: string, turnId: string) => run(e, w => w.tasks.cancelQueued(taskId, turnId)),
      respond: (e, taskId: string, requestId: string, revision: number, result: unknown) => run(e, w => w.tasks.respond(taskId, requestId, revision, result)),
      archive: (e, taskId: string) => run(e, w => w.tasks.archive(taskId)),
    }),
  };
}
