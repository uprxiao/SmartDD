// M14 本机程序发现（技术方案 T1.5 §7.1）：沿用 M13 登录 shell PATH 与用户显式路径；核对 realpath、可执行位、
// --version 与能力；缺 CLI 给出检测路径与安装指引，不下载安装器、不自动换程序。
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectNativeCli, nativeExecutableIdentity, type CheckedNativeCli, type DetectOptions } from '../ai/runner-detect';
import { evaluateCapabilities, type CapabilityName, type DriverCapabilities, type DriverId } from './capabilities';
import type { AgentStore } from './agent-store';
import { DriverError } from './driver';
import { JsonlRpcPeer } from './jsonl-rpc';
import { inspectAntigravity } from './drivers/antigravity-acp';

const RUNNER = { 'claude-sdk': 'claude', 'codex-app-server': 'codex', 'antigravity-acp': 'antigravity' } as const;
const INSTALL_HINT: Record<DriverId, string> = {
  'claude-sdk': '安装 Claude Code（https://docs.claude.com/claude-code）后重新检测，或在配置中指定 claude 的完整路径',
  'codex-app-server': '安装 Codex CLI（npm i -g @openai/codex）后重新检测，或在配置中指定 codex 的完整路径',
  'antigravity-acp': '安装 Antigravity CLI 后重新检测，或指定 agy 的完整路径',
};

export interface DriverProbe extends DriverCapabilities {
  checkedCli?: CheckedNativeCli;
  binaryPath: string | null;
  realpath: string | null;
  shellPath: string | null;
  /** Proxy variables set by the login shell (D06-79). */
  shellProxy?: Record<string, string>;
  missing?: { searched: string; hint: string };
}

export interface ProbeOptions extends DetectOptions {
  /** 用户显式路径；缺省按登录 shell PATH 查找默认命令。 */
  executable?: string | null;
  /** 协议探测：返回 false 表示该能力的原生方法不可用。 */
  probe?: (name: CapabilityName) => boolean;
  inspectCodexProtocol?: boolean;
  detect?: typeof detectNativeCli;
}

const protocolProbes = new Map<string, Promise<ReadonlySet<CapabilityName>>>();

/** Reuse recent login shell results across switches within the same App instance. */
export function createNativeCliDetector(detect = detectNativeCli): typeof detectNativeCli {
  type Detection = Awaited<ReturnType<typeof detectNativeCli>>;
  const entries = new Map<string, { value: Detection; identity: string; expires: number }>();
  const pending = new Map<string, Promise<Detection>>();
  return async (runner, executable, options) => {
    if (options.signal || options.timeoutMs !== undefined) return detect(runner, executable, options);
    // Loading the Claude SDK mutates these process-global values on demand.
    // Keep SDK metadata out of the login shell used for CLI discovery.
    const env = { ...options.env };
    delete env.CLAUDE_AGENT_SDK_VERSION;
    if (process.platform !== 'win32') delete env.NoDefaultCurrentDirectoryInExePath;
    const key = createHash('sha256')
      .update(JSON.stringify([runner, executable, options.shell, Object.entries(env).sort()])).digest('hex');
    const previous = entries.get(key);
    if (previous && previous.expires > Date.now() && previous.value.path &&
      previous.identity === nativeExecutableIdentity(previous.value.path)) return previous.value;
    entries.delete(key);
    let request = pending.get(key);
    if (!request) {
      request = detect(runner, executable, { ...options, env }).then(value => {
        const identity = value.path && nativeExecutableIdentity(value.path);
        if (identity && value.version && value.shellPath) {
          if (entries.size >= 16) entries.delete(entries.keys().next().value!);
          entries.set(key, { value, identity, expires: Date.now() + 60_000 });
        }
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    return request;
  };
}

/** Probes the protocol in an empty home. No model input or host business scope is prepared. */
async function inspectCodex(executable: string, shellPath: string | undefined, version: string, base: Record<string, string>) {
  const stat = statSync(executable);
  const key = JSON.stringify([executable, stat.dev, stat.ino, stat.mtimeMs, stat.size, version, shellPath]);
  let probing = protocolProbes.get(key);
  if (!probing) {
    if (protocolProbes.size >= 32) protocolProbes.clear();
    probing = probeCodex(executable, shellPath, base).catch(() => new Set<CapabilityName>(['basic']));
    protocolProbes.set(key, probing);
    void probing.then(missing => { if (missing.has('basic') && protocolProbes.get(key) === probing) protocolProbes.delete(key); });
  }
  return probing;
}

async function probeCodex(executable: string, shellPath: string | undefined, base: Record<string, string>) {
  const home = realpathSync(await mkdtemp(join(tmpdir(), 'willyou-codex-probe-')));
  const env: NodeJS.ProcessEnv = { PATH: shellPath ?? base.PATH, SystemRoot: base.SystemRoot, WINDIR: base.WINDIR,
    HOME: home, USERPROFILE: home, CODEX_HOME: home };
  const missing = new Set<CapabilityName>();
  const child = spawn(executable, ['app-server'], { cwd: home, env, stdio: ['pipe', 'pipe', 'ignore'] });
  let exited = false;
  const closed = new Promise<void>(resolve => child.once('close', () => { exited = true; resolve(); }));
  const peer = new JsonlRpcPeer(child.stdout, child.stdin, { request() {}, notification() {} }, 2500);
  child.once('error', error => peer.close(error));
  child.once('exit', () => peer.close(new Error('Probe process exited')));
  child.stdin.on('error', error => peer.close(error));
  const missingMethod = (error: unknown) => error instanceof DriverError && error.nativeCode === -32601;
  try {
    try { await peer.call('initialize', { clientInfo: { name: 'willyou-probe', version: '1' }, capabilities: { experimentalApi: true } }); }
    catch { missing.add('basic'); missing.add('mcp'); return missing; }
    peer.notify('initialized');
    await Promise.all([
      peer.call<{ data?: unknown }>('mcpServerStatus/list', {})
        .then(result => { if (!Array.isArray(result?.data)) missing.add('mcp'); }, () => missing.add('mcp')),
      // The probe home has no saved sessions. A recognized method rejects the absent UUID without changing user state.
      peer.call('thread/resume', { threadId: randomUUID(), excludeTurns: true }).catch(error => { if (missingMethod(error)) missing.add('resume'); }),
      peer.call('turn/steer', { threadId: randomUUID(), expectedTurnId: randomUUID(), input: [] })
        .then(() => missing.add('steer'), error => { if (!(error instanceof DriverError) || error.nativeCode !== -32600) missing.add('steer'); }),
      peer.call<{ data?: unknown }>('skills/list', { cwds: [home] })
        .then(result => { if (!Array.isArray(result?.data)) missing.add('skills'); }, () => missing.add('skills')),
      // Test the nondefault reviewer on a disposable read-only thread without issuing a turn.
      peer.call<{ approvalsReviewer?: unknown }>('thread/start', { cwd: home, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' })
        .then(result => { if (result?.approvalsReviewer !== 'auto_review') missing.add('approvalsReviewer'); }, () => missing.add('approvalsReviewer')),
    ]);
    return missing;
  } finally {
    child.stdin.end();
    const terminate = setTimeout(() => { if (!exited) child.kill('SIGTERM'); }, 250);
    const force = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 900);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([closed, new Promise<void>(resolve => { timeout = setTimeout(resolve, 1500); })]);
    clearTimeout(terminate); clearTimeout(force); clearTimeout(timeout);
    if (exited) await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

export async function probeDriver(driverId: DriverId, o: ProbeOptions): Promise<DriverProbe> {
  const info = await (o.detect ?? detectNativeCli)(RUNNER[driverId], o.executable ?? null, o);
  if (!info.path) {
    const caps = evaluateCapabilities(driverId, null, () => false);
    return { ...caps, state: 'unsupported', reason: info.error ?? '找不到执行器', binaryPath: null, realpath: null, shellPath: info.shellPath, shellProxy: info.shellProxy, missing: { searched: info.command, hint: INSTALL_HINT[driverId] } };
  }
  let real: string | null = null;
  try {
    real = realpathSync(info.path);
    if (!statSync(real).isFile()) throw new Error('不是文件');
    accessSync(real, constants.X_OK);
  } catch (e) {
    const caps = evaluateCapabilities(driverId, null, () => false);
    return { ...caps, state: 'unsupported', reason: `执行器不可用：${(e as Error).message}`, binaryPath: info.path, realpath: real, shellPath: info.shellPath, shellProxy: info.shellProxy };
  }
  let caps = evaluateCapabilities(driverId, info.version, o.probe);
  const identity = nativeExecutableIdentity(real);
  if (driverId === 'antigravity-acp') {
    const home = await mkdtemp(join(tmpdir(), 'willyou-agy-probe-'));
    try {
      const capabilities = await inspectAntigravity(real, home, {
        PATH: info.shellPath ?? o.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: home,
        XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home,
        SystemRoot: o.env.SystemRoot, WINDIR: o.env.WINDIR,
      });
      caps = evaluateCapabilities(driverId, info.version, name =>
        capabilities[name === 'skills' ? 'basic' : name as keyof typeof capabilities] === true && o.probe?.(name) !== false);
    } catch (error) {
      let reason = 'Antigravity 启动失败或握手前退出';
      if (error instanceof DriverError) {
        if (error.code === 'TIMEOUT') reason = 'Antigravity ACP 握手超时';
        else if (error.code === 'PROTOCOL' || error.nativeCode !== undefined) reason = 'Antigravity ACP 协议不兼容';
        else if (error.code === 'UNSUPPORTED') reason = error.message;
      }
      caps = { ...evaluateCapabilities(driverId, info.version, () => false), reason };
    } finally {
      await rm(home, { recursive: true, force: true });
    }
    caps.version ??= info.version?.slice(0, 120) || 'unknown';
  }
  const checkedCli = identity && caps.version && info.shellPath
    ? { runner: RUNNER[driverId], path: real, version: caps.version, shellPath: info.shellPath, shellProxy: info.shellProxy, identity }
    : undefined;
  if (o.inspectCodexProtocol && driverId === 'codex-app-server' && caps.state !== 'unsupported' && caps.version) {
    const missing = await inspectCodex(real, info.shellPath ?? o.env.PATH, caps.version, o.env).catch(() => new Set<CapabilityName>(['mcp']));
    caps = evaluateCapabilities(driverId, info.version, name => !missing.has(name) && o.probe?.(name) !== false);
  }
  return { ...caps, binaryPath: info.path, realpath: real, shellPath: info.shellPath, shellProxy: info.shellProxy, checkedCli };
}

/** 探测并留档；每次结果都记录，旧记录不覆盖。 */
export async function probeAndRecord(store: AgentStore, driverId: DriverId, o: ProbeOptions): Promise<DriverProbe> {
  const r = await probeDriver(driverId, o);
  store.recordProbe({ driverId, binaryPath: r.binaryPath ?? (o.executable ?? ''), realpath: r.realpath, version: r.version, capabilities: r.capabilities, state: r.missing ? 'missing' : r.state, reason: r.reason ?? null });
  return r;
}
