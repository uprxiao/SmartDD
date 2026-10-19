import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from '../files/file-acceptance-ui.mjs';
import { pause } from './electron-harness.mjs';
export async function openTaskFileFixture({ executable, scratch, root, extraRoot, name }) {
  const tasks = {}, labels = ['T1', 'T2']; for (const label of labels) await mkdir(join(scratch, label));
  const app = await openFileAcceptanceApp({ executable, projectPath: root, userData: join(scratch, 'userdata'), name, inspectMain: true, prepare: async ({ app, project }) => {
    await app.invoke('projectDirs.update', project.dirs[0].id, { label: 'Root A', path: root }); if (extraRoot) await app.invoke('projectDirs.add', project.id, { label: 'Root B', path: extraRoot });
    for (const label of labels) {
      const profile = await app.invoke('aiProfiles.create', { name: name + ' ' + label, runner: 'claude', executable: '/usr/bin/python3', args: [resolve('scripts/files/terminal-coexistence-receiver.py'), join(scratch, label), label], env: [{ name: 'CLAUDE_CONFIG_DIR', value: join(scratch, 'isolated-cli-' + label), secret: false }], color: null, isDefault: false });
      tasks[label] = await app.invoke('tasks.create', { projectId: project.id, dirId: project.dirs[0].id, aiProfileId: profile.id, firstMessage: '' });
    }
  } });
  const terminal = task => `[data-testid=task-terminal][data-pty="${task.ptyId}"]`;
  async function show(label, { resume = true } = {}) {
    const task = tasks[label]; await app.click(`[data-task-id="${task.task.id}"]`); await app.waitFor(app.exists('[data-testid=task-files]'));
    if (!await app.evaluate("document.querySelector('[data-testid=task-files]')?.getAttribute('aria-pressed')==='true'")) await app.click('[data-testid=task-files]'); await app.waitFor(app.exists('[data-testid=file-workspace]'));
    await app.waitFor(`${app.exists(`${terminal(task)} .xterm-screen`)}||${app.exists('[data-testid=task-resume]')}`);
    if (resume && !await app.evaluate(app.exists(`${terminal(task)} .xterm-screen`))) await app.click('[data-testid=task-resume]'); task.ptyId = (await app.invoke('tasks.get', task.task.id)).ptyId;
    return task;
  }
  const receiver = label => readFile(join(scratch, label, 'state.json'), 'utf8').then(JSON.parse);
  async function control(label, phase, paused = false) {
    const path = join(scratch, label, 'control.json'); await writeFile(path + '.pending', JSON.stringify({ phase, paused })); await rename(path + '.pending', path);
    const end = Date.now() + 6000; while (Date.now() < end) { try { const state = await receiver(label); if (state.phase === phase) return state; } catch {} await pause(20); } throw Error('Own receiver phase did not settle');
  }
  async function projectView() {
    await app.click(`[data-project-id="${app.project.id}"] [data-testid=sidebar-project-more]`); await app.click('[data-testid=sidebar-project-edit]'); await app.waitFor(app.exists('[data-testid=project-files]'));
    if (!await app.evaluate("document.querySelector('[data-testid=project-files]')?.getAttribute('aria-pressed')==='true'")) await app.click('[data-testid=project-files]'); await app.waitFor(app.exists('[data-testid=file-workspace]'));
  }
  return { app, tasks, terminal, show, receiver, control, projectView, async close() { for (const task of Object.values(tasks)) try { await app.invoke('tasks.kill', task.task.id); } catch {} await app.close(); } };
}
