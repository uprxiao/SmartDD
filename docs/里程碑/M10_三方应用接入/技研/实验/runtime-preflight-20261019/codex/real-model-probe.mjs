import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from './probe.mjs';

// Explicit research only: three bounded turns, synthetic Skill/MCP, no real mail or ZenTao.
// Never copy user configs/chats or write original auth. Temporary auth cannot refresh.
const self = fileURLToPath(import.meta.url), fixtureServer = join(dirname(self), 'probe.mjs');
const root = mkdtempSync('/private/tmp/m10-codex-real-model-');
const output = resolve(process.argv[2] || join(dirname(self), 'real-model-result.json'));
const home = join(root, 'home'), codexHome = join(root, 'codex'), cwd = join(root, 'project');
for (const p of [home, codexHome, join(cwd, '.git')]) mkdirSync(p, { recursive: true });
const clients = [], paths = {}, cases = [];
const report = { schema: 'm10-codex-real-model-preflight-v1', startedAt: new Date().toISOString(), environment: { platform: process.platform, arch: process.arch, node: process.version, cliVersion: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(), model: 'gpt-6.1-sol' }, isolation: { temporaryHome: true, temporaryCodexHome: true, userConfigCopied: false, userChatRead: false, originalAuthModified: false, temporaryAuthCopy: true, refreshTokenRemoved: true, syntheticOnly: true }, cases, limitations: ['Isolated user discovery root and native state; production global-root merge and packaged WillYou remain unverified.', 'This probe uses real model turns with synthetic inputs; it does not test business APIs or GUI terminal behavior.'] };
const authPath = '/Users/liubu/.codex/auth.json';
const authHashBefore = createHash('sha256').update(readFileSync(authPath)).digest('hex');

function skill(v) {
  const d = join(home, '.agents/skills', `willyou-fixture-${v}`); mkdirSync(d, { recursive: true });
  paths[v] = join(d, 'SKILL.md');
  writeFileSync(paths[v], `---\nname: willyou-fixture-${v}\ndescription: Synthetic M10 version isolation probe.\n---\n\nThe secret-free skill body marker is M10_SKILL_BODY_${v}. Call the m10_fixture fixture_marker tool exactly once. Return this body marker and the tool's marker, nothing else. Do not access other files or tools.\n`);
}
skill('v1'); skill('v2');
async function launch(label, selected = 'v1') {
  const args = ['--disable', 'apps', '--disable', 'remote_plugin', '--disable', 'multi_agent', '--disable', 'shell_tool', '--disable', 'shell_snapshot', '-c', `skills.config=[{path=${JSON.stringify(paths.v1)},enabled=${selected === 'v1'}},{path=${JSON.stringify(paths.v2)},enabled=${selected === 'v2'}}]`, '-c', 'model="gpt-6.1-sol"', '-c', 'model_reasoning_effort="low"', '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false', '-c', 'web_search="disabled"', '-c', `mcp_servers.m10_fixture={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(fixtureServer)},"--fixture-mcp"],env={M10_FIXTURE_PROJECT="project-a",M10_FIXTURE_VERSION=${JSON.stringify(selected)}}}`, 'app-server', '--stdio'];
  const c = new Client(label, args, cwd, { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome }); clients.push(c);
  await c.rpc('initialize', { clientInfo: { name: 'm10_real_model_preflight', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  c.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'); return c;
}
async function turn(c, id, name, expected = 'v1') {
  const events = []; let resolveDone;
  const completed = new Promise((r) => resolveDone = r);
  c.onMessage = (x) => {
    if (x.method === 'item/completed') {
      const item = x.params.item;
      if (item.type === 'mcpToolCall') events.push({ type: item.type, server: item.server, tool: item.tool, status: item.status, result: item.result });
      if (item.type === 'agentMessage') events.push({ type: item.type, text: item.text });
    }
    if (x.method === 'error') events.push({ type: 'error', error: x.params.error });
    if (x.method === 'turn/completed') resolveDone(x.params.turn);
  };
  const started = await c.rpc('turn/start', { threadId: id, input: [{ type: 'text', text: 'Use the attached synthetic Skill. Call its one harmless MCP fixture tool exactly once, then return the Skill body marker and MCP marker. Do not use shell, network, other skills, or other tools.' }, { type: 'skill', name: `willyou-fixture-${expected}`, path: paths[expected] }], effort: 'low' });
  let timer; const result = await Promise.race([completed, new Promise((r) => timer = setTimeout(() => r({ status: 'probe-timeout' }), 45000))]); clearTimeout(timer);
  if (result.status === 'probe-timeout') await c.rpc('turn/interrupt', { threadId: id, turnId: started.turn.id }).catch(() => {});
  const text = events.filter((e) => e.type === 'agentMessage').map((e) => e.text).join('\n');
  const toolCalls = events.filter((e) => e.type === 'mcpToolCall');
  const pass = result.status === 'completed' && text.includes(`M10_SKILL_BODY_${expected}`) && text.includes(`M10_TOOL_${expected}`) && !text.includes(`M10_SKILL_BODY_${expected === 'v1' ? 'v2' : 'v1'}`) && toolCalls.some((e) => e.server === 'm10_fixture' && e.tool === 'fixture_marker' && e.status === 'completed');
  cases.push({ name, expected, status: pass ? 'passed' : 'blocked', turnStatus: result.status, error: result.error, skillBodySeenInAnswer: text.includes(`M10_SKILL_BODY_${expected}`), selectedToolMarkerSeen: text.includes(`M10_TOOL_${expected}`), forbiddenVersionMarkerSeen: text.includes(`M10_SKILL_BODY_${expected === 'v1' ? 'v2' : 'v1'}`), events });
  return pass;
}
try {
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  if (auth.tokens) auth.tokens.refresh_token = '';
  writeFileSync(join(codexHome, 'auth.json'), JSON.stringify(auth), { mode: 0o600 });
  const c = await launch('new-v1');
  const start = await c.rpc('thread/start', { cwd, ephemeral: false, sandbox: 'read-only', approvalPolicy: 'never' });
  report.nativeThreadId = start.thread.id;
  await turn(c, start.thread.id, 'new-conversation-v1-real-model-read-and-mcp');
  if (cases[0].status === 'passed') {
    const newer = await launch('new-v2-concurrent', 'v2');
    const newStart = await newer.rpc('thread/start', { cwd, ephemeral: false, sandbox: 'read-only', approvalPolicy: 'never' });
    await turn(newer, newStart.thread.id, 'new-conversation-v2-while-v1-process-alive', 'v2');
  }
  await c.close();
  const r = await launch('resume-v1');
  try {
    const resumed = await r.rpc('thread/resume', { threadId: start.thread.id, cwd, sandbox: 'read-only', approvalPolicy: 'never' });
    cases.push({ name: 'native-resume-same-id', status: resumed.thread.id === start.thread.id ? 'passed' : 'failed', previousTurnCount: resumed.thread.turns?.length });
    if (cases[0].status === 'passed') await turn(r, resumed.thread.id, 'resumed-conversation-v1-real-model-read-and-mcp');
  } catch (e) { cases.push({ name: 'native-resume-same-id', status: 'blocked', error: e.message }); }
  report.status = cases.every((c) => c.status === 'passed') ? 'passed-with-boundaries' : 'partial';
} catch (e) { report.status = 'blocked'; report.error = e.message; }
finally {
  await Promise.all(clients.map((c) => c.close()));
  report.clients = clients.map((c) => ({ name: c.label, methods: c.methods, unexpectedRequests: c.unexpectedRequests, notificationMethods: [...new Set(c.notifications)], stderrTail: c.stderr.slice(-2000).replaceAll(root, '<fixture>') }));
  report.authUnchanged = authHashBefore === createHash('sha256').update(readFileSync(authPath)).digest('hex');
  rmSync(root, { recursive: true, force: true });
  report.cleanup = { allChildrenExited: clients.every((c) => c.child.exitCode !== null || c.child.signalCode !== null), temporaryAuthAndFixtureRemoved: !existsSync(root) };
  report.sourceHashes = Object.fromEntries([self, fixtureServer].map((p) => [p.split('/').pop(), createHash('sha256').update(readFileSync(p)).digest('hex')]));
  report.finishedAt = new Date().toISOString(); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, cases: cases.map(({ name, status }) => ({ name, status })), output }));
}
