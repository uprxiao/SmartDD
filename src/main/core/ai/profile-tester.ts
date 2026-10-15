import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProfileCheckCategory } from '@shared/ai-profiles';
import type { Runner } from '@shared/types';
import { PARENT_AGENT_VARS, planLaunchEnv } from '../../launch-env';
import { shellWrapped } from '../../pty-manager';
import { redact } from '../connections/redact';
import type { ResolvedProfile } from './ai-profile-service';
import { classifyText, pickReason } from './health-classify';

// One real round trip: the profile's CLI, started exactly like a task (login shell, profile
// variables re-exported after the rc files), asked to echo a random code. Non-interactive flags
// as in Yoda's rewritePrompt.ts; nothing is saved to the CLI's session history.

export const TEST_TIMEOUT_MS = 60_000;
const OUTPUT_MAX = 64 * 1024;

export interface ProfileTestResult {
  category: ProfileCheckCategory;
  message: string;
  ms: number;
}

export function testArgs(runner: Runner, profileArgs: string[], prompt: string): string[] {
  if (runner === 'claude') return [...profileArgs, '--print', '--no-session-persistence', '--output-format', 'text', prompt];
  return [...profileArgs, 'exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never', prompt];
}

/**
 * Claude retries even a 401 for minutes before giving up, which would read as a timeout here;
 * one attempt is enough for a check. A value set in the profile itself still wins.
 */
const TEST_ENV: Record<Runner, Record<string, string>> = {
  claude: { CLAUDE_CODE_MAX_RETRIES: '0' },
  codex: {},
};

export interface TestDeps {
  baseEnv: Record<string, string>;
  timeoutMs?: number;
  shell?: string;
  /** Only for tests: a fixed code instead of a random one. */
  code?: string;
}

export function runProfileTest(profile: ResolvedProfile, secrets: string[], d: TestDeps): Promise<ProfileTestResult> {
  const code = d.code ?? `SMARTDD-OK-${randomBytes(4).toString('hex')}`;
  const prompt = `This is an automated connectivity check. Do not use any tools. Reply with exactly ${code} and nothing else.`;
  const base = { ...d.baseEnv };
  for (const k of PARENT_AGENT_VARS) delete base[k];
  const plan = planLaunchEnv(base, { ...TEST_ENV[profile.runner], ...profile.env }, profile.isolatePrefixes);
  const { file, args } = shellWrapped(profile.command, testArgs(profile.runner, profile.args, prompt), plan.scriptArgs, d.shell);
  const timeoutMs = d.timeoutMs ?? TEST_TIMEOUT_MS;
  // An empty directory: no project instructions, nothing for the CLI to trust or touch.
  const cwd = mkdtempSync(join(tmpdir(), 'smartdd-check-'));
  const started = Date.now();
  const scrub = (s: string) => redact(s, secrets);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (r: Omit<ProfileTestResult, 'ms'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      resolve({ ...r, message: scrub(r.message), ms: Date.now() - started });
    };
    // Own process group, so a timeout also stops what the shell started.
    const child = spawn(file, args, { cwd, env: plan.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const take = (cur: string, chunk: Buffer) => (cur.length < OUTPUT_MAX ? cur + chunk.toString('utf8') : cur);
    child.stdout.on('data', (c: Buffer) => (stdout = take(stdout, c)));
    child.stderr.on('data', (c: Buffer) => (stderr = take(stderr, c)));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('error', (e) => finish({ category: 'other', message: `无法启动 ${file}：${e.message}` }));
    child.on('close', (exitCode) => {
      // Only stdout counts: Codex echoes the prompt, code included, on stderr.
      if (stdout.includes(code)) return finish({ category: 'ok', message: '' });
      const reason = pickReason(stdout, stderr, code);
      if (timedOut) return finish({ category: 'timeout', message: `${Math.round(timeoutMs / 1000)} 秒内没有回复${reason ? `：${reason}` : ''}` });
      // The shell's own answer when exec finds nothing: 127.
      if (exitCode === 127) {
        return finish({ category: 'not_found', message: `找不到命令 ${profile.command}${reason ? `：${reason}` : ''}` });
      }
      if (exitCode === 0) return finish({ category: 'unexpected', message: `有回复，但内容不是校验码：${reason || '（空）'}` });
      return finish({ category: classifyText(reason) ?? 'other', message: reason || `退出码 ${exitCode}` });
    });
  });
}
