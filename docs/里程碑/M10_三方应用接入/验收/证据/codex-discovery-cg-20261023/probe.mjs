import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const isMain = resolve(process.argv[1]) === self;
if (isMain && process.argv[2] === '--fixture-mcp') {
  const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  createInterface({ input: process.stdin }).on('line', (line) => {
    const req = JSON.parse(line); if (req.id === undefined) return;
    if (req.method === 'initialize') return send(req.id, { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'm10-fixture', version: '1.0.0' } });
    if (req.method === 'tools/list') return send(req.id, { tools: [{ name: 'fixture_marker', description: 'Return synthetic project and immutable package version marker only. No real data.', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
    if (req.method === 'tools/call') return send(req.id, { content: [{ type: 'text', text: JSON.stringify({ project: process.env.M10_FIXTURE_PROJECT, version: process.env.M10_FIXTURE_VERSION, marker: `M10_TOOL_${process.env.M10_FIXTURE_VERSION}` }) }] });
    send(req.id, {});
  });
}

async function main() {
  const output = resolve(process.argv[2] || 'docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/codex/result.json');
  const root = mkdtempSync('/private/tmp/m10-codex-preflight-');
  const cwdA = join(root, 'project-a'), cwdB = join(root, 'project-b');
  const home = join(root, 'home'), codexHome = join(root, 'codex');
  for (const p of [home, codexHome, join(cwdA, '.git'), join(cwdB, '.git')]) mkdirSync(p, { recursive: true });
  const paths = {};
  for (const v of ['v1', 'v2', 'user']) {
    const dir = join(home, '.agents/skills', v === 'user' ? 'user-owned-fixture' : `willyou-fixture-${v}`);
    mkdirSync(dir, { recursive: true }); paths[v] = join(dir, 'SKILL.md');
    writeFileSync(paths[v], `---\nname: ${v === 'user' ? 'user-owned-fixture' : `willyou-fixture-${v}`}\ndescription: Harmless M10 capability version fixture ${v}.\n---\n\nThe exact skill body marker is M10_SKILL_BODY_${v}. Read this file and call fixture_marker once. Report both markers.\n`);
  }
  const report = {
    schema: 'm10-codex-runtime-preflight-v1', startedAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version, cliVersion: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim() },
    isolation: { temporaryHome: true, temporaryCodexHome: true, userGlobalFilesModified: false, realAccount: false, realModel: false, syntheticMcpOnly: true },
    cases: [], limitations: [
      'Uses isolated HOME and CODEX_HOME; does not prove production global-root/profile merging or packaged WillYou behavior.',
      'Direct app-server tool call is real Codex MCP execution, not model selection/read evidence.',
      'Synthetic immutable versions and projects only; no actual mail, ZenTao, credentials, or business writes.',
      'Native resume without model turn is attempted separately and reported truthfully.',
    ],
  };
  const clients = [];
  async function launch(label, selected, pathKind, cwd = cwdA) {
    const config = ['v1', 'v2'].map((v) => `{path=${JSON.stringify(pathKind === 'file' ? paths[v] : dirname(paths[v]))},enabled=${v === selected}}`).join(',');
    const args = [
      '-c', `skills.config=[${config}]`, '-c', 'model_provider="m10_offline_fixture"', '-c', 'model="m10-no-model"',
      '-c', 'model_providers.m10_offline_fixture={name="M10 Offline Fixture",base_url="http://127.0.0.1:1/v1",wire_api="responses",requires_openai_auth=false}',
      '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false',
      '-c', `mcp_servers.m10_fixture={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(self)},"--fixture-mcp"],env={M10_FIXTURE_PROJECT=${JSON.stringify(cwd === cwdA ? 'project-a' : 'project-b')},M10_FIXTURE_VERSION=${JSON.stringify(selected)}}}`,
      'app-server', '--stdio',
    ];
    const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost' };
    const c = new Client(label, args, cwd, env); clients.push(c);
    await c.rpc('initialize', { clientInfo: { name: 'm10_preflight', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    c.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return c;
  }
  async function examine(c, cwd, label, expected) {
    const res = await c.rpc('skills/list', { cwds: [cwd], forceReload: true });
    const relevant = res.data.flatMap((e) => e.skills).filter((s) => /willyou-fixture|user-owned-fixture/.test(s.name));
    const skills = relevant.map(({ name, enabled, path, scope }) => ({ name, enabled, path: path.replace(root, '<fixture>'), scope }));
    const states = Object.fromEntries(skills.map((s) => [s.name, s.enabled]));
    const passed = states['willyou-fixture-v1'] === (expected === 'v1') && states['willyou-fixture-v2'] === (expected === 'v2') && states['user-owned-fixture'] === true;
    report.cases.push({ name: label, status: passed ? 'passed' : 'failed', level: 'discovered-enabled-state', expected, skills, errors: res.data.flatMap((e) => e.errors ?? []) });
    return passed;
  }
  try {
    // Warm the native state DB once before launching a second concurrently-live process.
    // A simultaneous brand-new CODEX_HOME initialization is retained as a separate failed attempt.
    const fileV1 = await launch('file-v1', 'v1', 'file');
    const fileV2 = await launch('file-v2', 'v2', 'file');
    await examine(fileV1, cwdA, 'file-path-v1-concurrent', 'v1');
    await examine(fileV2, cwdA, 'file-path-v2-concurrent', 'v2');
    const dirV1 = await launch('directory-v1', 'v1', 'directory');
    await examine(dirV1, cwdA, 'directory-path-v1', 'v1');
    const projectB = await launch('project-b-none', 'none', 'file', cwdB);
    await examine(projectB, cwdB, 'project-b-no-application', 'none');
    for (const [c, version] of [[fileV1, 'v1'], [fileV2, 'v2']]) {
      const started = await c.rpc('thread/start', { cwd: cwdA, ephemeral: false, sandbox: 'read-only', approvalPolicy: 'never' });
      const id = started.thread.id;
      const result = await c.rpc('mcpServer/tool/call', { threadId: id, server: 'm10_fixture', tool: 'fixture_marker', arguments: {} });
      const value = JSON.parse(result.content.find((b) => b.type === 'text').text);
      report.cases.push({ name: `native-thread-start-and-direct-mcp-${version}`, status: value.version === version && value.project === 'project-a' ? 'passed' : 'failed', level: 'direct-tool-called-no-model', threadId: id, ephemeral: started.thread.ephemeral, value });
      if (version === 'v1') report.resumeThreadId = id;
    }
    await fileV1.close();
    const resume = await launch('resume-v1', 'v1', 'file');
    try {
      const res = await resume.rpc('thread/resume', { threadId: report.resumeThreadId, cwd: cwdA, sandbox: 'read-only', approvalPolicy: 'never' });
      const result = await resume.rpc('mcpServer/tool/call', { threadId: res.thread.id, server: 'm10_fixture', tool: 'fixture_marker', arguments: {} });
      const value = JSON.parse(result.content.find((b) => b.type === 'text').text);
      report.cases.push({ name: 'native-resume-fixed-v1-after-process-restart', status: res.thread.id === report.resumeThreadId && value.version === 'v1' ? 'passed' : 'failed', level: 'native-resume-and-direct-tool-no-model', threadId: res.thread.id, value });
      await examine(resume, cwdA, 'resumed-process-v1-discovery', 'v1');
    } catch (e) { report.cases.push({ name: 'native-resume-fixed-v1-after-process-restart', status: 'blocked', reason: String(e.message) }); }
    report.status = report.cases.some((c) => c.status === 'failed') ? 'has-failures' : report.cases.some((c) => c.status === 'blocked') ? 'partial' : 'passed-with-boundaries';
  } catch (e) { report.status = 'failed'; report.error = e.message; }
  finally {
    await Promise.all(clients.map((c) => c.close()));
    report.clients = clients.map((c) => ({ name: c.label, methods: c.methods, unexpectedRequests: c.unexpectedRequests, notifications: [...new Set(c.notifications)], stderrTail: c.stderr.slice(-1000).replaceAll(root, '<fixture>') }));
    report.sourceHash = createHash('sha256').update(readFileSync(self)).digest('hex');
    rmSync(root, { recursive: true, force: true });
    report.cleanup = { allChildrenExited: clients.every((c) => c.child.exitCode !== null || c.child.signalCode !== null), fixtureRemoved: !existsSync(root) };
    report.finishedAt = new Date().toISOString(); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(({ name, status }) => ({ name, status })), output }));
  }
}

export class Client {
  constructor(label, args, cwd, env) {
    this.label = label; this.id = 0; this.pending = new Map(); this.methods = []; this.notifications = []; this.unexpectedRequests = []; this.stderr = '';
    this.child = spawn('codex', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exit = new Promise((r) => this.child.once('exit', r));
    this.child.stderr.on('data', (d) => this.stderr += d);
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => {
      let x; try { x = JSON.parse(line); } catch { return; }
      this.onMessage?.(x);
      if (x.method) {
        this.notifications.push(x.method);
        if (x.id !== undefined) { this.unexpectedRequests.push(x.method); this.child.stdin.write(JSON.stringify({ id: x.id, error: { code: -32601, message: 'Probe rejects unexpected interactive request' } }) + '\n'); }
        return;
      }
      const p = this.pending.get(x.id); if (!p) return;
      this.pending.delete(x.id); clearTimeout(p.timer); x.error ? p.reject(new Error(JSON.stringify(x.error))) : p.resolve(x.result);
    });
  }
  rpc(method, params) {
    this.methods.push(method); const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.label} ${method} timeout`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async close() {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('closed')); } this.pending.clear();
    this.lines.close();
    if (this.child.exitCode === null && this.child.signalCode === null) { this.child.kill('SIGTERM'); const t = setTimeout(() => this.child.kill('SIGKILL'), 2000); await this.exit; clearTimeout(t); }
  }
}

if (isMain && process.argv[2] !== '--fixture-mcp') await main();
