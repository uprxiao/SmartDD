import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Client } from '../codex/probe.mjs';

const self = fileURLToPath(import.meta.url);
if (process.argv[2] === '--mcp') {
  createInterface({ input: process.stdin }).on('line', (line) => {
    let x; try { x = JSON.parse(line); } catch { return; } if (x.id === undefined) return;
    const tool = process.argv[3]; let result = {};
    if (x.method === 'initialize') result = { protocolVersion: x.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: tool, version: '1.0.0' } };
    if (x.method === 'tools/list') result = { tools: [{ name: tool, description: 'Synthetic read-only marker. No business data.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }] };
    if (x.method === 'tools/call') result = { content: [{ type: 'text', text: 'SYNTHETIC_ONLY' }] };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: x.id, result }) + '\n');
  });
} else await main();

async function main() {
  const root = mkdtempSync('/private/tmp/m10-mixed-discovery-'), home = join(root, 'home');
  const codexHome = join(home, '.codex'), claudeHome = join(home, '.claude');
  const cwdA = join(root, 'project-a'), cwdB = join(root, 'project-b');
  const output = resolve(process.argv[2] || join(dirname(self), 'result.json'));
  for (const p of [home, codexHome, claudeHome, join(cwdA, '.git'), join(cwdB, '.git')]) mkdirSync(p, { recursive: true });
  const skill = (base, name, body) => {
    const path = join(base, name, 'SKILL.md'); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `---\nname: ${name}\ndescription: ${body}\n---\n\nSynthetic discovery marker only. Never call any tool.\n`); return path;
  };
  const versions = {};
  for (const v of ['v1', 'v2']) versions[v] = skill(join(home, '.agents/skills'), `willyou-codex-${v}`, `Managed Codex fixture ${v}.`);
  skill(join(home, '.agents/skills'), 'user-shared-fixture', 'User-owned shared-root fixture.');
  skill(join(claudeHome, 'skills'), 'user-cc-fixture', 'User-owned native Claude skill.');
  const plugins = {};
  for (const v of ['v1', 'v2']) {
    const p = join(root, 'packages', v, 'plugin'); mkdirSync(join(p, '.claude-plugin'), { recursive: true });
    writeFileSync(join(p, '.claude-plugin/plugin.json'), JSON.stringify({ name: `willyou-cc-${v}`, version: v === 'v1' ? '1.0.0' : '1.1.0', description: 'Synthetic session app' }));
    skill(join(p, 'skills'), `app-${v}`, `Managed Claude fixture ${v}.`); plugins[v] = p;
  }
  const mcp = (tool) => ({ command: process.execPath, args: [self, '--mcp', tool] });
  const userClaudeConfig = join(claudeHome, '.claude.json');
  writeFileSync(userClaudeConfig, JSON.stringify({ mcpServers: { user_cc_mcp: mcp('user_cc_marker') }, hasCompletedOnboarding: true }));
  const userClaudeSettings = join(claudeHome, 'settings.json');
  writeFileSync(userClaudeSettings, JSON.stringify({ permissions: { allow: ['mcp__user_cc_mcp__user_cc_marker'] }, disableAllHooks: true }));
  const userCodexConfig = join(codexHome, 'config.toml');
  writeFileSync(userCodexConfig, `[mcp_servers.user_codex_mcp]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([self, '--mcp', 'user_codex_marker'])}\n`);
  const ccManagedConfig = join(root, 'cc-managed-mcp.json');
  writeFileSync(ccManagedConfig, JSON.stringify({ mcpServers: { managed_cc_mcp: mcp('managed_cc_marker') } }));
  const originalUserConfig = JSON.parse(readFileSync(userClaudeConfig, 'utf8'));
  const configHashesBefore = Object.fromEntries([userClaudeSettings, userCodexConfig].map((p) => [p, hash(p)]));
  const env = {
    PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome,
    ANTHROPIC_API_KEY: 'm10-local-fake-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_MAX_RETRIES: '0', API_TIMEOUT_MS: '2000',
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost',
  };
  const report = { schema: 'm10-mixed-discovery-preflight-v1', startedAt: new Date().toISOString(), environment: { platform: process.platform, arch: process.arch, node: process.version, codex: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(), claude: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim() }, isolation: { sharedSyntheticHome: true, separateNativeSubdirectories: true, realAuthRead: false, realModel: false, modelEndpoint: 'http://127.0.0.1:1', settingsSourcesOverride: false, strictMcpConfig: false, bareMode: false, safeMode: false, originalUserRootsModified: false }, cases: [] };
  const codexClients = [], ccClients = [];
  async function launchCodex(label, cwd, selected) {
    const config = Object.entries(versions).map(([v, path]) => `{path=${JSON.stringify(path)},enabled=${v === selected}}`).join(',');
    const args = ['-c', `skills.config=[${config}]`, '-c', 'model_provider="m10_offline"', '-c', 'model="no-model"', '-c', 'model_providers.m10_offline={name="M10",base_url="http://127.0.0.1:1/v1",wire_api="responses",requires_openai_auth=false}', '--disable', 'apps', '--disable', 'remote_plugin', '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false', ...(selected ? ['-c', `mcp_servers.managed_codex_mcp={command=${JSON.stringify(process.execPath)},args=${JSON.stringify([self, '--mcp', 'managed_codex_marker'])}}`] : []), 'app-server', '--stdio'];
    const c = new Client(label, args, cwd, env); codexClients.push(c);
    await c.rpc('initialize', { clientInfo: { name: 'm10_mixed_discovery', version: '1' }, capabilities: { experimentalApi: true } });
    c.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const found = await c.rpc('skills/list', { cwds: [cwd], forceReload: true });
    const skills = found.data.flatMap((e) => e.skills).filter((s) => /fixture|willyou-/.test(s.name)).map(({ name, enabled, path }) => ({ name, enabled, path: path.replace(root, '<fixture>') }));
    const status = await c.rpc('mcpServerStatus/list', {});
    report.cases.push({ name: label, level: 'native-discovery', skills, mcp: status }); return c;
  }
  async function launchClaude(label, cwd, selected) {
    const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--permission-mode', 'dontAsk', '--max-turns', '1', '--settings', JSON.stringify({ disableAllHooks: true })];
    if (selected) args.push('--plugin-dir', plugins[selected], '--mcp-config', ccManagedConfig);
    const c = { label, events: [], stderr: '' };
    c.child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); ccClients.push(c);
    c.exit = new Promise((r) => c.child.once('exit', r));
    c.child.stderr.on('data', (d) => c.stderr += d);
    const pending = new Map();
    c.lines = createInterface({ input: c.child.stdout });
    c.lines.on('line', (line) => { try { const x = JSON.parse(line); c.events.push(x); if (x.type === 'control_response') { const id = x.response?.request_id ?? x.request_id; const done = pending.get(id); if (done) { pending.delete(id); done(x); } } } catch {} });
    const control = async (id, subtype) => {
      let done; const answer = new Promise((r) => done = r); pending.set(id, done);
      c.child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request: { subtype } }) + '\n');
      let timer; const result = await Promise.race([answer, new Promise((r) => timer = setTimeout(() => r(null), 12000))]); clearTimeout(timer); return result;
    };
    const init = await control('probe-init', 'initialize');
    let mcp; const mcpChecks = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      mcp = await control(`probe-mcp-${attempt}`, 'mcp_status');
      const servers = mcp?.response?.response?.mcpServers ?? [];
      mcpChecks.push(servers.map(({ name, status }) => ({ name, status })));
      if (servers.length && servers.every((s) => s.status !== 'pending')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const payload = init?.response?.response;
    const commands = payload?.commands ?? [];
    const caseResult = { name: label, level: 'native-control-initialize', initializeSucceeded: init?.response?.subtype === 'success', allCommandNames: commands.map((x) => x.name), fixtureCommands: commands.filter((x) => /fixture|willyou-/.test(x.name)), sessionState: payload?.session_state, authSource: payload?.account?.apiKeySource, mcpChecks, mcpServers: (mcp?.response?.response?.mcpServers ?? []).map(({ name, status, scope, source, tools }) => ({ name, status, scope, source, tools })), stderr: c.stderr.replaceAll(root, '<fixture>'), processAlive: c.child.exitCode === null && c.child.signalCode === null };
    report.cases.push(caseResult); return c;
  }
  try {
    await launchCodex('codex-project-a-v1', cwdA, 'v1');
    await launchClaude('claude-project-a-v2', cwdA, 'v2');
    await launchCodex('codex-project-b-disabled', cwdB, null);
    await launchClaude('claude-project-b-no-plugin', cwdB, null);
    report.simultaneousProcessState = [...codexClients.map((c) => ({ name: c.label, alive: c.child.exitCode === null && c.child.signalCode === null })), ...ccClients.map((c) => ({ name: c.label, alive: c.child.exitCode === null && c.child.signalCode === null }))];
    report.userConfigPreservation = { codexConfigUnchanged: hash(userCodexConfig) === configHashesBefore[userCodexConfig], claudeSettingsUnchanged: hash(userClaudeSettings) === configHashesBefore[userClaudeSettings], claudeUserMcpDefinitionUnchanged: JSON.stringify(JSON.parse(readFileSync(userClaudeConfig)).mcpServers) === JSON.stringify(originalUserConfig.mcpServers) };
    const ca = report.cases.find((x) => x.name === 'codex-project-a-v1');
    const cb = report.cases.find((x) => x.name === 'codex-project-b-disabled');
    const aa = report.cases.find((x) => x.name === 'claude-project-a-v2');
    const ab = report.cases.find((x) => x.name === 'claude-project-b-no-plugin');
    const enabled = (c, n) => c.skills.find((x) => x.name === n)?.enabled;
    report.assertions = {
      allFourProcessesAlive: report.simultaneousProcessState.every((x) => x.alive),
      codexASelectedV1Only: enabled(ca, 'willyou-codex-v1') === true && enabled(ca, 'willyou-codex-v2') === false,
      codexBNoManagedSkills: ['v1', 'v2'].every((v) => enabled(cb, `willyou-codex-${v}`) === false),
      codexUserSkillPreserved: [ca, cb].every((c) => enabled(c, 'user-shared-fixture') === true),
      codexUserMcpPreserved: [ca, cb].every((c) => c.mcp.data.some((m) => m.name === 'user_codex_mcp' && m.tools.user_codex_marker)),
      codexBNoManagedMcp: cb.mcp.data.every((m) => m.name !== 'managed_codex_mcp'),
      claudeASelectedV2Only: aa.allCommandNames.includes('willyou-cc-v2:app-v2') && !aa.allCommandNames.includes('willyou-cc-v1:app-v1'),
      claudeBNoManagedSkills: !ab.allCommandNames.some((n) => n.startsWith('willyou-')),
      claudeUserSkillPreserved: [aa, ab].every((c) => c.allCommandNames.includes('user-cc-fixture')),
      claudeUserMcpPreserved: [aa, ab].every((c) => c.mcpServers.some((m) => m.name === 'user_cc_mcp')),
      claudeBNoManagedMcp: ab.mcpServers.every((m) => m.name !== 'managed_cc_mcp'),
      claudeSharedAgentsSkillsNotDiscovered: [aa, ab].every((c) => !c.allCommandNames.some((n) => n.startsWith('willyou-codex-') || n === 'user-shared-fixture')),
      userSettingsAndMcpDefinitionsPreserved: Object.values(report.userConfigPreservation).every(Boolean),
    };
    report.status = Object.values(report.assertions).every(Boolean) ? 'passed-with-boundaries' : 'has-failures';
  } catch (e) { report.status = 'failed'; report.error = e.message; }
  finally {
    await Promise.all(codexClients.map((c) => c.close()));
    for (const c of ccClients) {
      c.lines.close(); c.child.kill('SIGTERM'); const timer = setTimeout(() => c.child.kill('SIGKILL'), 2000); await c.exit; clearTimeout(timer);
      report.cases.find((e) => e.name === c.label).allEventTypes = c.events.map((e) => e.type);
    }
    report.stderr = [...codexClients, ...ccClients].map((c) => ({ name: c.label, stderr: c.stderr.slice(-1500).replaceAll(root, '<fixture>') }));
    report.sourceHashes = Object.fromEntries([self, join(dirname(self), '../codex/probe.mjs')].map((p) => [p === self ? 'probe.mjs' : '../codex/probe.mjs', hash(p)]));
    rmSync(root, { recursive: true, force: true });
    report.cleanup = { temporaryRootRemoved: !existsSync(root), allChildrenExited: [...codexClients, ...ccClients].every((c) => c.child.exitCode !== null || c.child.signalCode !== null) };
    report.finishedAt = new Date().toISOString(); mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2).replaceAll(root, '<fixture>') + '\n'); console.log(JSON.stringify({ status: report.status, output, cases: report.cases.map((c) => c.name) }));
  }
}

function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
