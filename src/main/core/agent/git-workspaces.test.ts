import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { GitWorkspaces, runWorkspaceCommand } from './git-workspaces';
const clean: (() => void)[] = []; afterEach(() => clean.splice(0).forEach(f => f()));
async function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'm14-git-'))), root = join(base, 'work'), home = join(base, 'home'); mkdirSync(root); mkdirSync(home);
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); runBundledMigrations(db); const store = new AgentStore(db);
  clean.push(() => { db.close(); rmSync(base, { recursive: true, force: true }); });
  const g = async (...args: string[]) => { const r = await runWorkspaceCommand(root, 'git', args); if (r.code) throw Error(r.stderr); return r.stdout.trim(); };
  await g('init', '-q', '-b', 'main'); await g('config', 'user.name', 'Fixture'); await g('config', 'user.email', 'fixture@example.invalid'); writeFileSync(join(root, 'a.txt'), 'base\n'); await g('add', '-A'); await g('commit', '-qm', 'base');
  const task = (title: string) => store.createTask({ projectId: null, dirId: null, cwd: root, title, selection: { driverId: 'codex-app-server', profileId: 'fixture', tier: 'ask' } });
  const parent = task('parent'), child = task('child'), service = new GitWorkspaces({ store, home, recoverySafe: async () => true });
  const create = (title = 'child', cwd = root, childTaskId = child) => service.create({ parentTaskId: parent, childTaskId, cwd, title, projectName: '中文 Project name', projectId: 'abcdef-project' });
  return { base, root, home, db, store, parent, child, task, service, g, create };
}
it('A66: maps a subdirectory, keeps dirty files on the original branch, uses lowercase unique branches and never pushes', async () => {
  const f = await fixture(); mkdirSync(join(f.root, 'packages/web'), { recursive: true }); writeFileSync(join(f.root, 'packages/web/app.txt'), 'app'); const before = await f.g('rev-parse', 'HEAD');
  const first = (await f.create('Add Feature', join(f.root, 'packages/web')))!;
  expect(first.cwd).toBe(join(first.workspace.path, 'packages/web')); expect(first.workspace.branch).toBe('main_willyou_add-feature'); expect(first.workspace.path).not.toMatch(/\s/);
  expect(await f.g('rev-parse', 'HEAD')).toBe(before);
  expect(first.workspace.base_commit).toBe(before);
  expect(existsSync(join(first.cwd,'app.txt'))).toBe(false);
  expect(f.db.prepare("SELECT * FROM agent_intents WHERE action='auto_commit'").all()).toEqual([]);
  const again = await f.create('Add Feature', f.root, f.task('another')); expect(again!.workspace.branch).toBe('main_willyou_add-feature-2');
});
it('A66: recorded worktree intent is reconciled without recreating it; exact commit recovery requires matching the expected parent', async () => {
  const f = await fixture(); writeFileSync(join(f.root, 'dirty.txt'), 'dirty'); const created = (await f.create())!;
  const head = await f.g('rev-parse', 'HEAD');
  f.db.prepare("UPDATE agent_intents SET state='intended'").run(); f.db.prepare('DELETE FROM agent_commit_provenance').run(); f.db.prepare("UPDATE agent_workspaces SET state='preparing' WHERE child_task_id=?").run(f.child);
  await f.service.recoverIntents(); expect(await f.g('rev-parse', 'HEAD')).toBe(head); expect(f.service.workspace(f.child)?.state).toBe('ready'); expect(f.db.prepare('SELECT COUNT(*) AS n FROM agent_commit_provenance').get()).toEqual({ n: 0 });
  const intent = f.db.prepare("SELECT intent_id FROM agent_intents WHERE action='worktree_add'").get() as { intent_id: string };
  f.db.prepare("UPDATE agent_intents SET state='intended',target_ref=? WHERE intent_id=?").run('f'.repeat(40), intent.intent_id); await f.service.recoverIntents();
  expect(f.db.prepare('SELECT state FROM agent_intents WHERE intent_id=?').get(intent.intent_id)).toEqual({ state: 'needs_review' }); expect(created.workspace.path).toBe(f.service.workspace(f.child)?.path);
});
it('A67: unrelated same-title commits fail, ancestor merge and patch-equivalent cherry-pick pass, in-progress state is resolved through Git', async () => {
  const f = await fixture(), base = await f.g('rev-parse', 'HEAD');
  await f.g('checkout', '-qb', 'child'); writeFileSync(join(f.root, 'child.txt'), 'child\n'); await f.g('add', '-A'); await f.g('commit', '-qm', 'same title'); const child = await f.g('rev-parse', 'HEAD');
  await f.g('checkout', '-q', 'main'); writeFileSync(join(f.root, 'other.txt'), 'other\n'); await f.g('add', '-A'); await f.g('commit', '-qm', 'same title');
  const range = { branch: 'child', base, commits: [child], files: ['child.txt'] };
  expect((await f.service.checkMerge(f.root, range, 'main')).pass).toBe(false);
  await f.g('cherry-pick', child); expect((await f.service.checkMerge(f.root, range, 'main')).pass).toBe(true);
  const status = await f.g('rev-parse', '--git-path', 'MERGE_HEAD'); writeFileSync(join(f.root, status), child + '\n');
  expect((await f.service.checkMerge(f.root, range, 'main')).inProgress).toContain('MERGE_HEAD');
});
it('A67: a resolved -x pick proves provenance while unfinished linked-worktree cherry-pick and marker/branch errors fail closed', async () => {
  const f = await fixture(), base = await f.g('rev-parse', 'HEAD');
  await f.g('checkout', '-qb', 'child'); writeFileSync(join(f.root, 'a.txt'), 'child\n'); await f.g('commit', '-qam', 'child'); const h = await f.g('rev-parse', 'HEAD');
  await f.g('checkout', '-q', 'main'); writeFileSync(join(f.root, 'a.txt'), 'main\n'); await f.g('commit', '-qam', 'main');
  const linked = join(f.base, 'linked'); await f.g('worktree', 'add', '-b', 'linked', linked, 'main');
  await runWorkspaceCommand(linked, 'git', ['cherry-pick', '-x', h]); writeFileSync(join(linked, 'a.txt'), 'main\nchild\n'); await runWorkspaceCommand(linked, 'git', ['add', 'a.txt']);
  const range = { branch: 'child', base, commits: [h], files: ['a.txt'] };
  expect((await f.service.checkMerge(linked, range, 'linked')).inProgress).toContain('CHERRY_PICK_HEAD');
  const continued = await runWorkspaceCommand(linked, 'git', ['-c', 'core.editor=true', 'cherry-pick', '--continue']); expect(continued.code).toBe(0);
  expect((await f.service.checkMerge(linked, range, 'linked')).pass).toBe(true);
  writeFileSync(join(linked, 'a.txt'), '<<<<<<< HEAD\nmain\n>>>>>>> child\n'); expect((await f.service.checkMerge(linked, range, 'linked')).pass).toBe(false);
  expect((await f.service.checkMerge(linked, range, 'wrong')).branchOk).toBe(false);
});
it('A66: dependency selection honors mapped cwd then repository root; failed install is recorded and does not hide the worktree', async () => {
  const f = await fixture(); mkdirSync(join(f.root, 'packages/web'), { recursive: true }); writeFileSync(join(f.root, 'packages/web/package-lock.json'), '{}'); writeFileSync(join(f.root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  await f.g('add','-A');await f.g('commit','-qm','dependency fixture');
  const calls: unknown[] = [];
  const service = new GitWorkspaces({ store: f.store, home: f.home, dependencyTimeoutMs: 50, command: async (cwd, command, args, timeout) => { if (command === 'git') return runWorkspaceCommand(cwd, command, args, timeout); calls.push({ cwd, command, args, timeout }); return { stdout: '', stderr: 'fixture install timeout', code: -1 }; } });
  const created = (await service.create({ parentTaskId: f.parent, childTaskId: f.child, cwd: join(f.root, 'packages/web'), projectName: 'test', projectId: 'abcdef', title: 'deps' }))!;
  expect(calls).toEqual([{ cwd: created.cwd, command: 'npm', args: ['ci'], timeout: 50 }]); expect(JSON.parse(created.workspace.deps_result!)).toMatchObject({ state: 'failed', code: -1 }); expect(created.workspace.state).toBe('ready');
});
it('A66: the actual installer materializes a local dependency inside the new worktree, with an isolated offline cache', async()=>{
 const f=await fixture(),names=['npm_config_cache','npm_config_offline','npm_config_audit','npm_config_fund','npm_config_update_notifier'] as const,old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
  process.env.npm_config_cache=join(f.base,'npm-cache');process.env.npm_config_offline='true';process.env.npm_config_audit='false';process.env.npm_config_fund='false';process.env.npm_config_update_notifier='false';
  mkdirSync(join(f.root,'tiny'));writeFileSync(join(f.root,'tiny/package.json'),JSON.stringify({name:'tiny-fixture',version:'1.0.0',main:'index.js'}));writeFileSync(join(f.root,'tiny/index.js'),'module.exports="LOCAL_DEPENDENCY";\n');
  writeFileSync(join(f.root,'package.json'),JSON.stringify({name:'workspace-fixture',version:'1.0.0',dependencies:{'tiny-fixture':'file:./tiny'}}));
  const lock=await runWorkspaceCommand(f.root,'npm',['install','--package-lock-only','--ignore-scripts','--offline','--no-audit'],20_000);expect(lock.code,lock.stderr).toBe(0);
  await f.g('add','-A');await f.g('commit','-qm','local dependency fixture');
  const created=await f.service.create({parentTaskId:f.parent,childTaskId:f.child,cwd:f.root,title:'dependency fixture',projectId:'p',projectName:'project'});
  expect(JSON.parse(created!.workspace.deps_result!).state).toBe('installed');expect(readFileSync(join(created!.cwd,'node_modules/tiny-fixture/index.js'),'utf8')).toContain('LOCAL_DEPENDENCY');
 }finally{for(const name of names)if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}
},30_000);
