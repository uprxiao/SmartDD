// M14 本机程序发现（技术方案 T1.5 §7.1）：沿用 M13 登录 shell PATH 与用户显式路径；核对 realpath、可执行位、
// --version 与能力；缺 CLI 给出检测路径与安装指引，不下载安装器、不自动换程序。
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { detectNativeCli, type DetectOptions } from '../ai/runner-detect';
import { evaluateCapabilities, type CapabilityName, type DriverCapabilities, type DriverId } from './capabilities';
import type { AgentStore } from './agent-store';

const RUNNER: Record<DriverId, 'claude' | 'codex'> = { 'claude-sdk': 'claude', 'codex-app-server': 'codex' };
const INSTALL_HINT: Record<DriverId, string> = {
  'claude-sdk': '安装 Claude Code（https://docs.claude.com/claude-code）后重新检测，或在配置中指定 claude 的完整路径',
  'codex-app-server': '安装 Codex CLI（npm i -g @openai/codex）后重新检测，或在配置中指定 codex 的完整路径',
};

export interface DriverProbe extends DriverCapabilities {
  binaryPath: string | null;
  realpath: string | null;
  shellPath: string | null;
  missing?: { searched: string; hint: string };
}

export interface ProbeOptions extends DetectOptions {
  /** 用户显式路径；缺省按登录 shell PATH 查找默认命令。 */
  executable?: string | null;
  /** 协议探测：返回 false 表示该能力的原生方法不可用。 */
  probe?: (name: CapabilityName) => boolean;
  detect?: typeof detectNativeCli;
}

export async function probeDriver(driverId: DriverId, o: ProbeOptions): Promise<DriverProbe> {
  const info = await (o.detect ?? detectNativeCli)(RUNNER[driverId], o.executable ?? null, o);
  if (!info.path) {
    const caps = evaluateCapabilities(driverId, null);
    return { ...caps, state: 'unsupported', reason: info.error ?? '找不到执行器', binaryPath: null, realpath: null, shellPath: info.shellPath, missing: { searched: info.command, hint: INSTALL_HINT[driverId] } };
  }
  let real: string | null = null;
  try {
    real = realpathSync(info.path);
    if (!statSync(real).isFile()) throw new Error('不是文件');
    accessSync(real, constants.X_OK);
  } catch (e) {
    const caps = evaluateCapabilities(driverId, null);
    return { ...caps, state: 'unsupported', reason: `执行器不可用：${(e as Error).message}`, binaryPath: info.path, realpath: real, shellPath: info.shellPath };
  }
  const caps = evaluateCapabilities(driverId, info.version, o.probe);
  return { ...caps, binaryPath: info.path, realpath: real, shellPath: info.shellPath };
}

/** 探测并留档；每次结果都记录，旧记录不覆盖。 */
export async function probeAndRecord(store: AgentStore, driverId: DriverId, o: ProbeOptions): Promise<DriverProbe> {
  const r = await probeDriver(driverId, o);
  store.recordProbe({ driverId, binaryPath: r.binaryPath ?? (o.executable ?? ''), realpath: r.realpath, version: r.version, capabilities: r.capabilities, state: r.missing ? 'missing' : r.state, reason: r.reason ?? null });
  return r;
}
