import Database from 'better-sqlite3';
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { createNativeCliDetector, probeAndRecord, probeDriver } from './discovery';
import type { detectNativeCli } from '../ai/runner-detect';

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
  it('shares recent shell discovery and probes again after changes to the executable or environment', async () => {
    const { link, real } = fakeBin('claude');
    const probe = vi.fn<typeof detectNativeCli>().mockImplementation(async (runner, command) => ({
      runner, command: command ?? 'claude', path: link, version: '2.1.329', error: null,
      shellPath: '/usr/bin:/bin', shellProxy: {},
    }));
    const cached = createNativeCliDetector(probe);
    const run = (env = {}) => probeDriver('claude-sdk', { env, detect: cached, executable: link });
    await Promise.all([run(), run()]);
    expect((await run()).realpath).toBe(real);
    expect(probe).toHaveBeenCalledTimes(1);
    if (process.platform !== 'win32') {
      await run({ CLAUDE_AGENT_SDK_VERSION: '0.3.321', NoDefaultCurrentDirectoryInExePath: '1' });
      expect(probe).toHaveBeenCalledTimes(1);
    }
    writeFileSync(real, '#!/bin/sh\necho changed\n');
    expect((await run()).state).toBe('ready');
    await run({ PATH: '/first:/bin' });
    expect(probe).toHaveBeenCalledTimes(3);
  });
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
  it.each([
    ['exit 23', '启动失败'],
    ['while IFS= read -r line; do :; done', '握手超时'],
    [String.raw`IFS= read -r line; printf '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":77}}\n'`, '协议不兼容'],
    [String.raw`IFS= read -r line; printf '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"authMethods":[{"id":"gemini-api-key"}]}}\n'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"unsupported"}}\n' "$id"
done`, '缺少新建会话能力'],
  ])('explains why an Antigravity executable cannot provide a core session (%s)', async (body, reason) => {
    const { link, real } = fakeBin('agy');
    writeFileSync(real, `#!/bin/sh\n${body}\n`);
    const response = await probeDriver('antigravity-acp', {
      env: { PATH: '/usr/bin:/bin' }, executable: link, detect: detect(link, '1.9.0') as never,
    });
    expect(response.state).toBe('unsupported');
    expect(response.reason).toContain(reason);
  }, 10_000);
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

  it.each([
    { missingOptional: true, version: '0.169.0', mcp: '"error":{"code":-32601,"message":"missing"}', hasMcp: false },
    { missingOptional: false, version: '0.171.0', mcp: '"result":{"data":[]}', hasMcp: true },
    { missingOptional: false, version: '0.172.0', mcp: '"result":{"unexpected":[]}', hasMcp: false },
    { missingOptional: false, version: '0.173.0', mcp: '"error":{"code":-32603,"message":"failed"}', hasMcp: false },
  ])('A55 negotiates MCP independently on Codex $version ($mcp)', async ({ missingOptional, version, mcp, hasMcp }) => {
    const { link, real } = fakeBin('codex');
    writeFileSync(real, String.raw`#!/bin/sh
[ "$1" = 'app-server' ] && [ "$HOME" = "$CODEX_HOME" ] && [ "$HOME" = "$PWD" ] && [ -z "$OPENAI_API_KEY" ] || exit 41
# 本地协议探针不应启动插件/市场同步或 hook；该临时会话只验证 RPC 方法。
shift
[ "$#" -eq 6 ] && [ "$1" = '-c' ] && [ "$2" = 'features.hooks=false' ] && [ "$3" = '-c' ] && [ "$4" = 'features.plugins=false' ] && [ "$5" = '-c' ] && [ "$6" = 'features.remote_plugin=false' ] || exit 42
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":%s,"result":{"userAgent":"fixture"}}\n' "$id" ;;
    *'"method":"mcpServerStatus/list"'*) printf '{"id":%s,%s}\n' "$id" '${mcp}' ;;
    *'"method":"thread/resume"'*) printf '{"id":%s,"error":{"code":${missingOptional ? -32601 : -32600},"message":"no session"}}\n' "$id" ;;
    *'"method":"turn/steer"'*) printf '{"id":%s,"error":{"code":${missingOptional ? -32601 : -32600},"message":"no session"}}\n' "$id" ;;
    *'"method":"skills/list"'*) ${missingOptional ? String.raw`printf '{"id":%s,"error":{"code":-32601,"message":"missing"}}\n' "$id"` : String.raw`printf '{"id":%s,"result":{"data":[]}}\n' "$id"`} ;;
    *'"method":"thread/start"'*) printf '{"id":%s,"result":{"thread":{"id":"probe-thread"}${missingOptional ? '' : ',"approvalsReviewer":"auto_review"'}}}\n' "$id" ;;
  esac
done
`);
    const r = await probeDriver('codex-app-server', {
      env: { OPENAI_API_KEY: 'synthetic-not-inherited' }, detect: detect(link, version) as never, inspectCodexProtocol: true,
    });
    expect(r.state).toBe(hasMcp ? 'ready' : 'limited');
    expect(r.capabilities.basic.state).toBe('enabled');
    expect(r.capabilities.mcp).toMatchObject(hasMcp ? { state: 'enabled' } : { state: 'disabled', reason: 'probe-unavailable' });
    for (const key of ['resume', 'steer', 'skills', 'approvalsReviewer'] as const) {
      expect(r.capabilities[key].state).toBe(missingOptional ? 'disabled' : 'enabled');
    }
  });
});
