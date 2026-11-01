// T35 test-only third Agent. Own identity, argv and session format; real OS
// process and MCP child, no model, external account or user state.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
if (process.argv.includes('--version')) { process.stdout.write('1.0.0\n'); process.exit(0); }
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const mode = arg('--mode'), sessionId = arg('--session-id'), root = process.env.SCRIPTED_STATE_ROOT;
mkdirSync(root, { recursive: true });
const history = join(root, sessionId + '.jsonl');
if (mode === 'resume' && !existsSync(history)) throw new Error('scripted history missing');
appendFileSync(history, JSON.stringify({ kind: 'scripted-session', sessionId, mode, cwd: process.cwd() }) + '\n', { mode: 0o600 });
const config = JSON.parse(readFileSync(arg('--capability-config'), 'utf8'));
const server = config.servers.find(value => value.args.includes('--bootstrap'));
const skills = config.skills.map(path => ({ path, content: readFileSync(path, 'utf8') }));
const client = new Client({ name: 'scripted-test', version: '1.0.0' });
const transport = new StdioClientTransport({ ...server, env: { ...process.env, ...server.env }, stderr: 'pipe' });
let closing;
const close = () => closing ??= (async () => { clearInterval(timer); await client.close(); process.exitCode = 0; })();
const timer = setInterval(() => { if (existsSync(process.env.WY_SCRIPTED_STOP)) void close(); }, 20);
process.once('SIGTERM', () => void close());
try {
  await client.connect(transport); const tools = await client.listTools();
  const tool = tools.tools.find(value => value.name.includes('draft') && value.name.includes('list'));
  if (!tool) throw new Error('scripted MCP tool missing');
  const result = await client.callTool({ name: tool.name, arguments: {} });
  writeFileSync(process.env.WY_SCRIPTED_REPORT, JSON.stringify({ agentId: 'scripted-test', pid: process.pid, bridgePid: transport.pid, mode, sessionId, skills, tool: tool.name, result }) + '\n', { flag: 'wx', mode: 0o600 });
} catch {
  clearInterval(timer); await client.close().catch(() => {});
  process.stderr.write('scripted test Agent failed\n'); process.exitCode = 1;
}
