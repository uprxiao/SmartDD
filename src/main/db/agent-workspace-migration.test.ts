import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { bundledMigrations, runBundledMigrations, runMigrations } from './migrations';

// M14-A64：新表升级保留旧运行原值，新运行必须带完整绑定关系（技术方案 T1.5 §2）。
const open: Database.Database[] = [];
function db(): Database.Database { const d = new Database(':memory:'); d.pragma('foreign_keys=ON'); open.push(d); return d; }
afterEach(() => open.splice(0).forEach(d => d.close()));
const at = '2026-11-17T00:00:00Z';
const h = (c: string) => c.repeat(64);

function seedNewTask(d: Database.Database, task = 't1', binding = 'b1') {
  d.prepare("INSERT INTO tasks(id,cwd,runner,title,created_at,updated_at) VALUES(?,'/w','claude','新任务',1,1)").run(task);
  d.prepare("INSERT INTO agent_tasks(task_id,selection_json,created_at,updated_at) VALUES(?,'{}',?,?)").run(task, at, at);
  d.prepare("INSERT INTO agent_bindings(binding_id,task_id,driver_id,profile_id,continuation_hash,state_root,cwd_identity,created_at) VALUES(?,?,'claude-sdk','p',?,'/s','/w',?)").run(binding, task, h('a'), at);
}
const insertRun = (d: Database.Database, run: string, task: string, binding: string | null, driver: string | null, generation: number | null) =>
  d.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,binding_id,driver_id,generation) VALUES(?,?,'p','claude','running',?,?,?,?)").run(run, task, at, binding, driver, generation);

it('keeps legacy run rows byte-for-byte and leaves foreign keys consistent', () => {
  const d = db(), all = bundledMigrations();
  runMigrations(d, all.slice(0, 37));
  d.exec("INSERT INTO capability_session_snapshots VALUES('old-task',2,'snapshot bytes','old-hash',?,'created','active')".replace('?', `'${at}'`));
  d.exec(`INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,snapshot_hash,pty_id,bindings_json) VALUES('old-run','old-task','p','codex','stopped','${at}','old-hash','pty-1','[{"x":1}]')`);
  const before = d.prepare('SELECT * FROM capability_runs').all() as object[];
  expect(runBundledMigrations(d)).toEqual(['0037_agent_workspace','0038_agent_resource_cleanup','0039_agent_task_pin']);
  expect(d.prepare('SELECT * FROM capability_runs').all()).toEqual(before.map(r => ({ ...r, binding_id: null, capability_session_id: null, generation: null, driver_id: null, launch_plan_hash: null })));
  expect(d.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  // 子表仍引用 capability_runs（重建后名称不变）
  expect(d.prepare("SELECT sql FROM sqlite_master WHERE name='capability_run_processes'").get()).toMatchObject({ sql: expect.stringContaining('REFERENCES capability_runs(run_id)') });
});

it('replays without rebuilding twice when the watermark is lost after commit', () => {
  const d = db();
  runBundledMigrations(d);
  seedNewTask(d);
  insertRun(d, 'r1', 't1', 'b1', 'claude-sdk', 1);
  d.prepare('DELETE FROM __drizzle_migrations WHERE created_at>=?').run(bundledMigrations()[38].when);
  expect(runBundledMigrations(d)).toEqual(['0038_agent_resource_cleanup','0039_agent_task_pin']);
  expect(d.prepare('SELECT run_id,binding_id,generation FROM capability_runs').all()).toEqual([{ run_id: 'r1', binding_id: 'b1', generation: 1 }]);
});

it('requires a complete binding for new runs and a snapshot for legacy runs', () => {
  const d = db();
  runBundledMigrations(d);
  seedNewTask(d);
  seedNewTask(d, 't2', 'b2');
  expect(() => insertRun(d, 'legacy-no-snapshot', 'ghost', null, null, null)).toThrow(/旧运行须有单任务快照/);
  expect(() => insertRun(d, 'wrong-task', 't2', 'b1', 'claude-sdk', 1)).toThrow(/任务与绑定不一致/);
  expect(() => insertRun(d, 'wrong-driver', 't1', 'b1', 'codex-app-server', 1)).toThrow(/任务与绑定不一致/);
  expect(() => insertRun(d, 'no-generation', 't1', 'b1', 'claude-sdk', null)).toThrow(/CHECK/);
  insertRun(d, 'r1', 't1', 'b1', 'claude-sdk', 1);
  expect(() => insertRun(d, 'same-generation', 't1', 'b1', 'claude-sdk', 1)).toThrow(/UNIQUE/);
  insertRun(d, 'r2', 't1', 'b1', 'claude-sdk', 2);
  expect(() => d.prepare("UPDATE capability_runs SET task_id='t2' WHERE run_id='r1'").run()).toThrow(/运行归属不可修改/);
  expect(() => d.prepare("UPDATE capability_runs SET generation=3 WHERE run_id='r1'").run()).toThrow(/运行归属不可修改/);
  d.prepare("UPDATE capability_runs SET state='exited' WHERE run_id='r1'").run();
  // 能力会话必须属于同一绑定
  d.prepare("INSERT INTO agent_capability_sessions VALUES('cs2','b2',1,?,'{}',?)").run(h('b'), at);
  expect(() => d.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,binding_id,driver_id,generation,capability_session_id) VALUES('r3','t1','p','claude','running',?,'b1','claude-sdk',3,'cs2')").run(at)).toThrow(/能力会话不属于该绑定/);
});

it('enforces request class, goal and native identity constraints', () => {
  const d = db();
  runBundledMigrations(d);
  seedNewTask(d);
  const req = (id: string, cls: string, status: string, op: string | null) =>
    d.prepare("INSERT INTO agent_requests(request_id,task_id,class,origin_json,kind,payload_ref,status,operation_id,created_at,updated_at) VALUES(?,?,?,'{}','approval','p',?,?,?,?)").run(id, 't1', cls, status, op, at, at);
  req('n1', 'native', 'pending', null);
  expect(() => req('n2', 'native', 'approved_pending_bind', null)).toThrow(/CHECK/);
  expect(() => req('n3', 'native', 'pending', 'op')).toThrow(/CHECK/);
  req('h1', 'host_business', 'approved_pending_bind', 'op');
  expect(() => d.prepare("INSERT INTO agent_goals(task_id,binding_id,objective,status,paused_reason,updated_at) VALUES('t1','b1','x','active','user',?)").run(at)).toThrow(/CHECK/);
  d.prepare("INSERT INTO agent_goals(task_id,binding_id,objective,status,paused_reason,updated_at) VALUES('t1','b1','x','paused','waiting_children',?)").run(at);
  d.prepare("UPDATE agent_bindings SET native_id='n-1',native_confirmed_at=? WHERE binding_id='b1'").run(at);
  d.prepare("INSERT INTO agent_bindings(binding_id,task_id,driver_id,profile_id,continuation_hash,state_root,cwd_identity,created_at) VALUES('b3','t1','claude-sdk','p',?,'/s','/w',?)").run(h('a'), at);
  expect(() => d.prepare("UPDATE agent_bindings SET native_id='n-1' WHERE binding_id='b3'").run()).toThrow(/UNIQUE/);
  expect(() => d.prepare("UPDATE agent_bindings SET native_confirmed_at=? WHERE binding_id='b3'").run(at)).toThrow(/CHECK/);
});
