import assert from 'node:assert/strict';

const attemptRoot=/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g04\/(?:attempt-\d{3}|a60-stale-child\/preflight-[A-Za-z0-9]+)\/runtime-[A-Za-z0-9_-]+$/;
const ref=/^[a-f0-9]{40}$/;

export function matchesStat({cwd,args,root,scope}) {
  assert.match(root,attemptRoot);
  if (!scope || !ref.test(scope.base) || !ref.test(scope.head)) return false;
  if (!scope.worktree?.startsWith(root+'/home/.willyou/worktrees/')) return false;
  return cwd===scope.worktree && args.length===4 && args[0]==='diff' &&
    args[1]==='--stat' && args[2]===scope.base && args[3]===scope.head;
}

export function targetNotices(before,after,modelRoutes,currentRun) {
  assert.equal(before.attempts.length,2);
  assert.equal(before.attempts[0].notified_at,null);
  assert.equal(after.attempts.length,2);
  const [old,fresh]=after.attempts;
  assert.equal(old.attempt_id,before.attempts[0].attempt_id);
  assert.equal(fresh.attempt_id,before.attempts[1].attempt_id);
  assert.ok(old.commit_range,'actual old Git completion must be persisted');
  assert.equal(old.notified_at,null,'obsolete child completion must not produce a notification');
  assert.ok(fresh.notified_at,'legal rework must generate its own notification');
  assert.deepEqual(after.notifications.map(row=>row.attemptId),[fresh.attempt_id]);
  assert.deepEqual(after.notifications.map(row=>row.status),['completed']);
  assert.deepEqual(after.turns,[{client_input_id:'result-'+fresh.attempt_id,run_id:currentRun,status:'completed'}]);
  assert.deepEqual(modelRoutes.map(row=>row.attemptOrdinal),[2]);
}
