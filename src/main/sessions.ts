import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseCodexSessionMeta, pickCodexSession, type CodexRolloutMeta } from '@shared/codex-session';
import { buildRunnerArgs } from '@shared/runner-args';
import type { LaunchRequest, LaunchResult, SessionRecord } from '@shared/types';
import type { AppDb } from './db/client';
import { claimedNativeIds, insertSession, setNativeSessionId } from './db/sessions-repo';
import type { PtyManager } from './pty-manager';

export class SessionService {
  private readonly codexWatchers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly db: AppDb,
    private readonly ptys: PtyManager,
    private readonly onUpdated: (s: SessionRecord) => void
  ) {}

  launch(req: LaunchRequest, baseEnv: Record<string, string>): LaunchResult {
    if (!existsSync(req.cwd) || !statSync(req.cwd).isDirectory()) {
      throw new Error(`工作目录不存在或不是目录：${req.cwd}`);
    }
    const resuming = Boolean(req.resumeSessionId);
    const newClaudeId = req.runner === 'claude' && !resuming ? randomUUID() : undefined;
    const args = buildRunnerArgs(req.runner, { newSessionId: newClaudeId, resumeSessionId: req.resumeSessionId });
    const launchedAt = Date.now();

    const ptyId = this.ptys.spawn({ command: req.runner, args, cwd: req.cwd, env: { ...baseEnv, ...req.env } });

    const session: SessionRecord = {
      id: randomUUID(),
      runner: req.runner,
      cwd: req.cwd,
      nativeSessionId: req.resumeSessionId ?? newClaudeId ?? null,
      title: `${req.runner} ${new Date(launchedAt).toLocaleString('zh-CN')}${resuming ? '（恢复）' : ''}`,
      createdAt: launchedAt,
    };
    insertSession(this.db, session);

    if (req.runner === 'codex' && !resuming) this.watchCodex(session, ptyId, launchedAt);
    return { ptyId, session };
  }

  // Codex creates its rollout file only after the first user message, so poll until it appears.
  private watchCodex(session: SessionRecord, ptyId: string, launchedAt: number): void {
    const realCwd = realpathSync(session.cwd);
    const stop = () => {
      clearInterval(timer);
      this.codexWatchers.delete(session.id);
    };
    const timer = setInterval(async () => {
      const found = pickCodexSession(await recentCodexRollouts(launchedAt), {
        realCwd,
        launchedAtMs: launchedAt,
        claimedIds: claimedNativeIds(this.db),
      });
      if (!found) return;
      stop();
      setNativeSessionId(this.db, session.id, found.id);
      this.onUpdated({ ...session, nativeSessionId: found.id });
    }, 1500);
    this.codexWatchers.set(session.id, timer);
    const onExit = (id: string) => {
      if (id !== ptyId) return;
      this.ptys.off('exit', onExit);
      // Give Codex a moment to flush the rollout after the last message before giving up.
      setTimeout(stop, 3000);
    };
    this.ptys.on('exit', onExit);
  }

  dispose(): void {
    for (const t of this.codexWatchers.values()) clearInterval(t);
    this.codexWatchers.clear();
  }
}

export function codexSessionsRoot(): string {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
}

export async function recentCodexRollouts(sinceMs: number): Promise<CodexRolloutMeta[]> {
  const out: CodexRolloutMeta[] = [];
  for (const dayDir of codexDayDirs(sinceMs)) {
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
function codexDayDirs(sinceMs: number): string[] {
  const days = new Set<string>();
  for (const t of [sinceMs, Date.now()]) {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, '0');
    days.add(join(codexSessionsRoot(), String(d.getFullYear()), p(d.getMonth() + 1), p(d.getDate())));
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

export function claudeSessionFileExists(sessionId: string): boolean {
  const root = join(homedir(), '.claude', 'projects');
  if (!existsSync(root)) return false;
  return readdirSync(root).some((d) => existsSync(join(root, d, `${sessionId}.jsonl`)));
}
