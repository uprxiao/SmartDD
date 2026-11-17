// Host-owned Git effects (T1.5 §6.1); every effect has a durable intent before Git runs.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { AgentStore } from './agent-store';
import { DriverError } from './driver';
import type { WorkspaceCommandOptions } from './owned-command';
export interface WorkspaceRow { workspace_id: string; task_id: string; child_task_id: string | null; kind: 'main' | 'git_worktree'; repo_root: string; path: string; branch: string | null; base_commit: string | null; auto_commit: string | null; state: 'preparing' | 'ready' | 'failed' | 'archived'; deps_result: string | null }
export interface GitResult { stdout: string; stderr: string; code: number }
type Command = (cwd: string, command: string, args: readonly string[], timeoutMs?: number, options?: WorkspaceCommandOptions) => Promise<GitResult>;
export const runWorkspaceCommand: Command = (cwd, command, args, timeoutMs = 120_000, options = {}) => new Promise(resolveCommand => {
  execFile(command, [...args], { cwd, signal: options.signal, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (e, stdout, stderr) => resolveCommand({ stdout, stderr, code: e ? typeof e.code === 'number' ? e.code : -1 : 0 }));
});
const at = () => new Date().toISOString();
const inside = (root: string, path: string) => { const r = relative(root, path); return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith('../')); };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'task';
export interface MergeCheck { pass: boolean; missingCommits: string[]; inProgress: string[]; conflictMarkers: string; branchOk: boolean; error?: string }
export class GitWorkspaces {
  constructor(private readonly d: { store: AgentStore; home: string; command?: Command; dependencyTimeoutMs?: number; recoverySafe?(taskId: string): Promise<boolean> }) {}
  private call(cwd: string, args: readonly string[]) { return (this.d.command ?? runWorkspaceCommand)(cwd, 'git', args); }
  private async effect(taskId: string, cwd: string, args: string[], signal?: AbortSignal) { const r = await (this.d.command ?? runWorkspaceCommand)(cwd, 'git', args, 120_000, {taskId, signal}); if(r.code !== 0) throw new DriverError('STATE', `Git ${args[0]} 失败：${r.stderr.slice(-1800)}`); return r.stdout.trim(); }
  private async git(cwd: string, ...args: string[]) { const r = await this.call(cwd, args); if (r.code !== 0) throw new DriverError('STATE', `Git ${args[0]} 失败：${r.stderr.slice(-1800) || r.stdout.slice(-1800)}`); return r.stdout.trim(); }
  async detect(cwd: string): Promise<{ root: string; cwd: string; branch: string } | null> {
    const actual = realpathSync(cwd);
    // SVN wins even when an incidental nested .git exists.
    for (let p = actual; ; p = dirname(p)) { if (existsSync(join(p, '.svn'))) return null; if (dirname(p) === p) break; }
    const r = await this.call(actual, ['rev-parse', '--show-toplevel']); if (r.code !== 0 || !r.stdout.trim()) return null;
    const root = realpathSync(r.stdout.trim()); if (!inside(root, actual)) return null;
    return { root, cwd: actual, branch: await this.git(root, 'rev-parse', '--abbrev-ref', 'HEAD') };
  }
  workspace(childTaskId: string) { return this.d.store.sqlite.prepare("SELECT * FROM agent_workspaces WHERE child_task_id=? AND kind='git_worktree' AND state<>'archived' ORDER BY rowid DESC LIMIT 1").get(childTaskId) as WorkspaceRow | undefined; }
  private intent(taskId: string, action: string, target: string, head: string | null, metadata: Record<string, unknown> = {}) {
    const id = randomUUID(); this.d.store.sqlite.prepare("INSERT INTO agent_intents(intent_id,task_id,action,target_ref,head_before,expected_parent,state,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'intended',?,?,?)").run(id, taskId, action, target, head, head, JSON.stringify(metadata), at(), at()); return id;
  }
  private finish(id: string, state: 'done' | 'needs_review', value: unknown) { const old = this.d.store.sqlite.prepare('SELECT result_json FROM agent_intents WHERE intent_id=?').get(id) as { result_json: string | null }; this.d.store.sqlite.prepare('UPDATE agent_intents SET state=?,result_json=?,updated_at=? WHERE intent_id=?').run(state, JSON.stringify({ ...JSON.parse(old.result_json ?? '{}'), ...(value as object) }), at(), id); }
  private async cleanBoundary(cwd: string) {
    for (const name of ['CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply']) {
      const state = await this.git(cwd, 'rev-parse', '--git-path', name);
      if (!state || existsSync(isAbsolute(state) ? state : join(cwd, state))) throw new DriverError('STATE', `仓库有未结束的 ${name}，请先处理`);
    }
    if ((await this.git(cwd, 'ls-files', '-u')).length) throw new DriverError('STATE', '仓库仍有未解决冲突');
  }
  private mainWorkspace(taskId: string, root: string, branch: string): WorkspaceRow {
    const known = this.d.store.sqlite.prepare('SELECT * FROM agent_workspaces WHERE path=?').get(root) as WorkspaceRow | undefined; if (known) return known;
    const id = randomUUID(); this.d.store.sqlite.prepare("INSERT INTO agent_workspaces(workspace_id,task_id,kind,repo_root,path,branch,state,created_at,updated_at) VALUES(?,?,'main',?,?,?,'ready',?,?)").run(id, taskId, root, root, branch, at(), at());
    return this.d.store.sqlite.prepare('SELECT * FROM agent_workspaces WHERE workspace_id=?').get(id) as WorkspaceRow;
  }
  private async commit(taskId: string, workspace: WorkspaceRow, attemptId: string | null, message: string, kind: 'auto_before_delegate' | 'child_result') {
    await this.cleanBoundary(workspace.path);
    const before = await this.git(workspace.path, 'rev-parse', 'HEAD');
    if (!(await this.git(workspace.path, 'status', '--porcelain=v1', '-uall'))) return before;
    const id = this.intent(taskId, kind === 'child_result' ? 'child_result_commit' : 'auto_commit', workspace.path, before, { attemptId, workspaceId: workspace.workspace_id, message, kind });
    try {
      await this.effect(taskId, workspace.path, ['add', '-A']);
      await this.effect(taskId, workspace.path, ['commit', '-m', message, '-m', `WillYou-Intent: ${id}`]);
      const head = await this.git(workspace.path, 'rev-parse', 'HEAD');
      if (await this.git(workspace.path, 'rev-parse', `${head}^`) !== before) throw new DriverError('STATE', '提交的父提交不符，保留为待核实');
      this.d.store.tx(() => {
        this.d.store.sqlite.prepare('INSERT OR IGNORE INTO agent_commit_provenance(commit_sha,workspace_id,attempt_id,intent_id,kind,message,created_at) VALUES(?,?,?,?,?,?,?)').run(head, workspace.workspace_id, attemptId, id, kind, message, at());
        this.finish(id, 'done', { head });
      }); return head;
    } catch (e) { this.finish(id, 'needs_review', { error: (e as Error).message }); throw e; }
  }
  async create(input: { parentTaskId: string; childTaskId: string; projectId: string; projectName: string; title: string; cwd: string; signal?: AbortSignal; assertBoundary(): void }) {
    const existing = this.workspace(input.childTaskId); if (existing) { if (existing.state !== 'ready') throw new DriverError('STATE', '工作副本准备待核实，未重复执行'); return { workspace: existing, cwd: join(existing.path, relative(existing.repo_root, realpathSync(input.cwd))) }; }
    const repo = await this.detect(input.cwd); if (!repo) return null;
    input.assertBoundary(); if(input.signal?.aborted) throw new DriverError('REJECTED','子任务准备已取消'); await this.cleanBoundary(repo.root);
    const main = this.mainWorkspace(input.parentTaskId, repo.root, repo.branch);
    const base = await this.commit(input.parentTaskId, main, null, 'willyou: 自动提交（派出子任务前）', 'auto_before_delegate');
    input.assertBoundary(); if (await this.git(repo.root, 'rev-parse', '--abbrev-ref', 'HEAD') !== repo.branch) throw new DriverError('STATE', '准备期间主分支已变化');
    const branchBase = `${repo.branch === 'HEAD' ? base.slice(0, 8) : repo.branch.toLowerCase()}_willyou_${slug(input.title)}`;
    let branch = branchBase, n = 1;
    while ((await this.call(repo.root, ['show-ref', '--verify', '--quiet', 'refs/heads/' + branch])).code === 0) branch = `${branchBase}-${++n}`;
    await this.git(repo.root, 'check-ref-format', '--branch', branch);
    const ownedRoot = resolve(this.d.home, '.willyou/worktrees'), project = slug(input.projectName).replace(/^task$/, 'project') + '-' + input.projectId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
    const path = join(ownedRoot, project, branch);
    if (inside(repo.root, path)) throw new DriverError('REJECTED', '工作副本不能放进主仓库内部，请使用不包含用户工作副本登记根的项目目录');
    if (!inside(ownedRoot, path) || /\s/.test(path)) throw new DriverError('REJECTED', '工作副本路径越界或含空格，不能按已确认规则创建');
    if (existsSync(path)) throw new DriverError('STATE', '工作副本路径已存在，未覆盖');
    mkdirSync(dirname(path), { recursive: true });
    if (!inside(realpathSync(ownedRoot), realpathSync(dirname(path)))) throw new DriverError('REJECTED', '工作副本父目录已被链接到登记根以外');
    const id = randomUUID(), intent = this.intent(input.parentTaskId, 'worktree_add', path, base, { childTaskId: input.childTaskId, branch });
    this.d.store.sqlite.prepare("INSERT INTO agent_workspaces(workspace_id,task_id,child_task_id,kind,repo_root,path,branch,base_commit,auto_commit,state,created_at,updated_at) VALUES(?,?,?,'git_worktree',?,?,?,?,?,'preparing',?,?)").run(id, input.parentTaskId, input.childTaskId, repo.root, path, branch, base, base, at(), at());
    try {
      input.assertBoundary(); if(input.signal?.aborted) throw new DriverError('REJECTED','子任务准备已取消'); await this.effect(input.childTaskId, repo.root, ['worktree', 'add', '-b', branch, path, base]);
      const childCwd = join(path, relative(repo.root, repo.cwd));
      const dependencies = await this.installDependencies(childCwd, path, {signal: input.signal, taskId: input.childTaskId});
      this.d.store.tx(emit => { this.d.store.sqlite.prepare("UPDATE agent_workspaces SET state='ready',deps_result=?,updated_at=? WHERE workspace_id=?").run(JSON.stringify(dependencies), at(), id); this.finish(intent, 'done', { path, branch, base }); emit(input.childTaskId, 'workspace.ready', { path, branch }); });
      return { workspace: this.workspace(input.childTaskId)!, cwd: childCwd };
    } catch (e) { this.d.store.sqlite.prepare("UPDATE agent_workspaces SET state='failed',updated_at=? WHERE workspace_id=?").run(at(), id); this.finish(intent, 'needs_review', { error: (e as Error).message }); throw e; }
  }
  async installDependencies(cwd: string, root: string, options: WorkspaceCommandOptions = {}) {
    if(options.signal?.aborted) return {state: 'canceled', reason: '子任务准备已取消'};
    for (const dir of [...new Set([cwd, root])]) for (const [file, command, args] of [['pnpm-lock.yaml', 'pnpm', ['install', '--frozen-lockfile']], ['package-lock.json', 'npm', ['ci']], ['yarn.lock', 'yarn', ['install', '--frozen-lockfile']]] as const) {
      if (!existsSync(join(dir, file))) continue;
      const r = await (this.d.command ?? runWorkspaceCommand)(dir, command, args, this.d.dependencyTimeoutMs ?? 120_000, options);
      return { state: options.signal?.aborted ? 'canceled' : r.code === 0 ? 'installed' : 'failed', command, args, cwd: dir, code: r.code, detail: (r.stderr || r.stdout).slice(-4000) };
    }
    return { state: 'skipped', reason: '没有受支持的 JS 锁文件（Maven／Gradle 不安装）' };
  }
  async finalize(childTaskId: string, attemptId: string, title: string, startHead?: string) {
    const w = this.workspace(childTaskId); if (!w || w.state !== 'ready') return null;
    const head = await this.commit(childTaskId, w, attemptId, `willyou: ${title.slice(0, 120)}（子任务提交）`, 'child_result');
    const base = startHead ?? w.base_commit!;
    const commits = (await this.git(w.path, 'rev-list', '--reverse', `${base}..${head}`)).split('\n').filter(Boolean);
    const range = { branch: w.branch!, base, head, commits, files: (await this.git(w.path, 'diff', '--name-only', base, head)).split('\n').filter(Boolean), summary: await this.git(w.path, 'diff', '--stat', base, head) };
    this.d.store.sqlite.prepare('UPDATE agent_delegation_attempts SET commit_range=? WHERE attempt_id=?').run(JSON.stringify(range), attemptId);
    return range;
  }
  async checkMerge(cwd: string, range: { branch: string; base: string; commits: string[]; files: string[] }, expectedBranch: string): Promise<MergeCheck> {
    const result: MergeCheck = { pass: false, missingCommits: [...range.commits], inProgress: [], conflictMarkers: '', branchOk: false };
    try {
      const cherry = await this.git(cwd, 'cherry', 'HEAD', range.branch), equivalent = new Set(cherry.split('\n').filter(s => s.startsWith('- ')).map(s => s.slice(2)));
      const picked = new Set([...(await this.git(cwd, 'log', '--format=%B', `${range.base}..HEAD`)).matchAll(/\(cherry picked from commit ([a-f0-9]{40,64})\)/g)].map(m => m[1]));
      result.missingCommits = [];
      for (const h of range.commits) if ((await this.call(cwd, ['merge-base', '--is-ancestor', h, 'HEAD'])).code !== 0 && !equivalent.has(h) && !picked.has(h)) result.missingCommits.push(h);
      for (const name of ['CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply']) { const p = await this.git(cwd, 'rev-parse', '--git-path', name); if (!p) throw new Error(`状态 ${name} 无法解析`); if (existsSync(isAbsolute(p) ? p : join(cwd, p))) result.inProgress.push(name); }
      if (range.files.length) { const markers = await this.call(cwd, ['grep', '-nE', '^(<<<<<<<|>>>>>>>)( |$)', '--', ...range.files]); if (markers.code !== 0 && markers.code !== 1) throw new Error('冲突标记核对失败'); result.conflictMarkers = markers.stdout; }
      result.branchOk = await this.git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD') === expectedBranch;
      result.pass = !result.missingCommits.length && !result.inProgress.length && !result.conflictMarkers && result.branchOk;
    } catch (e) { result.error = (e as Error).message; }
    return result;
  }
  /** No guessed replay: recognize an exact unique commit trailer or a registered worktree; ambiguous windows stay needs_review. */
  async recoverIntents() {
    const rows = this.d.store.sqlite.prepare("SELECT * FROM agent_intents WHERE state='intended' AND action IN ('auto_commit','child_result_commit','worktree_add')").all() as { intent_id: string; action: string; target_ref: string; head_before: string; task_id: string; expected_parent: string | null; result_json: string | null }[];
    for (const r of rows) {
      try {
        const meta = JSON.parse(r.result_json ?? '{}') as { attemptId?: string | null; workspaceId?: string; message?: string; kind?: string; childTaskId?: string };
        if (r.action === 'worktree_add') {
          const w = this.workspace(meta.childTaskId ?? ''); if (!w || w.path !== r.target_ref) throw new Error('工作副本登记缺失');
          const list = await this.git(w.repo_root, 'worktree', 'list', '--porcelain');
          const records = list.split('\n\n').map(t => Object.fromEntries(t.split('\n').map(l => { const i = l.indexOf(' '); return [l.slice(0, i), l.slice(i + 1)]; })));
          if (!records.some(x => resolve(x.worktree ?? '') === resolve(w.path) && x.branch === 'refs/heads/' + w.branch && x.HEAD === w.base_commit)) throw new Error('登记路径、分支或基准不同，未重复创建');
          if (!await this.d.recoverySafe?.(r.task_id)) throw new Error('原运行或业务尚未核实排空，保留准备状态');
          this.d.store.tx(() => { this.d.store.sqlite.prepare("UPDATE agent_workspaces SET state='ready',deps_result=COALESCE(deps_result,?),updated_at=? WHERE workspace_id=?").run(JSON.stringify({ state: 'unknown', reason: '宿主退出中断依赖准备，未自动重装；启动时须报告此限制' }), at(), w.workspace_id); this.finish(r.intent_id, 'done', { recovered: true, path: w.path }); });
        } else {
          if (!r.expected_parent || r.expected_parent !== r.head_before) throw new Error('意图的预期父提交缺失或不同');
          let head = await this.git(r.target_ref, 'rev-parse', 'HEAD');
          if ((await this.call(r.target_ref, ['merge-base', '--is-ancestor', r.expected_parent, head])).code !== 0) throw new Error('HEAD 已移离预期父提交，未自动重做');
          const lines = await this.git(r.target_ref, 'log', '--format=%H%x00%B%x00', '--fixed-strings', '--grep', `WillYou-Intent: ${r.intent_id}`, `${r.expected_parent}..HEAD`);
          let matches = lines.split('\0').reduce<string[]>((out, _x, i, a) => { if (i % 2 === 0 && a[i + 1]?.split('\n').includes(`WillYou-Intent: ${r.intent_id}`) && /^[a-f0-9]{40,64}$/.test(a[i].trim())) out.push(a[i].trim()); return out; }, []);
          const w = this.d.store.sqlite.prepare('SELECT * FROM agent_workspaces WHERE workspace_id=? AND path=?').get(meta.workspaceId ?? '', r.target_ref) as WorkspaceRow | undefined;
          if (!w || !meta.message || !['auto_before_delegate','child_result'].includes(meta.kind ?? '')) throw new Error('提交的固定工作副本或来源信息缺失');
          if (!matches.length && head === r.expected_parent && await this.git(w.path, 'status', '--porcelain=v1', '-uall') && await this.d.recoverySafe?.(r.task_id)) {
            await this.cleanBoundary(w.path); await this.effect(r.task_id,w.path,['add','-A']);
            await this.effect(r.task_id,w.path,['commit','-m',meta.message,'-m',`WillYou-Intent: ${r.intent_id}`]);
            head = await this.git(w.path, 'rev-parse', 'HEAD'); matches = [head];
          }
          if (matches.length !== 1 || await this.git(w.path, 'rev-parse', `${matches[0]}^`) !== r.expected_parent) throw new Error('提交意图无法唯一对应到预期父提交的真实提交');
          this.d.store.tx(() => { this.d.store.sqlite.prepare('INSERT OR IGNORE INTO agent_commit_provenance(commit_sha,workspace_id,attempt_id,intent_id,kind,message,created_at) VALUES(?,?,?,?,?,?,?)').run(matches[0], w.workspace_id, meta.attemptId ?? null, r.intent_id, meta.kind, meta.message, at()); this.finish(r.intent_id, 'done', { head: matches[0], recovered: true }); });
        }
      } catch (e) { this.finish(r.intent_id, 'needs_review', { error: (e as Error).message }); }
    }
  }
  async removeRegistered(workspaceId: string) {
    const w = this.d.store.sqlite.prepare('SELECT * FROM agent_workspaces WHERE workspace_id=?').get(workspaceId) as WorkspaceRow | undefined;
    const root = resolve(this.d.home, '.willyou/worktrees');
    if (!w || w.kind !== 'git_worktree' || !inside(root, w.path) || !existsSync(w.path) || lstatSync(w.path).isSymbolicLink() || !inside(realpathSync(root), realpathSync(w.path))) throw new DriverError('REJECTED', '仅清理登记根内的已登记工作副本');
    const list = await this.git(w.repo_root, 'worktree', 'list', '--porcelain');
    if (!list.split('\n\n').some(s => s.includes(`worktree ${w.path}\n`) && s.includes(`branch refs/heads/${w.branch}`))) throw new DriverError('STATE', 'Git 登记与工作副本不符，未清理');
    if (await this.git(w.path, 'merge-base', w.base_commit!, 'HEAD') !== w.base_commit) throw new DriverError('STATE', '工作副本基准已变化，未清理');
    await this.effect(w.child_task_id ?? w.task_id,w.repo_root,['worktree','remove',w.path]); // No --force, no branch deletion.
    this.d.store.sqlite.prepare("UPDATE agent_workspaces SET state='archived',updated_at=? WHERE workspace_id=?").run(at(), workspaceId);
  }
}
