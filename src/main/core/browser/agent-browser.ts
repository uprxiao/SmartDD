import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { browserDigest } from './artifacts';
import { BrowserError, helperError } from './errors';
import type { ProcessIdentity, ProcessIdentityReader } from '../applications/process-identity';
import { ApplicationError } from '@shared/applications';

/** This exact chunk was rejected before handing any bytes to the helper. Earlier chunks may have run. */
export class BrowserInputInterrupted extends BrowserError {
  constructor() { super('BROWSER_ERROR', '输入会话已经中断；已确认部分保留，不能自动继续或重发'); }
}

export interface BrowserHelperOptions { executable: string; sha256: string; home: string; session: string; endpoint: string; sockets?: string; processes?: ProcessIdentityReader }
/** A fixed helper, private home and one CDP capability URL. No caller-supplied process arguments. */
export class BrowserHelper {
  private active?: ChildProcess;
  private initialized?: Promise<void>;
  private timeouts = 0;
  private daemon?: ProcessIdentity;
  private closing?: Promise<void>;
  private revision = 0;
  private lastCleanup?: { daemonPid: number | null; daemonState: string; clientStopped: boolean; socketFilesRemoved: boolean };
  get cleanup() { return this.lastCleanup; }
  get sessionRevision(): number { return this.revision; }
  constructor(readonly options: BrowserHelperOptions, private readonly resetReferences: () => void) {}
  private async prepare(): Promise<void> {
    this.initialized ??= (async () => {
      if (browserDigest(await readFile(this.options.executable)) !== this.options.sha256)
        throw new BrowserError('BROWSER_UNAVAILABLE', 'agent-browser 文件摘要不符');
      for (const path of [this.options.home, this.socketDirectory(), join(this.options.home, 'tmp')]) await mkdir(path, { recursive: true, mode: 0o700 });
    })();
    await this.initialized;
  }
  private socketDirectory(): string { return this.options.sockets ?? join(this.options.home, 'sockets'); }
  private async observeDaemon(): Promise<void> {
    if (!this.options.processes) return;
    try {
      const pid = Number(await readFile(join(this.socketDirectory(), this.options.session + '.pid'), 'utf8'));
      if (Number.isSafeInteger(pid) && pid > 1 && (!this.daemon || this.daemon.pid !== pid)) this.daemon = this.options.processes.read(pid) ?? undefined;
    } catch { /* The helper has not published its owned PID yet. */ }
  }
  private environment(): NodeJS.ProcessEnv {
    return { PATH: process.env.PATH, HOME: this.options.home, TMPDIR: join(this.options.home, 'tmp'),
      XDG_CONFIG_HOME: join(this.options.home, 'config'), XDG_CACHE_HOME: join(this.options.home, 'cache'),
      AGENT_BROWSER_SOCKET_DIR: this.socketDirectory(), AGENT_BROWSER_IDLE_TIMEOUT_MS: '600000',
      // The explicit dialog accept/dismiss contract includes alerts. The pinned
      // kernel otherwise consumes alert/beforeunload before the caller can act.
      AGENT_BROWSER_NO_AUTO_DIALOG: '1' };
  }
  private async checkSession(): Promise<boolean> {
    await this.closing;
    await this.prepare();
    if (!this.daemon || !this.options.processes) return false;
    const state = this.options.processes.state(this.daemon);
    if (state === 'unknown') throw new BrowserError('BROWSER_UNAVAILABLE', '无法核对本页 agent-browser 进程身份');
    if (state === 'running') return false;
    await this.close(); // Invalidate refs before any action can arm an old generation.
    return true;
  }
  /** Called before host-only actions too: fill/CDP fallback must not bypass helper lifecycle checks. */
  async ensureSession(): Promise<void> {
    if (await this.checkSession()) await this.command(['get', 'url']);
  }
  async assertInputSession(revision: number): Promise<void> {
    await this.checkSession();
    if (revision !== this.revision) throw new BrowserInputInterrupted();
  }
  private invalidate(): void { this.revision++; this.resetReferences(); }
  private async timeoutFailure(timeout: number, message?: string): Promise<never> {
    this.timeouts++;
    if (this.timeouts >= 3) {
      await this.close();
      this.timeouts = 0;
      // Reconnect with a read, never replay the failed operation or navigate the live page.
      await this.command(['get', 'url']).catch(() => {});
    }
    throw new BrowserError('BROWSER_TIMEOUT', message ?? `浏览器命令等待 ${timeout}ms 后超时`);
  }
  async command(command: readonly string[], options: { signal?: AbortSignal; timeout?: number; dispatched?: () => void; sessionRevision?: number } = {}): Promise<unknown> {
    if (command[0] === 'clipboard' && command[1] === 'write' && Buffer.byteLength(command.slice(2).join(' '), 'utf8') > 16 * 1024 * 1024)
      throw new ApplicationError('INVALID_INPUT', '剪贴板文本超过16MiB宿主上限');
    await this.checkSession();
    if (options.sessionRevision !== undefined && options.sessionRevision !== this.revision) throw new BrowserInputInterrupted();
    if (options.signal?.aborted) {
      await this.closing;
      throw options.signal.reason ?? new BrowserError('BROWSER_ERROR', '操作已取消');
    }
    const timeout = options.timeout ?? 90000;
    const output = await new Promise<{ stdout: string; error: Error | null; timedOut: boolean }>(resolve => {
      let timedOut = false;
      const child = execFile(this.options.executable,
        ['--session', this.options.session, '--cdp', this.options.endpoint, 'batch', '--json'],
        { env: this.environment(), maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
          clearTimeout(timer); clearTimeout(hardKill); clearInterval(observe); options.signal?.removeEventListener('abort', cancel);
          if (this.active === child) this.active = undefined;
          resolve({ stdout, error, timedOut });
        });
      this.active = child;
      let hardKill: ReturnType<typeof setTimeout> | undefined;
      const observe = setInterval(() => { void this.observeDaemon(); }, 100);
      const cancel = () => { child.kill('SIGTERM'); hardKill ??= setTimeout(() => child.kill('SIGKILL'), 250); void this.close(); };
      const timer = setTimeout(() => { timedOut = true; cancel(); }, timeout);
      options.signal?.addEventListener('abort', cancel, { once: true });
      child.stdin!.on('error', () => {});
      child.stdin!.end(JSON.stringify([command]), () => options.dispatched?.());
    });
    // Fast commands can finish before the 100ms observer ticks. Keep the kernel birth identity
    // after every response so a later killed/reused PID cannot leave old refs valid.
    await this.observeDaemon();
    if (output.timedOut) {
      await this.closing;
      return this.timeoutFailure(timeout);
    }
    if (options.signal?.aborted) {
      // Keep the page queue and run lease until the owned helper has actually stopped.
      await this.closing;
      throw options.signal.reason ?? new BrowserError('BROWSER_ERROR', '操作已取消');
    }
    let records: { success?: boolean; result?: unknown; data?: unknown; error?: string }[];
    try { records = JSON.parse(output.stdout); } catch {
      this.invalidate();
      throw new BrowserError('BROWSER_ERROR', 'agent-browser 没有返回完整结果；操作可能已经生效，请查询回执');
    }
    if (!Array.isArray(records) || records.length !== 1 || records[0].success !== true) {
      // execFile's error.message includes argv, including the private CDP capability URL.
      const message = String(records?.[0]?.error ?? 'agent-browser 执行失败，未返回有效结果').replaceAll(this.options.endpoint, '<page-cdp>');
      // A semantic locator has no snapshot reference. Preserve its real failure
      // text instead of turning a missing match into an opaque stale-ref error.
      const error = command[0]==='find'&&!/timed out|timeout/i.test(message)
        ? new BrowserError('BROWSER_ERROR',message.slice(0,2048)) : helperError(message);
      if (error.code === 'BROWSER_TIMEOUT') return this.timeoutFailure(timeout, error.message);
      if (/failed to read|failed to send|invalid response:/i.test(message)) await this.close();
      throw error;
    }
    this.timeouts = 0;
    return records[0].result ?? records[0].data ?? null;
  }
  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.closeOwned().finally(() => { this.closing = undefined; });
    return this.closing;
  }
  private async closeOwned(): Promise<void> {
    this.invalidate(); this.active?.kill('SIGTERM');
    if (!this.initialized) return;
    await this.observeDaemon();
    const active = this.active, hardKill = setTimeout(() => active?.kill('SIGKILL'), 250);
    const stopDaemon = () => {
      if (this.daemon && this.options.processes?.state(this.daemon) === 'running') {
        try { process.kill(this.daemon.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
    };
    // A descendant can inherit stdout and prevent execFile's close callback even after its parent exits.
    const daemonDeadline = setTimeout(stopDaemon, 3250);
    // `close` itself can start a daemon when the previous daemon is already dead. Its late
    // shutdown then removes the replacement's socket. Remove stale files directly in that case.
    let hasDaemonRecord = Boolean(this.daemon);
    if (!hasDaemonRecord) try {
      const pid = Number(await readFile(join(this.socketDirectory(), this.options.session + '.pid'), 'utf8'));
      hasDaemonRecord = Number.isSafeInteger(pid) && pid > 1;
    } catch { /* No helper was started for this page. */ }
    const alreadyStopped = this.daemon && this.options.processes?.state(this.daemon) === 'stopped';
    if (hasDaemonRecord && !alreadyStopped) {
      await new Promise<void>(resolve => execFile(this.options.executable, ['--session', this.options.session, 'close'],
        { env: this.environment(), timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 65536 }, () => resolve()));
    }
    clearTimeout(hardKill); clearTimeout(daemonDeadline); stopDaemon();
    let pid: number | null = null;
    try { const value=Number(await readFile(join(this.socketDirectory(),this.options.session+'.pid'),'utf8'));if(Number.isSafeInteger(value)&&value>1)pid=value; } catch {}
    let daemonState = this.daemon && this.options.processes ? this.options.processes.state(this.daemon) : pid ? 'unknown' : 'absent';
    if(pid && daemonState==='unknown')try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')daemonState='stopped';}
    let socketFilesRemoved=false;
    if(daemonState==='stopped'||daemonState==='absent'){
      for(const suffix of ['.sock','.pid','.stream'])await rm(join(this.socketDirectory(),this.options.session+suffix),{force:true});
      socketFilesRemoved=true;
    }
    this.lastCleanup={daemonPid:pid??this.daemon?.pid??null,daemonState,clientStopped:!active||active.exitCode!==null||active.signalCode!==null,socketFilesRemoved};
    this.daemon = undefined;
  }
}
