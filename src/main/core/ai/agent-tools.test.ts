import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { planLaunchEnv, shellWrapped } from '../../launch-env';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { AgentService } from './agent-service';
import { AgentToolService, parseCliLogin, probeNativeCli, type CliProbeResult } from './agent-tools';

describe('CLI login output is parsed without exposing output/credential values', () => {
  const result = (stdout = '', stderr = '', code = 0): CliProbeResult => ({ stdout, stderr, code });
  it('recognizes verified Codex stderr subscription/API formats and unknown successful login safely', () => {
    expect(parseCliLogin('codex', result('', 'Logged in using ChatGPT'))).toEqual({ login: 'subscription', error: null });
    for (const text of ['API key configured - PUBLIC_TEST', 'Logged in using an API key - PUBLIC_TEST']) expect(parseCliLogin('codex', result('', text))).toEqual({ login: 'api', error: null });
    expect(parseCliLogin('codex', result('', 'Future login PUBLIC_TEST'))).toEqual({ login: 'local', error: null });
    expect(parseCliLogin('codex', result('', 'Not logged in', 1))).toEqual({ login: 'none', error: null });
  });
  it('recognizes verified Claude API methods but never invents a subscription method', () => {
    for (const authMethod of ['api_key', 'api_key_helper', 'oauth_token']) expect(parseCliLogin('claude', result(JSON.stringify({ loggedIn: true, authMethod, value: 'PUBLIC_TEST' })))).toEqual({ login: 'api', error: null });
    expect(parseCliLogin('claude', result('{"loggedIn":true,"authMethod":"future_subscription"}'))).toEqual({ login: 'local', error: null });
    expect(parseCliLogin('claude', result('{"loggedIn":false}'))).toEqual({ login: 'none', error: null });
    expect(parseCliLogin('claude', result(JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiKeySource: 'ANTHROPIC_API_KEY' })))).toEqual({ login:'api', error:null, loginSourceEnv:'ANTHROPIC_API_KEY' });
    for (const row of [
      {loggedIn:true,authMethod:'api_key',apiKeySource:'PUBLIC_SECRET_NOT_A_SOURCE'},
      {loggedIn:true,authMethod:'api_key_helper',apiKeySource:'ANTHROPIC_API_KEY'},
      {loggedIn:true,authMethod:'oauth_token',apiKeySource:'ANTHROPIC_API_KEY'},
      {loggedIn:false,authMethod:'api_key',apiKeySource:'ANTHROPIC_API_KEY'},
    ]) expect(parseCliLogin('claude',result(JSON.stringify(row)))).not.toHaveProperty('loginSourceEnv');
  });
  it('does not treat invalid JSON, timeout or an error as authenticated, and returns no raw output', () => {
    for (const value of [result('PUBLIC_TEST'), result('{}'), result('', 'PUBLIC_TEST', 7), { ...result(), timedOut: true }]) {
      const parsed = parseCliLogin('claude', value); expect(parsed.login).toBe('none'); expect(parsed.error).toBeTruthy(); expect(JSON.stringify(parsed)).not.toContain('PUBLIC_TEST');
    }
  });
});

describe('Tool discovery publishes data but never creates an agent automatically', () => {
  let sqlite: Database.Database, agents: AgentService;
  beforeEach(() => {
    sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite);
    const db = drizzle(sqlite, { schema });
    agents = new AgentService(db, new SecretsStore(db, { isAvailable: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString() }));
  });
  afterEach(() => sqlite.close());
  const discover = vi.fn(async (kind: string, path: string | null) => ({ runner: kind, command: kind, path: path ?? `/test/${kind}`, version: 'untrusted discovery output', error: null }));
  const probe = vi.fn(async (path: string, args: string[], _env: Record<string, string>): Promise<CliProbeResult> => args[0] === '--version' ? { code: 0, stdout: '9.9.9', stderr: '' } : path.includes('claude') ? { code: 0, stdout: '{"loggedIn":true,"authMethod":"api_key"}', stderr: '' } : { code: 0, stdout: '', stderr: 'Logged in using ChatGPT' });
  beforeEach(() => { discover.mockClear(); probe.mockClear(); });

  it('uses the same native-login environment for discovery/version/auth and does not clear shell credentials', async () => {
    const env = { PATH: '/test', ANTHROPIC_API_KEY: 'PUBLIC_TEST_ENV', CLAUDECODE: 'parent' };
    const auth = vi.fn(probe);
    const tools = new AgentToolService(agents, { env: () => env, discover, probe: auth, executable: async () => true });
    const results = await tools.refresh(); expect(results.map((row) => row.tool.login)).toEqual(['api', 'subscription']);
    expect(agents.configs()).toEqual([]);
    for (const call of auth.mock.calls) expect(call[2]).toEqual({ PATH: '/test', ANTHROPIC_API_KEY: 'PUBLIC_TEST_ENV' });
    expect(env.CLAUDECODE).toBe('parent'); expect(JSON.stringify(results)).not.toContain('PUBLIC_TEST_ENV');
  });

  it('does not accept discovery output alone as proof that the executable can launch', async () => {
    const failing = vi.fn(async (): Promise<CliProbeResult> => ({ code: 127, stdout: '', stderr: 'PUBLIC_TEST_FAILURE' }));
    const tools = new AgentToolService(agents, { env: () => ({}), discover, probe: failing, executable: async () => true });
    const results = await tools.refresh(); expect(results.every((row) => !row.tool.installed)).toBe(true);
    expect(failing.mock.calls).toHaveLength(2); expect(JSON.stringify(results)).not.toContain('PUBLIC_TEST_FAILURE');
  });

  it('retains the previous good path if a new custom selection is not executable', async () => {
    const tools = new AgentToolService(agents, { env: () => ({}), discover, probe, executable: async (path) => path !== '/bad' });
    await tools.refresh(); const before = agents.tools();
    expect(await tools.customPath('codex', '/bad')).toMatchObject({ error: '所选文件不可执行', tool: { installed: false } });
    expect(agents.tools()).toEqual(before);
    await tools.customPath('codex', '/custom/codex');
    const changed = agents.tools().find((row) => row.kind === 'codex')!;
    expect(changed).toMatchObject({ id: before.find((row) => row.kind === 'codex')!.id, customPath: '/custom/codex', installed: true });
    await tools.refresh(); expect(discover.mock.calls.some((call) => call[1] === '/custom/codex')).toBe(true);
    expect(agents.configs()).toEqual([]);
  });

  it('rejects unsupported kinds and relative/control-bearing custom paths', async () => {
    const tools = new AgentToolService(agents, { env: () => ({}), discover, probe, executable: async () => true });
    await expect(tools.customPath('unsupported', '/x')).rejects.toThrow();
    await expect(tools.customPath('codex', 'relative')).rejects.toThrow('绝对路径');
    await expect(tools.customPath('codex', '/path\nwrong')).rejects.toThrow('绝对路径');
    expect(agents.tools()).toEqual([]);
  });

  it('applies an explicitly selected custom path only to that tool identity among same-kind paths',async()=>{
    const tools=new AgentToolService(agents,{env:()=>({}),discover,probe,executable:async()=>true});
    await tools.refresh();const original=agents.tools().find(t=>t.kind==='codex')!;
    agents.recordTool({...original,id:'second-codex',customPath:'/second/codex',executable:'/second/codex'});
    await tools.customPath('codex','/replacement/codex','second-codex');
    expect(agents.tools().find(t=>t.id===original.id)).toEqual(original);
    expect(agents.tools().find(t=>t.id==='second-codex')).toMatchObject({customPath:'/replacement/codex',executable:'/replacement/codex'});
    await expect(tools.customPath('codex','/wrong','missing-id')).rejects.toThrow('删除');
  });
});

it('native auth probe and actual task shell see the same post-rc environment in an isolated fixture', async () => {
  vi.stubEnv('SHELL', '/bin/zsh');
  const root = await mkdtemp(join(tmpdir(), 'willyou-agent-auth-env-'));
  try {
    await writeFile(join(root, '.zshrc'), 'export ANTHROPIC_API_KEY=PUBLIC_FROM_TEST_RC\necho fixture-rc-noise\n');
    const executable = join(root, 'synthetic-cli');
    await writeFile(executable, '#!/bin/sh\nprintf \'{"loggedIn":true,"authMethod":"api_key","fixtureValue":"%s"}\\n\' "$ANTHROPIC_API_KEY"\n');
    await chmod(executable, 0o700);
    const env = { HOME: root, ZDOTDIR: root, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', ANTHROPIC_API_KEY: 'PUBLIC_BEFORE_RC' };
    const auth = await probeNativeCli(executable, ['auth', 'status'], env);
    expect(auth.code).toBe(0); expect(JSON.parse(auth.stdout).fixtureValue).toBe('PUBLIC_FROM_TEST_RC');
    const plan = planLaunchEnv(env, {}, []), launch = shellWrapped(executable, ['auth', 'status'], plan.scriptArgs, '/bin/zsh');
    const task = await promisify(execFile)(launch.file, launch.args, { env: plan.env, timeout: 5000 });
    const taskJson = task.stdout.split('\n').find((line) => line.startsWith('{'))!;
    expect(JSON.parse(taskJson).fixtureValue).toBe(JSON.parse(auth.stdout).fixtureValue);
  } finally { await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); }
});

it('T092 real environment-auth probe emits variable name only, no value or raw status', async()=>{
 vi.stubEnv('SHELL','/bin/zsh');
 const root=await mkdtemp(join(tmpdir(),'willyou-t092-env-source-'));
 const sqlite=new Database(':memory:');
 const PUBLIC='T092_PUBLIC_VALUE_MUST_NOT_ENTER_DTO';
 try{
  runBundledMigrations(sqlite);
  const db=drizzle(sqlite,{schema});
  const agents=new AgentService(db,new SecretsStore(db,{
   isAvailable:()=>false,encrypt:()=>{throw Error('No OS key write');},
   decrypt:()=>{throw Error('No key read');}
  }));
  await writeFile(join(root,'.zshrc'),'# isolated no-auth override\n');
  const executable=join(root,'claude');
  await writeFile(executable,`#!/bin/sh\ncase "$*" in\n --version) echo 'Claude Code 2.1.322';;\n 'auth status') printf '{"loggedIn":true,"authMethod":"api_key","apiKeySource":"ANTHROPIC_API_KEY","rawValue":"%s"}\\n' "$ANTHROPIC_API_KEY";;\n *) exit 95;;\nesac\n`);
  await chmod(executable,0o700);
  const env={HOME:root,ZDOTDIR:root,SHELL:'/bin/zsh',PATH:'/usr/bin:/bin',ANTHROPIC_API_KEY:PUBLIC};
  const tools=new AgentToolService(agents,{env:()=>env});
  const detected=await tools.customPath('claude',executable);
  expect(detected.tool.login).toBe('api');
  expect((detected.tool as any).loginSourceEnv).toBe('ANTHROPIC_API_KEY');
  const exposed=JSON.stringify({detected,tools:agents.tools()});
  expect(exposed).not.toContain(PUBLIC);
  expect(exposed).not.toContain('rawValue');
  expect(exposed).toContain('ANTHROPIC_API_KEY');
  expect(agents.configs()).toEqual([]);
  expect(sqlite.prepare('SELECT count(*) n FROM app_secrets').get()).toEqual({n:0});
  expect(new AgentService(db,new SecretsStore(db,{isAvailable:()=>false,encrypt:()=>{throw Error('no key');},decrypt:()=>{throw Error('no key');}})).tools()[0]).not.toHaveProperty('loginSourceEnv');
  // Shell rc can remove a parent variable; the actual CLI's post-rc report wins.
  await writeFile(join(root,'.zshrc'),'unset ANTHROPIC_API_KEY\n');
  await writeFile(executable,`#!/bin/sh\ncase "$*" in\n --version) echo 'Claude Code 2.1.322';;\n 'auth status') if [ -n "$ANTHROPIC_API_KEY" ]; then printf '{"loggedIn":true,"authMethod":"api_key","apiKeySource":"ANTHROPIC_API_KEY"}\\n'; else printf '{"loggedIn":true,"authMethod":"api_key_helper"}\\n'; fi;;\n *) exit 95;;\nesac\n`);
  expect((await tools.customPath('claude',executable)).tool.login).toBe('api');
  expect(agents.tools()[0]).not.toHaveProperty('loginSourceEnv');
  // A later missing executable must also clear an earlier successful source.
  await writeFile(join(root,'.zshrc'),'# restore parent env\n');
  expect((await tools.customPath('claude',executable)).tool.loginSourceEnv).toBe('ANTHROPIC_API_KEY');
  agents.recordTool({...agents.tools()[0],installed:false,login:'none'});
  expect(agents.tools()[0]).not.toHaveProperty('loginSourceEnv');
 }finally{sqlite.close();await rm(root,{recursive:true,force:true});vi.unstubAllEnvs();}
});
