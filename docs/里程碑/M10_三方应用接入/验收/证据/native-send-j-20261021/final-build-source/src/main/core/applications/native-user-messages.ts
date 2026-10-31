import { constants } from 'node:fs';
import { open, opendir, lstat, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { RunContext } from './run-registry';
import { digest } from './manifest';
import { encodeClaudeDir } from '../tasks/native-sessions';
import { NativeUserInputs, type HostUserInputReceipt } from './native-user-inputs';

const LIMIT = { tail: 4 * 1024 * 1024, line: 1024 * 1024, head: 65536, entries: 4096, records: 8192, proofs: 64 };
const supported: Record<string, readonly string[]> = { 'claude-code': ['2.1.303'], codex: ['0.162.1'] };
const utf8 = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const json = (bytes: Uint8Array): any => { try { return JSON.parse(utf8(bytes)); } catch { return null; } };
export interface NativeUserMessage {
  readonly id: string; readonly runId: string; readonly runner: string; readonly cliVersion: string;
  readonly nativeSessionId: string; readonly timestamp: number; readonly text: string;
  readonly recordHash: string; readonly receipt: HostUserInputReceipt;
}
export interface NativeUserMessageResult {
  status: 'matched' | 'no-match' | 'unavailable' | 'unsupported';
  messages: readonly NativeUserMessage[]; issueCode: string | null;
}
interface Registration { version: string; signal: AbortSignal; detach: () => void }
interface Proof { file: string; root: string; offset: number; length: number; device: number; inode: number; headerHash: string | null; cwd: string; expiresAt: number }
/** Main-process origin evidence only. Native roles AND input accepted by the owned PTY or launch argument must
 * match. Neither a native file nor one of these receipts decides whether sending is intended.
 * No method is exposed by RPC, MCP, or the versioned package runtime.
 */
export class NativeUserMessages {
  private readonly registrations = new Map<string, Registration>();
  private readonly proofs = new Map<NativeUserMessage, Proof>();
  private closed = false;
  constructor(private readonly inputs: NativeUserInputs, private readonly current: (runId: string) => RunContext, private readonly now = Date.now) {}
  register(runId: string, version: string, signal: AbortSignal): void {
    if (this.closed || signal.aborted) return;
    const old = this.registrations.get(runId);
    if (old) { if (old.version !== version || old.signal !== signal) throw new ApplicationError('RESOURCE_STATE_CHANGED', '原生消息读取版本已固定'); return; }
    if (this.registrations.size >= 128) throw new ApplicationError('RESOURCE_BUSY', '原生消息来源登记已满');
    const remove = () => { this.registrations.get(runId)?.detach(); this.registrations.delete(runId); for (const message of this.proofs.keys()) if (message.runId === runId) this.proofs.delete(message); };
    this.registrations.set(runId, { version, signal, detach: () => signal.removeEventListener('abort', remove) });
    signal.addEventListener('abort', remove, { once: true });
  }
  private context(runId: string): { context: RunContext; registration: Registration } {
    const registration = this.registrations.get(runId), context = this.current(runId);
    if (this.closed || !registration || registration.signal.aborted || context.signal.aborted || context.run.state !== 'active' || context.run.runId !== runId || context.signal !== registration.signal || !context.snapshot.native.sessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(context.snapshot.native.sessionId)) throw new ApplicationError('SOURCE_UNAVAILABLE', '没有本次运行的可核验原生用户消息来源');
    if (!supported[context.snapshot.runner]?.includes(registration.version)) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED', '当前原生消息格式尚未验证');
    return { context, registration };
  }
  private prune(): void { for (const [message, proof] of this.proofs) if (proof.expiresAt <= this.now() || !this.registrations.has(message.runId)) this.proofs.delete(message); }
  private async names(dir: string, budget: { left: number }): Promise<string[]> {
    const info = await lstat(dir); if (!info.isDirectory() || info.isSymbolicLink()) throw new ApplicationError('SOURCE_UNAVAILABLE', '原生消息目录不是普通目录');
    const names: string[] = [];
    for await (const entry of await opendir(dir)) { if (--budget.left < 0) throw new ApplicationError('TOO_LARGE', '原生消息目录超过本轮查找预算'); names.push(entry.name); }
    return names.sort().reverse();
  }
  private async locate(context: RunContext): Promise<{ root: string; file: string }> {
    const root = await realpath(context.snapshot.native.stateRoot), native = context.snapshot.native, id = native.sessionId!;
    if (context.snapshot.runner === 'claude-code') {
      const projects = join(root, 'projects'); await this.directory(projects);
      const cwds = new Set([native.cwd, await realpath(native.cwd)]), found: string[] = [];
      for (const cwd of cwds) { const dir = join(projects, encodeClaudeDir(cwd)); try { await this.directory(dir); const file = join(dir, id + '.jsonl'); if ((await lstat(file)).isFile()) found.push(file); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; } }
      const unique = [...new Set(found)]; if (unique.length !== 1) throw new ApplicationError('SOURCE_UNAVAILABLE', '未找到唯一的本会话原生消息文件');
      return { root, file: unique[0] };
    }
    const sessions = join(root, 'sessions'), budget = { left: LIMIT.entries }, found: string[] = [];
    for (const year of (await this.names(sessions, budget)).filter(n => /^\d{4}$/.test(n))) {
      for (const month of (await this.names(join(sessions, year), budget)).filter(n => /^(0[1-9]|1[0-2])$/.test(n))) {
        for (const day of (await this.names(join(sessions, year, month), budget)).filter(n => /^(0[1-9]|[12]\d|3[01])$/.test(n))) {
          const dir = join(sessions, year, month, day);
          for (const name of await this.names(dir, budget)) if (name.startsWith('rollout-') && name.endsWith('-' + id + '.jsonl')) found.push(join(dir, name));
        }
      }
    }
    if (found.length !== 1) throw new ApplicationError('SOURCE_UNAVAILABLE', '未找到唯一的本会话原生消息文件');
    return { root, file: found[0] };
  }
  private async directory(path: string): Promise<void> { const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApplicationError('SOURCE_UNAVAILABLE', '原生消息目录不能使用链接'); }
  private async openFile(root: string, file: string) {
    const actual = await realpath(file), rel = relative(root, actual);
    if (actual !== file || !rel || rel.startsWith('..') || isAbsolute(rel)) throw new ApplicationError('SOURCE_UNAVAILABLE', '原生消息文件不属于固定数据根');
    for (let dir = root, i = 0, parts = rel.split('/'); i < parts.length - 1; i++) { dir = join(dir, parts[i]); await this.directory(dir); }
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { if (!(await handle.stat()).isFile()) throw new ApplicationError('SOURCE_UNAVAILABLE', '原生消息来源不是普通文件'); return handle; } catch (error) { await handle.close(); throw error; }
  }
  private async header(handle: Awaited<ReturnType<typeof open>>, context: RunContext): Promise<string | null> {
    if (context.snapshot.runner !== 'codex') return null;
    const bytes = Buffer.alloc(LIMIT.head), read = await handle.read(bytes, 0, bytes.length, 0), end = bytes.subarray(0, read.bytesRead).indexOf(10);
    if (end < 0) throw new ApplicationError('SOURCE_UNAVAILABLE', '原生会话元信息尚未完整写入');
    const line = bytes.subarray(0, end), meta = json(line), cwd = context.snapshot.native.cwd;
    if (meta?.type !== 'session_meta' || meta.payload?.id !== context.snapshot.native.sessionId || typeof meta.payload?.cwd !== 'string' || !isAbsolute(meta.payload.cwd) || ![resolve(cwd), await realpath(cwd)].includes(resolve(meta.payload.cwd))) throw new ApplicationError('SCOPE_DENIED', '原生会话身份或目录不符');
    return digest(line);
  }
  private message(line: Buffer, context: RunContext, cwd: string): { text: string; timestamp: number } | null {
    const value = json(line); if (!value) return null;
    const timestamp = typeof value.timestamp === 'string' ? Date.parse(value.timestamp) : NaN;
    if (!Number.isFinite(timestamp)) return null;
    let content: unknown, kind: string;
    if (context.snapshot.runner === 'claude-code') {
      if (value.type !== 'user' || value.message?.role !== 'user' || value.sessionId !== context.snapshot.native.sessionId || typeof value.cwd !== 'string' || !isAbsolute(value.cwd) || ![resolve(context.snapshot.native.cwd), cwd].includes(resolve(value.cwd)) || value.isMeta === true || value.isSidechain === true || value.toolUseResult !== undefined) return null;
      if ((value.isMeta !== undefined && typeof value.isMeta !== 'boolean') || (value.isSidechain !== undefined && typeof value.isSidechain !== 'boolean')) return null;
      content = value.message.content; kind = 'text';
    } else {
      if (value.type !== 'response_item' || value.payload?.type !== 'message' || value.payload.role !== 'user') return null;
      content = value.payload.content; kind = 'input_text';
    }
    if (typeof content === 'string' && kind === 'text') return { text: content, timestamp };
    if (!Array.isArray(content) || !content.length || content.some(part => !part || typeof part !== 'object' || part.type !== kind || typeof part.text !== 'string')) return null;
    return { text: content.map(part => part.text).join('\n'), timestamp };
  }
  async read(runId: string): Promise<NativeUserMessageResult> {
    this.prune();
    try {
      const { context, registration } = this.context(runId), located = await this.locate(context), file = await this.openFile(located.root, located.file);
      try {
        const before = await file.stat(), headerHash = await this.header(file, context), cwd = await realpath(context.snapshot.native.cwd), start = Math.max(0, before.size - LIMIT.tail), bytes = Buffer.alloc(before.size - start), read = await file.read(bytes, 0, bytes.length, start), data = bytes.subarray(0, read.bytesRead), messages: NativeUserMessage[] = [];
        let begin = start ? data.indexOf(10) + 1 : 0;
        if (start && begin === 0) return { status: 'no-match', messages: [], issueCode: null };
        let records = 0;
        while (begin < data.length) {
          if (++records > LIMIT.records) throw new ApplicationError('TOO_LARGE', '原生消息记录超过本轮解析预算');
          const end = data.indexOf(10, begin); if (end < 0) break;
          const raw = data.subarray(begin, end), parsed = raw.length <= LIMIT.line ? this.message(raw, context, cwd) : null;
          if (parsed) {
            const receipt = this.inputs.match(context, parsed.text, parsed.timestamp);
            if (receipt) {
              const message: NativeUserMessage = Object.freeze({ id: randomUUID(), runId, runner: context.snapshot.runner, cliVersion: registration.version, nativeSessionId: context.snapshot.native.sessionId!, timestamp: parsed.timestamp, text: parsed.text.replace(/\r\n?/g, '\n'), recordHash: digest(raw), receipt });
              messages.push(message); this.proofs.set(message, { ...located, offset: start + begin, length: raw.length, device: before.dev, inode: before.ino, headerHash, cwd, expiresAt: Math.min(this.now() + 600000, receipt.observedAt + 600000) });
              while (this.proofs.size > LIMIT.proofs || [...this.proofs.keys()].reduce((n, value) => n + Buffer.byteLength(value.text), 0) > LIMIT.tail) this.proofs.delete(this.proofs.keys().next().value!);
              if (messages.length > LIMIT.proofs) messages.shift();
            }
          }
          begin = end + 1;
        }
        const after = await file.stat(), pathState = await lstat(located.file), again = Buffer.alloc(data.length), reread = await file.read(again, 0, again.length, start);
        if (after.size < before.size || !pathState.isFile() || pathState.isSymbolicLink() || pathState.dev !== before.dev || pathState.ino !== before.ino || before.dev !== after.dev || before.ino !== after.ino || reread.bytesRead !== data.length || !again.equals(data) || await this.header(file, context) !== headerHash || await realpath(context.snapshot.native.stateRoot) !== located.root || await realpath(context.snapshot.native.cwd) !== cwd) throw new ApplicationError('SOURCE_UNAVAILABLE', '原生消息文件在读取时被替换或截断');
        // Revalidate the owned process once after asynchronous IO, then use that same
        // snapshot for all results. The later claim still reopens/rechecks its exact row.
        const fresh = this.context(runId).context;
        if (fresh.snapshot.native.sessionId !== context.snapshot.native.sessionId) throw new ApplicationError('SCOPE_DENIED', '本次原生会话身份已改变');
        const verified: NativeUserMessage[] = [];
        for (const message of messages.reverse()) {
          if (this.proofs.has(message) && this.inputs.match(fresh, message.text, message.timestamp) === message.receipt) verified.push(message);
          else this.proofs.delete(message);
        }
        return { status: verified.length ? 'matched' : 'no-match', messages: Object.freeze(verified), issueCode: null };
      } finally { await file.close(); }
    } catch (error) {
      for (const message of this.proofs.keys()) if (message.runId === runId) this.proofs.delete(message);
      return { status: error instanceof ApplicationError && error.code === 'AGENT_ADAPTER_UNSUPPORTED' ? 'unsupported' : 'unavailable', messages: [], issueCode: error instanceof ApplicationError ? error.code : 'SOURCE_UNAVAILABLE' };
    }
  }
  async verify(message: NativeUserMessage): Promise<boolean> {
    this.prune(); const proof = this.proofs.get(message); if (!proof) return false;
    try {
      const { context, registration } = this.context(message.runId);
      if (await realpath(context.snapshot.native.stateRoot) !== proof.root || await realpath(context.snapshot.native.cwd) !== proof.cwd || registration.version !== message.cliVersion || context.snapshot.native.sessionId !== message.nativeSessionId || this.inputs.match(context, message.text, message.timestamp) !== message.receipt) return false;
      const file = await this.openFile(proof.root, proof.file);
      try {
        const stat = await file.stat(); if (stat.dev !== proof.device || stat.ino !== proof.inode || stat.size < proof.offset + proof.length + 1 || await this.header(file, context) !== proof.headerHash) return false;
        const bytes = Buffer.alloc(proof.length + 1), read = await file.read(bytes, 0, bytes.length, proof.offset);
        if (read.bytesRead !== bytes.length || bytes.at(-1) !== 10 || digest(bytes.subarray(0, -1)) !== message.recordHash) return false;
        const fresh = this.context(message.runId).context;
        return this.inputs.match(fresh, message.text, message.timestamp) === message.receipt;
      } finally { await file.close(); }
    } catch { return false; }
  }
  /** Pure RAM liveness/ordering guard. Full file/process verification remains asynchronous. */
  isLive(message: NativeUserMessage): boolean {
    this.prune();const proof=this.proofs.get(message),registration=this.registrations.get(message.runId);
    return !this.closed&&!!proof&&!!registration&&!registration.signal.aborted&&registration.version===message.cliVersion&&this.inputs.isLatest(message.receipt);
  }
  async claim(message: NativeUserMessage, intentId: string): Promise<void> {
    if (!z.uuid().safeParse(intentId).success) throw new ApplicationError('INVALID_INPUT', '具体发送意图编号无效');
    if (!await this.verify(message)) throw new ApplicationError('AUTHORIZATION_REQUIRED', '原生用户消息来源已变化或失效');
    this.inputs.claim(message.receipt, this.context(message.runId).context, intentId);
  }
  dispose(): void { this.closed = true; for (const registration of this.registrations.values()) registration.detach(); this.registrations.clear(); this.proofs.clear(); }
}
