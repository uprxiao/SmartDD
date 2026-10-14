// Where Claude Code and Codex keep their own session files (verified in M0). SmartDD only
// reads file names and the first line of Codex rollouts; it never parses conversation content.

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseCodexSessionMeta, type CodexRolloutMeta } from '@shared/codex-session';
import type { Runner } from '@shared/types';

/** CLAUDE_CONFIG_DIR / CODEX_HOME as the CLI will see it: the profile wins, then the inherited env. */
export function stateRootFor(runner: Runner, profileEnv: Record<string, string>, baseEnv: Record<string, string>): string {
  if (runner === 'claude') return profileEnv.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return profileEnv.CODEX_HOME || baseEnv.CODEX_HOME || join(homedir(), '.codex');
}

// Claude stores <root>/projects/<cwd with every non-alphanumeric char replaced by "->/<id>.jsonl.
const encodeClaudeDir = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

export function claudeSessionFileExists(root: string, cwd: string, sessionId: string): boolean {
  const projects = join(root, 'projects');
  const candidates = new Set([cwd]);
  try {
    candidates.add(realpathSync(cwd));
  } catch {
    // Directory gone; the recorded path is all we have.
  }
  for (const c of candidates) if (existsSync(join(projects, encodeClaudeDir(c), `${sessionId}.jsonl`))) return true;
  // Fallback for encodings we do not predict (e.g. a future Claude version).
  if (!existsSync(projects)) return false;
  return readdirSync(projects).some((d) => existsSync(join(projects, d, `${sessionId}.jsonl`)));
}

export async function recentCodexRollouts(root: string, sinceMs: number): Promise<CodexRolloutMeta[]> {
  const out: CodexRolloutMeta[] = [];
  for (const dayDir of codexDayDirs(join(root, 'sessions'), sinceMs)) {
    if (!existsSync(dayDir)) continue;
    for (const name of readdirSync(dayDir)) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      const file = join(dayDir, name);
      if (statSync(file).mtimeMs < sinceMs - 2000) continue;
      const meta = parseCodexSessionMeta(await readFirstLine(file));
      if (meta) out.push(meta);
    }
  }
  return out;
}

// Rollout folders are named by local date; check launch day and today to survive midnight.
function codexDayDirs(sessionsRoot: string, sinceMs: number): string[] {
  const days = new Set<string>();
  for (const t of [sinceMs, Date.now()]) {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, '0');
    days.add(join(sessionsRoot, String(d.getFullYear()), p(d.getMonth() + 1), p(d.getDate())));
  }
  return [...days];
}

async function readFirstLine(file: string): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const nl = text.indexOf('\n');
    return nl === -1 ? text : text.slice(0, nl);
  } finally {
    await fh.close();
  }
}
