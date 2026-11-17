import Database from 'better-sqlite3';
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { probeAndRecord, probeDriver } from './discovery';

// M14-A62 本机程序发现与缺失、A51 本机 CLI、A54 用户显式路径（阶段 1：U／I 层，不含打包）。
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function fakeBin(name: string, mode = 0o755) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'm14-bin-'))); dirs.push(d);
  const real = join(d, `${name}-real`); writeFileSync(real, '#!/bin/sh\necho 1\n'); chmodSync(real, mode);
  const link = join(d, name); symlinkSync(real, link);
  return { link, real };
}
const detect = (path: string | null, version: string | null, error: string | null = null) => async (runner: string, executable: string | null) =>
  ({ runner, command: executable ?? runner, path, version, error, shellPath: '/usr/bin:/bin' });

describe('本机程序发现', () => {
  it('解析 realpath、核对可执行位并按版本求能力', async () => {
    const { link, real } = fakeBin('codex');
    const r = await probeDriver('codex-app-server', { env: {}, detect: detect(link, 'codex-cli 0.169.0') as never });
    expect(r).toMatchObject({ state: 'ready', version: '0.169.0', binaryPath: link, realpath: real, shellPath: '/usr/bin:/bin' });
  });
  it('找不到 CLI：给出检测命令与安装指引，不下载', async () => {
    const r = await probeDriver('claude-sdk', { env: {}, detect: detect(null, null, '找不到 claude，请确认已安装') as never });
    expect(r.state).toBe('unsupported');
    expect(r.missing).toEqual({ searched: 'claude', hint: expect.stringContaining('安装 Claude Code') });
  });
  it('用户显式路径不可执行时拒绝，不自动换程序', async () => {
    const { link } = fakeBin('claude', 0o644);
    const r = await probeDriver('claude-sdk', { env: {}, executable: link, detect: detect(link, '2.1.326') as never });
    expect(r.state).toBe('unsupported');
    expect(r.reason).toContain('执行器不可用');
  });
  it('低于最低版本拒绝并说明；每次探测留档', async () => {
    const { link } = fakeBin('claude');
    const db = new Database(':memory:'); runBundledMigrations(db);
    const store = new AgentStore(db);
    const r = await probeAndRecord(store, 'claude-sdk', { env: {}, detect: detect(link, '2.1.200 (Claude Code)') as never });
    expect(r.reason).toContain('低于最低已验证版本');
    await probeAndRecord(store, 'claude-sdk', { env: {}, detect: detect(null, null, '找不到') as never });
    expect(db.prepare('SELECT driver_id,state,version FROM agent_driver_probes ORDER BY probed_at,rowid').all()).toEqual([
      { driver_id: 'claude-sdk', state: 'unsupported', version: '2.1.200' },
      { driver_id: 'claude-sdk', state: 'missing', version: null },
    ]);
    db.close();
  });
});
