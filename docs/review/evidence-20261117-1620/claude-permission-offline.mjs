// Native CLI control-plane check only. No user prompt, credentials, or model call.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-review-claude-control-')));
const results = [];
for (const enableBypass of [false, true]) {
  const home = join(root, enableBypass ? 'with-opt-in' : 'without-opt-in'); mkdirSync(home);
  let child, stopped = false, releaseInput;
  const inputEnd = new Promise(r => { releaseInput = r; });
  const prompt = { async *[Symbol.asyncIterator]() { await inputEnd; } };
  const diagnostics = [];
  const q = query({ prompt, options: {
    pathToClaudeCodeExecutable: '/Users/liubu/.local/bin/claude', cwd: home,
    env: {
      HOME: home, PATH: process.env.PATH, CLAUDE_CONFIG_DIR: join(home, '.claude'),
      ANTHROPIC_API_KEY: 'review-offline-dummy', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
      DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    },
    permissionMode: 'default', settingSources: [],
    ...(enableBypass ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: async () => ({ behavior: 'deny', message: 'offline review' }),
    stderr: t => { diagnostics.push(t.slice(0, 2000)); },
    spawnClaudeCodeProcess: s => {
      child = spawn(s.command, s.args, { cwd: s.cwd, env: s.env, stdio: ['pipe', 'pipe', 'pipe'] });
      child.once('exit', () => { stopped = true; });
      return child;
    },
  } });
  let timeout;
  try {
    await Promise.race([
      q.setPermissionMode('bypassPermissions'),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('bounded control timeout')), 10_000); }),
    ]);
    results.push({ enableBypass, result: 'accepted', userPromptsSent: 0 });
  } catch (e) { results.push({ enableBypass, result: 'rejected', error: e.message, userPromptsSent: 0 }); }
  finally {
    clearTimeout(timeout); releaseInput(); q.close();
    if (child && !stopped) {
      let timer;
      await Promise.race([once(child, 'exit'), new Promise(r => { timer = setTimeout(r, 2000); })]); clearTimeout(timer);
      if (!stopped) { child.kill('SIGTERM'); await once(child, 'exit'); }
    }
  }
  results.at(-1).childExited = stopped;
  results.at(-1).diagnostics = diagnostics;
}
writeFileSync('docs/review/evidence-20261117-1620/claude-permission-offline.json', JSON.stringify({ isolationRoot: root, results }, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ diagnostics, ...r }) => r), null, 2));
