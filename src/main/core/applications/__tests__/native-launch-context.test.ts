import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectNativeLaunch, type TaskLaunchInput } from '../native-launch-context';

let root: string;
let bin: string;
let project: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'smartdd-native-launch-'));
  bin = join(root, 'bin');
  project = join(root, 'project');
  mkdirSync(bin);
  mkdirSync(project);
  mkdirSync(join(root, '.codex'));
  // A Finder-launched app has a bare PATH; the interpreter is only reachable after the rc files,
  // exactly like `#!/usr/bin/env node` with node in /usr/local/bin.
  writeFileSync(join(root, '.zshrc'), `echo "rc noise"\nexport PATH="${bin}:/usr/bin:/bin"\n`);
  writeFileSync(join(bin, 'fakenode'), '#!/bin/sh\necho "codex-cli 0.166.0"\n');
  writeFileSync(join(bin, 'codex'), '#!/usr/bin/env fakenode\n');
  chmodSync(join(bin, 'fakenode'), 0o755);
  chmodSync(join(bin, 'codex'), 0o755);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const input = (command: string): TaskLaunchInput => ({
  projectId: 'p', taskId: 't', cwd: project, home: root, stateRoot: join(root, '.codex'), claudeConfigExplicit: false,
  mode: 'new', sessionId: null, previous: null, newTask: true, signal: new AbortController().signal,
  profile: { runner: 'codex', command, args: [], env: {} } as unknown as TaskLaunchInput['profile'],
  environment: { HOME: root, ZDOTDIR: root, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TERM: 'dumb' },
});

describe('inspectNativeLaunch with a bare app PATH', () => {
  it('verifies an absolute script CLI whose interpreter is only on the login-shell PATH', async () => {
    const context = await inspectNativeLaunch(input(join(bin, 'codex')));
    expect(context).toMatchObject({ command: join(bin, 'codex'), version: '0.166.0' });
  });

  it('resolves a bare command name through the login-shell PATH', async () => {
    const context = await inspectNativeLaunch(input('codex'));
    expect(context).toMatchObject({ command: join(bin, 'codex'), version: '0.166.0' });
  });

  it('still rejects a command that the login shell cannot find', async () => {
    await expect(inspectNativeLaunch(input('codex-missing'))).rejects.toMatchObject({ code: 'AGENT_ADAPTER_UNSUPPORTED' });
  });
});
