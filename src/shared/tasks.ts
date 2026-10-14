import type { Runner } from './types';

/**
 * What "open" will do for a task that is not running (PRD F05):
 * - resumable:     the CLI has a session file → resume
 * - fresh:         Claude, no message was ever sent → reopen with the same id (`--session-id`)
 * - not-started:   Codex, no message was ever sent → no id to resume; starting again opens a new one
 * - unrecoverable: no native id at all (e.g. a record from before M3)
 */
export type TaskRecovery = 'resumable' | 'fresh' | 'not-started' | 'unrecoverable';

export interface TaskView {
  id: string;
  projectId: string | null;
  projectName: string | null;
  dirId: string | null;
  cwd: string;
  aiProfileId: string | null;
  /** Snapshot taken at launch; kept when the profile is deleted. */
  aiProfileName: string | null;
  aiProfileColor: string | null;
  runner: Runner;
  nativeSessionId: string | null;
  title: string;
  firstMessage: string;
  injectedEnvNames: string[];
  configVersion: number | null;
  /** The project's version now; differs from configVersion when it changed after launch. */
  projectConfigVersion: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastLaunchedAt: number | null;
  /** Set while the CLI runs in this window. */
  ptyId: string | null;
  recovery: TaskRecovery;
  recoveryReason: string;
}

export interface CreateTaskRequest {
  projectId: string;
  /** null: the project's default directory. */
  dirId: string | null;
  aiProfileId: string;
  firstMessage: string;
  cols?: number;
  rows?: number;
}

export interface OpenTaskRequest {
  taskId: string;
  /** Resume with another profile (PRD F04: allowed, with a warning in the UI). */
  aiProfileId?: string;
  cols?: number;
  rows?: number;
}

export const TITLE_MAX = 60;

/** First line of the first message, or "<profile> <time>". */
export function taskTitle(firstMessage: string, profileName: string, at: number): string {
  const line = firstMessage.trim().split('\n')[0].trim();
  if (line) return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${profileName} ${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ⌘K: every word must appear in the title, first message or project name (case-insensitive). */
export function matchTask(t: Pick<TaskView, 'title' | 'firstMessage' | 'projectName'>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${t.title}\n${t.firstMessage}\n${t.projectName ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
