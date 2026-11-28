'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2]);
const mode = process.argv[3];
assert(['current', 'full-reuse', 'projected'].includes(mode));
const Database = createRequire(path.join(root, 'package.json'))('better-sqlite3');
const source = fs.readFileSync(path.join(root, 'src/main/core/agent/agent-store.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'drizzle/0037_agent_workspace.sql'), 'utf8');
const oldSql = source.match(/  turns\(taskId: string\) \{\s+return this\.sqlite\.prepare\('([^']+)'\)/)[1];
const newSql = source.match(/  turnStatusSummary\(taskId: string\) \{[\s\S]*?`(SELECT EXISTS[\s\S]*?)`/)[1];
const ddl = migration.match(/CREATE TABLE IF NOT EXISTS agent_turns \([\s\S]*?\n\);/)[0];
const index = migration.match(/CREATE INDEX IF NOT EXISTS agent_turns_run_idx ON agent_turns\(run_id\);/)[0];
const db = new Database(':memory:');
db.pragma('foreign_keys=ON');
db.exec('CREATE TABLE agent_tasks(task_id TEXT PRIMARY KEY);CREATE TABLE capability_runs(run_id TEXT PRIMARY KEY);' + ddl + index);
const insertTask = db.prepare('INSERT INTO agent_tasks(task_id) VALUES(?)');
const insertTurn = db.prepare('INSERT INTO agent_turns(turn_id,task_id,client_input_id,input_ref,source_kind,status,accepted_at) VALUES(?,?,?,?,?,?,?)');
const update = db.prepare('UPDATE agent_turns SET status=?,ended_at=? WHERE turn_id=?');
const taskIds = Array.from({ length: 5 }, (_, i) => 'synthetic-task-' + i);
const fixture = new Map(taskIds.map(task => { insertTask.run(task); return [task, []]; }));
const statusNames = ['accepted', 'dispatching', 'started', 'completed', 'failed', 'interrupted', 'unknown', 'canceled'];

function summarize(rows) {
  const last = rows.filter(row => row.status !== 'canceled').at(-1);
  return {
    has_active: Number(rows.some(row => ['accepted', 'dispatching', 'started'].includes(row.status))),
    has_running: Number(rows.some(row => ['dispatching', 'started'].includes(row.status))),
    turn_id: last?.turn_id ?? null,
    status: last?.status ?? null,
  };
}

let statement;
let prepares = 0, queries = 0, rowsOut = 0, cellsOut = 0, queryMs = 0;
function check(task) {
  const start = performance.now();
  if (!statement || mode === 'current') {
    statement = db.prepare(mode === 'projected' ? newSql : oldSql);
    prepares++;
  }
  let actual;
  if (mode === 'projected') {
    actual = statement.get({ taskId: task });
    rowsOut++;
    cellsOut += Object.keys(actual).length;
  } else {
    const rows = statement.all(task);
    rowsOut += rows.length;
    cellsOut += rows.length * 10;
    actual = summarize(rows);
  }
  queryMs += performance.now() - start;
  queries++;
  assert.deepEqual(actual, summarize(fixture.get(task)));
}

function observe(phase) {
  return { phase, queries, prepares, rowsOut, cellsOut, queryMs, ...process.memoryUsage() };
}

async function main() {
  const observations = [observe('initial')];
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < taskIds.length; i++) {
      const task = taskIds[i];
      const turn = task + '-turn-' + round;
      // Same accepted_at for pairs exercises the original rowid tiebreaker.
      const at = new Date(1800000000000 + Math.floor(round / 2) * 1000).toISOString();
      const state = { turn_id: turn, status: statusNames[(round + i) % 3] };
      insertTurn.run(turn, task, 'input-' + round, 'synthetic', 'user', state.status, at);
      fixture.get(task).push(state);
      check(task);
      state.status = statusNames[3 + ((round + i) % 5)];
      update.run(state.status, at, turn);
      check(task);
      await new Promise(resolve => setImmediate(resolve));
    }
    for (const task of taskIds) check(task);
    await new Promise(resolve => setImmediate(resolve));
    observations.push(observe('round-' + (round + 1)));
  }
  assert.equal(queries, 120);
  for (let i = 0; i < 864; i++) {
    check(taskIds[i % taskIds.length]);
    if (i % 24 === 0) await new Promise(resolve => setImmediate(resolve));
  }
  observations.push(observe('illustrative-864-extra-status-reads'));
  assert.equal(queries, 984);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_turns').get().n, 40);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  db.close();
  const digest = text => createHash('sha256').update(text).digest('hex');
  console.log(JSON.stringify({
    mode,
    electron: process.versions.electron,
    oldQuerySha256: digest(oldSql),
    newQuerySha256: digest(newSql),
    fixture: 'Five synthetic tasks, eight turns apiece, 120 illustrative live queries, 864 further fixed-history queries. No observed App invocation count inferred.',
    forcedGC: false,
    observations,
  }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
