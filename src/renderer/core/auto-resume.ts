import type { TaskView } from '@shared/tasks';

/**
 * Opening a stopped task in a tab resumes it with the profile it ran on, once per opened tab
 * (like Yoda's visible-conversation auto-resume; closing the tab and opening the task again
 * tries again). The stopped panel stays for everything that needs a choice: no id to resume
 * (Codex never messaged), no recorded profile (pre-M3 records) or it was deleted, archived,
 * or this tab already tried — a failed attempt, or the user dropped the terminal to switch.
 */
export function shouldAutoResume(task: TaskView, attempted: ReadonlySet<string>): boolean {
  if (attempted.has(task.id)) return false;
  if (task.ptyId !== null) return false;
  if (task.archivedAt !== null) return false;
  if (task.aiProfileId === null) return false;
  return task.recovery === 'resumable' || task.recovery === 'fresh';
}
