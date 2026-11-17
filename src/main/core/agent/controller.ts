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
      applicationReference:(e,taskId:string,source:import('@shared/application-terminal').ApplicationTerminalSource)=>run(e,w=>w.applicationReference(e,taskId,source)),
      businessReview:(e,taskId:string,id:string,revision:number)=>run(e,w=>w.requests.present(taskId,id,revision,e)),
      openHomeTerminal:(e,projectId:string,dirId:string,size?:{cols:number;rows:number})=>run(e,w=>w.openHomeTerminal(projectId,dirId,size)),
      plugins:(e,taskId:string)=>run(e,w=>w.plugins(taskId)),
      profiles: e => run(e, w => w.profiles()),
      cancelDiff:(e,taskId:string,turnId:string)=>run(e,w=>w.diffs.cancel(taskId,turnId)),
      changeFiles:(e,taskId:string,turnId:string,offset?:number)=>run(e,w=>w.diffs.files(taskId,turnId,offset)),
      changes:(e,taskId:string)=>run(e,w=>w.diffs.list(taskId)),
      changePatchBody:(e,taskId:string,turnId:string,path:string,hash:string,offset:number)=>run(e,w=>w.diffs.patchBody(taskId,turnId,path,hash,offset)),
      changePatch:(e,taskId:string,turnId:string,path:string)=>run(e,w=>w.diffs.patch(taskId,turnId,path)),
      resolveLink:(e,input:{taskId:string;itemId:string;href:string})=>run(e,w=>{if(!w.links)throw new Error('消息链接尚未初始化');return w.links.resolve(input);}),
      relations: (e, taskId: string) => run(e, w => w.delegations.view(taskId)),
      treeRequests: (e, taskId: string) => run(e, w => w.delegations.treeRequests(taskId)),
      setMode: (e, taskId: string, enabled: boolean) => run(e, w => w.delegations.setMode(taskId, enabled)),
      cancelChild: (e, taskId: string, childTaskId: string) => run(e, w => w.delegations.cancel(taskId, childTaskId)),
      list: e => run(e, w => w.tasks.list()),
      create: (e, req: { projectId: string | null; dirId: string | null; cwd: string; title: string; profileId: string; tier: Tier; model?: string; carryExtensions?: boolean; extensionPreferences?: Record<string, boolean> }) => run(e, w => w.tasks.create(req)),
      snapshot: (e, taskId: string) => run(e, w => w.tasks.snapshot(taskId)),
      events: (e, taskId: string, afterSeq: number) => run(e, w => w.tasks.events(taskId, afterSeq)),
      history: (e, taskId: string, beforeOrdinal: number) => run(e, w => w.tasks.history(taskId, beforeOrdinal)),
      nativeHistory: (e, taskId: string, itemId: string, beforeOrdinal?: number) => run(e, w => w.tasks.nativeHistory(taskId, itemId, beforeOrdinal)),
      itemBody: (e, taskId: string, itemId: string, offset: number, revision?: number) => run(e, w => w.tasks.itemBody(taskId, itemId, offset, revision)),
      requestBody: (e, taskId: string, requestId: string, offset: number, revision?: number) => run(e, w => w.tasks.requestBody(taskId, requestId, offset, revision)),
      draftBody: (e, taskId: string, offset: number, revision?: number) => run(e, w => w.tasks.draftBody(taskId, offset, revision)),
      submit: (e, taskId: string, input: { clientInputId: string; text: string; expectedSelectionRevision: number; mode?: 'queue' | 'steer'; attachments?: unknown[] }) => run(e, w => w.tasks.submit(taskId, input,e)),
      prepareAttachment: (e, taskId: string | null, cwd: string | null, file: { name: string; mime?: string; sourcePath?: string; dataBase64?: string }) => run(e, w => w.tasks.prepareAttachment(taskId, cwd, file)),
      goal: (e, taskId: string, op: { kind: 'set'; objective: string } | { kind: 'pause' } | { kind: 'resume' } | { kind: 'clear' }) => run(e, w => w.tasks.goal(taskId, op)),
      setSelection: (e, taskId: string, patch: { tier?: Tier; model?: string | null; effort?: string | null; carryExtensions?: boolean }, expectedRevision: number) => run(e, w => w.tasks.setSelection(taskId, patch, expectedRevision)),
      switchProfile: (e, taskId: string, profileId: string, expectedRevision: number, model?: string | null) => run(e, w => w.tasks.switchProfile(taskId, profileId, expectedRevision, model)),
      setExtensions: (e, taskId: string, profileId: string, enabled: boolean, expectedRevision: number) => run(e, w => w.tasks.setExtensions(taskId, profileId, enabled, expectedRevision)),
      saveDraft: (e, taskId: string, draft: unknown, expectedRevision: number) => run(e, w => w.tasks.saveDraft(taskId, draft, expectedRevision)),
      stop: (e, taskId: string, subtree?: boolean) => run(e, w => w.tasks.stop(taskId, subtree)),
      cancelQueued: (e, taskId: string, turnId: string) => run(e, w => w.tasks.cancelQueued(taskId, turnId)),
      respond: (e, taskId: string, requestId: string, revision: number, result: unknown) => run(e, w => w.tasks.respond(taskId, requestId, revision, result,e)),
      archive: (e, taskId: string) => run(e, w => w.tasks.archive(taskId)),
      openTerminal: (e, taskId: string, size?: { cols: number; rows: number }) => run(e, w => { if (!w.terminals) throw new Error('终端不可用'); return w.terminals.open(taskId, size); }),
      closeTerminal: (e, taskId: string) => run(e, w => w.terminals?.close(taskId)),
      pasteToTerminal: (e, taskId: string, text: string) => run(e, w => { if (!w.terminals) throw new Error('终端不可用'); return w.terminals.paste(taskId, text); }),
      command: (e, taskId: string, name: string, args?: string) => run(e, w => w.tasks.command(taskId, name, args)),
      searchFiles: (e, taskId: string | null, cwd: string | null, query: string) => run(e, w => w.tasks.searchFiles(taskId, cwd, query)),
    }),
  };
}
