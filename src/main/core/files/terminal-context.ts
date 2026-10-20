import { createHash, randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent } from 'electron';
import { FileError, type FileActionTarget, type FileIdentity, type FileRevision, type RootRequest } from '@shared/files';
import { formatTerminalReferences, terminalBindingSchema, terminalInsertionSchema, terminalPathData, terminalBodyData, terminalPrepareSchema,
  type TerminalBinding, type TerminalBindingInput, type TerminalInsertionInput, type TerminalInsertionReceipt, type TerminalPrepareInput, type TerminalFileReference } from '@shared/file-terminal';
import type { PtyAccess } from '../../pty-access';
import type { FileRootsService, RootLease } from './roots';

export interface TerminalFileSource {
  relativePath: string; absolutePath: string; revision: FileRevision; signal: AbortSignal;
  assert(): void; inspect(): Promise<FileRevision>;
  read(offset:number,length:number,signal:AbortSignal):Promise<Uint8Array>;
}
interface Binding {
  value: TerminalBinding; owner: string; root: RootLease; cancelled: boolean;
  sources: Map<string, TerminalFileSource>;
  requests: Map<string, { fingerprint: string; result: Promise<TerminalInsertionReceipt> }>;
}
export class FileTerminalService {
  private readonly bindings = new Map<string, Binding>();
  constructor(private readonly deps: {
    access: PtyAccess; roots: FileRootsService; taskProject: (taskId: string) => string | null;
    source: (owner: string, target: FileActionTarget, identity?: FileIdentity) => Promise<TerminalFileSource>;
    bracketedPaste: (ptyId: string) => Promise<boolean>; write: (ptyId: string, data: string) => void;
  }) {}

  bind(event: IpcMainInvokeEvent, owner: string, raw: TerminalBindingInput): TerminalBinding {
    const input = terminalBindingSchema.parse(raw); this.deps.access.authorize(event, input);
    const root = this.deps.roots.require(owner, input.root);
    if (root.scope.kind === 'task' ? root.scope.taskId !== input.taskId : root.projectId !== this.deps.taskProject(input.taskId)) throw new FileError('UNTRUSTED', '文件根不属于当前任务');
    this.closeOwner(owner);
    const value = { id: randomUUID(), taskId: input.taskId, ptyId: input.ptyId, lease: root.lease, generation: root.generation };
    this.bindings.set(owner, { value, owner, root, cancelled: false, sources: new Map(), requests: new Map() });
    return value;
  }
  release(event: IpcMainInvokeEvent, owner: string, id: string): void {
    this.deps.access.requireSender(event);
    if (this.bindings.get(owner)?.value.id === id) this.closeOwner(owner);
  }
  closeOwner(owner: string): void { const binding = this.bindings.get(owner); if (binding) { binding.cancelled = true; this.bindings.delete(owner); } }
  private require(event: IpcMainInvokeEvent, owner: string, id: string): Binding {
    const binding = this.bindings.get(owner);
    this.deps.access.requireSender(event);
    if (!binding || binding.cancelled || binding.value.id !== id) throw new FileError('CANCELLED', '文件或终端已切换，请重新选择后投递');
    this.deps.access.authorize(event, binding.value);
    this.deps.roots.require(owner, binding.root);
    return binding;
  }
  async prepare(event: IpcMainInvokeEvent, owner: string, raw: TerminalPrepareInput): Promise<TerminalFileReference> {
    const input = terminalPrepareSchema.parse(raw), binding = this.require(event, owner, input.bindingId);
    const root: RootRequest = input.target.kind === 'document' ? input.target.ref : input.target.path;
    if (root.lease !== binding.root.lease || root.generation !== binding.root.generation) throw new FileError('UNTRUSTED', '引用不属于当前文件根');
    if (binding.sources.size >= 256) throw new FileError('TOO_LARGE', '当前引用数量已达上限，请重新打开文件区');
    const source = await this.deps.source(owner, input.target, input.identity);
    this.require(event, owner, input.bindingId); source.assert();
    const id = randomUUID(); binding.sources.set(id, source);
    return { id, relativePath: source.relativePath, revision: source.revision, identity: { device: source.revision.device, inode: source.revision.inode } };
  }
  async status(event: IpcMainInvokeEvent, owner: string, bindingId: string, ids: string[]): Promise<Record<string, 'fresh' | 'stale' | 'missing'>> {
    const binding = this.require(event, owner, bindingId);
    if (!Array.isArray(ids) || ids.length > 64 || ids.some(id => typeof id !== 'string')) throw new FileError('INVALID_INPUT', '引用列表无效');
    const states: Record<string, 'fresh' | 'stale' | 'missing'> = {};
    for (const id of ids) {
      const source = binding.sources.get(id);
      if (!source) { states[id] = 'missing'; continue; }
      try { const current = await source.inspect(); states[id] = current.hash === source.revision.hash ? 'fresh' : 'stale'; }
      catch { states[id] = 'missing'; }
      this.require(event, owner, bindingId);
    }
    return states;
  }
  insert(event: IpcMainInvokeEvent, owner: string, raw: TerminalInsertionInput): Promise<TerminalInsertionReceipt> {
    const input = terminalInsertionSchema.parse(raw), binding = this.require(event, owner, input.bindingId);
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex'), previous = binding.requests.get(input.operationId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new FileError('INVALID_INPUT', '同一投递编号不能更换内容');
      return previous.result;
    }
    // Keep every operation identity while its binding remains usable. Dropping
    // old entries would let a delayed duplicate write to the same PTY twice.
    if (binding.requests.size >= 1024) throw new FileError('TOO_LARGE', '当前投递记录已满，请重新打开文件区后重试');
    const result = this.deliver(event, owner, binding, input);
    binding.requests.set(input.operationId, { fingerprint, result }); return result;
  }
  private async deliver(event: IpcMainInvokeEvent, owner: string, binding: Binding, input: TerminalInsertionInput): Promise<TerminalInsertionReceipt> {
    let writeStarted = false;
    try {
    const ids = input.kind === 'path' ? [input.sourceId] : input.references.map(reference => reference.sourceId), sources = new Map<string, TerminalFileSource>(), stale: string[] = [];
    for (const id of new Set(ids)) {
      const source = binding.sources.get(id);
      if (!source) throw new FileError('UNTRUSTED', '文件引用已失效');
      const current = await source.inspect(); this.require(event, owner, input.bindingId); source.assert();
      if (current.hash !== source.revision.hash) stale.push(id);
      sources.set(id, source);
    }
    const body = input.kind === 'context' ? formatTerminalReferences(input.references.map(reference => ({ ...reference, relativePath: sources.get(reference.sourceId)!.relativePath })), input) : null;
    // Drain native output through the same xterm parser before choosing paste
    // framing. Revalidation and the write below are synchronous, with no await.
    const bracketed = input.kind === 'context' && await this.deps.bracketedPaste(binding.value.ptyId);
    const data = body ? terminalBodyData(body.text, bracketed) : terminalPathData(sources.get(ids[0])!.absolutePath);
    this.require(event, owner, input.bindingId);
    for (const source of sources.values()) source.assert();
    writeStarted = true;
    this.deps.write(binding.value.ptyId, data);
    return { operationId: input.operationId, state: 'inserted', characters: body?.text.length ?? data.length, removed: body?.removed ?? 0, replaced: body?.replaced ?? 0, truncated: body?.truncated ?? 0, stale, bracketed };
    } catch (error) {
      // A native write may throw after accepting some bytes. Never certify a
      // retry as safe once write has started; the cached receipt stays unknown.
      return { operationId: input.operationId, state: writeStarted ? 'unknown' : 'failed',
        message: writeStarted ? '插入结果未知；终端未能确认完整写入，不会自动重发' : error instanceof Error ? error.message : String(error) };
    }
  }
}
