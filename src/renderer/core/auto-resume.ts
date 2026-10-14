import type { TaskView } from '@shared/tasks';

/**
 * Opening a stopped task resumes it with the profile it ran on, once per task per window
 * (like Yoda's visible-conversation auto-resume). The stopped panel stays for everything that
 * needs a choice: no id to resume (Codex never messaged, pre-M3 records), the profile is gone,
 * the task is still running elsewhere, or this window already tried — a failed attempt, or the
 * user dropped the terminal to switch profiles.
 */
export function shouldAutoResume(task: TaskView, attempted: ReadonlySet<string>): boolean {
  if (attempted.has(task.id)) return false;
  if (task.ptyId !== null) return false;
  if (task.archivedAt !== null) return false;
  if (task.aiProfileId === null) return false;
  return task.recovery === 'resumable' || task.recovery === 'fresh';
}
