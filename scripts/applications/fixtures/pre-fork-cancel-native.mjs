// TQ: a private gate after original arming, before the original TaskService OS fork.
// The PTY observer delegates unchanged; no native exit or process identity is invented.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

export async function checkPreForkCancel({ app, result, root, userData, task, project, probe, poll, checked }) {
  const q = JSON.stringify;
  const e = result.preForkCancel = {
    startedAt: new Date().toISOString(), cases: [], phase: 'setup',
    layer: 'Packaged TaskService/RPC + private post-arming gate; real PTY/Codex/MCP recovery; no SMTP/credentials, 0 UI claims',
  };
  const sql = text => JSON.parse(execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', join(userData, 'smartdd.db'), text], { encoding: 'utf8' }) || '[]');
  const runs = () => sql("SELECT run_id,state,revocation_state,pid FROM capability_runs WHERE task_id='" + task.id + "' ORDER BY started_at");
  const fixed = () => Object.fromEntries(['capability_session_snapshots', 'capability_session_refs', 'capability_session_identities'].map(table => [table, sql('SELECT * FROM ' + table + " WHERE task_id='" + task.id + "' ORDER BY rowid")]));
  const note = name => { e.cases.push({ name, at: new Date().toISOString() }); checked('TQ: ' + name); };
  const stop = async () => {
    await app.invoke('tasks.kill', task.id);
    await poll(() => runs().every(run => run.state === 'stopped' && run.revocation_state === 'revoked'), 30000);
  };
  let pending, installed = false;
  try {
    await stop();
    e.original = await app.invoke('tasks.get', task.id);
    assert(e.original.nativeSessionId);
    e.fixedBefore = fixed();
    e.draftsBefore = sql('SELECT * FROM mail_drafts ORDER BY id');
    e.revisionsBefore = sql('SELECT * FROM mail_draft_revisions ORDER BY draft_id,revision');
    await app.mainEvaluate(`(() => {
      const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
      const s=globalThis.__ncHistoryProbe?.service,t=s?.options.tasks,m=t?.d.managedCapabilities,p=t?.d.ptys;
      if(E.app.getPath('userData')!==${q(userData)}||s?.store.root!==${q(join(userData, 'capabilities'))}||!m||!p)throw Error('TQ own service only');
      const g={t,m,p,taskId:${q(task.id)},next:null,held:null,release:null,spawns:[],forbidden:[],crypto:[]};
      g.originalPrepare=m.prepare;g.originalSpawn=p.spawn;
      g.prepare=async function(...args){
        const launch=await g.originalPrepare.apply(this,args);
        if(args[0].taskId===g.taskId&&g.next){
          const phase=g.next;g.next=null;const before=launch.beforeSpawn.bind(launch);
          launch.beforeSpawn=async()=>{await before();g.held={phase,ptyId:launch.ptyId};await new Promise(resolve=>g.release=resolve);g.held=null;g.release=null;if(phase==='prepare-error')throw Error('TQ controlled pre-fork preparation failure');};
        }
        return launch;
      };
      g.spawn=function(...args){g.spawns.push({id:args[0].id,at:new Date().toISOString()});return g.originalSpawn.apply(this,args);};
      m.prepare=g.prepare;p.spawn=g.spawn;
      for(const key of ['isEncryptionAvailable','encryptString','decryptString']){g.crypto.push([key,E.safeStorage[key]]);E.safeStorage[key]=()=>{g.forbidden.push(key);throw Error('TQ no credentials');};}
      g.state=()=>({held:g.held,spawnCount:g.spawns.length,opening:t.opening.has(g.taskId),launching:t.launching.has(g.taskId),busy:t.runningInProject(${q(project.id)}),closed:t.closed});
      g.restore=()=>{if(g.release)throw Error('TQ gate still active');if(m.prepare!==g.prepare||p.spawn!==g.spawn)throw Error('TQ hook owner changed');m.prepare=g.originalPrepare;p.spawn=g.originalSpawn;for(const[key,fn]of g.crypto)E.safeStorage[key]=fn;return{prepareRestored:m.prepare===g.originalPrepare,spawnRestored:p.spawn===g.originalSpawn,cryptoRestored:g.crypto.every(([key,fn])=>E.safeStorage[key]===fn),forbidden:g.forbidden,spawns:g.spawns};};
      globalThis.__tqPreFork=g;return true;
    })()`);
    installed = true;
    for (const phase of ['cancel', 'prepare-error', 'host-shutdown']) {
      e.phase = phase;
      const before = runs(), record = { phase, before, at: new Date().toISOString() };
      e[phase] = record;
      await app.mainEvaluate('globalThis.__tqPreFork.next=' + q(phase));
      pending = app.invoke('tasks.open', { taskId: task.id, cols: 100, rows: 30 }).then(value => ({ resolved: true, value }), error => ({ resolved: false, error: String(error) }));
      await poll(() => app.mainEvaluate('!!globalThis.__tqPreFork.held'), 15000);
      record.held = await app.mainEvaluate('globalThis.__tqPreFork.state()');
      assert(record.held.launching && record.held.opening);
      const created = runs().filter(run => !before.some(old => old.run_id === run.run_id));
      assert.equal(created.length, 1);
      record.runId = created[0].run_id;
      record.processesBefore = sql("SELECT kind,state,pid FROM capability_run_processes WHERE run_id='" + record.runId + "' ORDER BY kind");
      assert.deepEqual(record.processesBefore, [{ kind: 'bridge', state: 'armed', pid: null }, { kind: 'cli', state: 'armed', pid: null }]);
      if (phase === 'cancel') await app.invoke('tasks.kill', task.id);
      if (phase === 'host-shutdown') await app.mainEvaluate('globalThis.__tqPreFork.t.dispose();true');
      await app.mainEvaluate('globalThis.__tqPreFork.release();true');
      record.outcome = await pending;
      pending = null;
      assert.equal(record.outcome.resolved, false);
      assert(record.outcome.error.includes(phase === 'prepare-error' ? 'TQ controlled pre-fork preparation failure' : '取消'));
      await poll(() => runs().every(run => run.state === 'stopped' && run.revocation_state === 'revoked'), 15000);
      record.after = await app.mainEvaluate('globalThis.__tqPreFork.state()');
      assert.equal(record.after.spawnCount, record.held.spawnCount);
      assert.equal(record.after.busy, 0);
      record.processesAfter = sql("SELECT kind,state,pid FROM capability_run_processes WHERE run_id='" + record.runId + "' ORDER BY kind");
      assert.deepEqual(record.processesAfter, [{ kind: 'bridge', state: 'canceled', pid: null }, { kind: 'cli', state: 'canceled', pid: null }]);
      assert.equal(sql("SELECT COUNT(*) n FROM capability_resource_leases WHERE state<>'released'")[0].n, 0);
      assert.deepEqual(fixed(), e.fixedBefore);
      assert.equal(runs().length, before.length + 1);
      note(phase + ': no OS fork, original armed windows canceled, revocation completes, leases released, fixed session retained');
      if (phase === 'prepare-error') {
        e.phase = 'explicit-recovery';
        const recovered = await app.invoke('tasks.open', { taskId: task.id, cols: 100, rows: 30 });
        assert.equal(recovered.task.nativeSessionId, e.original.nativeSessionId);
        assert.equal(recovered.task.stateRoot, e.original.stateRoot);
        await poll(async () => { const s = await app.invoke('applications.session', task.id); return s.ok && s.value.currentRun?.bridge.connected; }, 20000);
        assert.deepEqual(fixed(), e.fixedBefore);
        note('explicit recovery starts real CLI/bridge with original native ID/stateRoot/S after both canceled launches');
        const p = probe.select('tq-restored-read', { draftId: result.createdDraft.id }, 'smartdd_mail_draft_get_v1');
        const prompt = p.token + ': Read the original local draft once. No writes or sending.';
        await app.evaluate('window.electronAPI.eventSend("pty:input",' + q({ taskId: task.id, ptyId: recovered.ptyId, data: prompt }) + ');true');
        await poll(async () => (await app.output(recovered.ptyId)).includes(p.token), 10000);
        await app.evaluate('window.electronAPI.eventSend("pty:input",' + q({ taskId: task.id, ptyId: recovered.ptyId, data: '\r' }) + ');true');
        await poll(async () => p.done && (await app.output(recovered.ptyId)).includes(p.doneToken), 30000);
        assert.equal(p.value.draft.id, result.createdDraft.id);
        e.read = p; probe.clear(p);
        await stop();
        assert.deepEqual(sql('SELECT * FROM mail_drafts ORDER BY id'), e.draftsBefore);
        assert.deepEqual(sql('SELECT * FROM mail_draft_revisions ORDER BY draft_id,revision'), e.revisionsBefore);
        note('recovered real Codex/MCP returns original local draft; actual stop closes CLI/bridge without writes');
      }
    }
    e.finalRuns = runs();
    e.status = 'passed';
  } catch (error) {
    e.status = 'failed'; e.error = String(error); e.failureRuns = runs(); throw error;
  } finally {
    probe.clearAll();
    if (installed) {
      try { await app.mainEvaluate('globalThis.__tqPreFork.release?.();true'); if (pending) e.pendingOutcome = await pending; await stop(); } catch (error) { e.cleanupError = String(error); }
      e.guard = await app.mainEvaluate('globalThis.__tqPreFork.restore()');
      assert(e.guard.prepareRestored && e.guard.spawnRestored && e.guard.cryptoRestored && !e.guard.forbidden.length);
    }
    e.finishedAt = new Date().toISOString();
    await writeFile(join(root, 'pre-fork-cancel-final.json'), JSON.stringify(e, null, 2) + '\n');
  }
}
