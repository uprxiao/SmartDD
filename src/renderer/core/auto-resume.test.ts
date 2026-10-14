import { describe, expect, it } from 'vitest';
import type { TaskView } from '@shared/tasks';
import { shouldAutoResume } from './auto-resume';

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: 't1',
  projectId: 'p1',
  projectName: 'P',
  dirId: null,
  cwd: '/tmp/p',
  aiProfileId: 'a1',
  aiProfileName: 'CC-DS',
  aiProfileColor: null,
  runner: 'claude',
  nativeSessionId: 's1',
  title: 'T',
  firstMessage: 'hi',
  injectedEnvNames: [],
  configVersion: 1,
  projectConfigVersion: 1,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
  lastLaunchedAt: 0,
  ptyId: null,
  recovery: 'resumable',
  recoveryReason: '',
  ...over,
});

describe('shouldAutoResume', () => {
  it('resumes a stopped task with a session to continue', () => {
    expect(shouldAutoResume(task(), new Set())).toBe(true);
    expect(shouldAutoResume(task({ recovery: 'fresh' }), new Set())).toBe(true);
  });

  it('tries once per task per window', () => {
    expect(shouldAutoResume(task(), new Set(['t1']))).toBe(false);
    expect(shouldAutoResume(task(), new Set(['t2']))).toBe(true);
  });

  it.each(['not-started', 'unrecoverable'] as const)('leaves %s tasks to the panel', (recovery) => {
    expect(shouldAutoResume(task({ recovery }), new Set())).toBe(false);
  });

  it('needs the original profile', () => {
    expect(shouldAutoResume(task({ aiProfileId: null }), new Set())).toBe(false);
  });

  it('skips running and archived tasks', () => {
    expect(shouldAutoResume(task({ ptyId: 'pty-1' }), new Set())).toBe(false);
    expect(shouldAutoResume(task({ archivedAt: 1 }), new Set())).toBe(false);
  });
});
