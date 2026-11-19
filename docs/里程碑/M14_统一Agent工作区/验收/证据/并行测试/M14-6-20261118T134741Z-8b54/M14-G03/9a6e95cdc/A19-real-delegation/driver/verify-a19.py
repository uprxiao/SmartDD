"""Read back A19 from the exact closed test database, omitting all model content."""
import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('attempt', type=Path)
parser.add_argument('candidate', type=Path)
parser.add_argument('--process-check', action='store_true')
args = parser.parse_args()
attempt = args.attempt.resolve(strict=True)
root = args.candidate.resolve(strict=True)
assert attempt.parent == root / 'g03' and re.fullmatch(r'attempt-\d{3}', attempt.name)
receipt_path = attempt / 'result.json'
receipt = json.loads(receipt_path.read_text())
assert receipt['passed'] is True and receipt['exit']['code'] == 0 and receipt['exit']['signal'] is None
assert not receipt.get('rendererErrors')
db = (Path(receipt['userData']) / 'smartdd.db').resolve(strict=True)
assert db.is_relative_to(attempt) and db.parent == Path(receipt['userData'])
for suffix in ('-wal', '-shm'):
    side = Path(str(db) + suffix)
    assert not side.exists() or side.stat().st_size == 0, 'Unexpected active SQLite state'
con = sqlite3.connect(db.as_uri() + '?immutable=1&mode=ro', uri=True)
con.row_factory = sqlite3.Row
def rows(sql, *parameters):
    return [dict(row) for row in con.execute(sql, parameters)]
def one(sql, *parameters):
    result = rows(sql, *parameters)
    assert len(result) == 1
    return result[0]
parent = receipt['realParentTaskId']
child = receipt['realChild']['id']
kind = receipt['phaseKind']
assert parent != child
dispatch = one("""SELECT d.delegation_id,d.parent_task_id,d.child_task_id,d.parent_run_id,d.access,d.result_revision,
                   d.delivery_state,a.attempt_id,a.child_turn_id,a.notified_at
                   FROM agent_delegations d JOIN agent_delegation_attempts a ON d.delegation_id=a.delegation_id
                   WHERE d.parent_task_id=? AND d.child_task_id=?""", parent, child)
assert dispatch['delivery_state'] == 'delivered' and dispatch['result_revision'] == 1
assert dispatch['notified_at']
turns = rows("""SELECT t.turn_id,t.task_id,t.run_id,t.native_turn_id,t.source_kind,t.status,
                b.binding_id,b.driver_id,b.profile_id,b.native_id,b.native_confirmed_at,b.cwd_identity,r.generation,r.state
                FROM agent_turns t JOIN capability_runs r ON r.run_id=t.run_id JOIN agent_bindings b ON r.binding_id=b.binding_id
                WHERE t.task_id IN (?,?) ORDER BY t.accepted_at,t.rowid""", parent, child)
assert len(turns) == 3 and all(t['status']=='completed' and t['native_confirmed_at'] for t in turns)
open_turn, child_turn, notify_turn = turns
assert [t['task_id'] for t in turns] == [parent,child,parent]
assert [t['source_kind'] for t in turns] == ['user','delegation','notification']
assert open_turn['run_id']==dispatch['parent_run_id'] and child_turn['turn_id']==dispatch['child_turn_id']
assert open_turn['binding_id']==notify_turn['binding_id'] and open_turn['native_id']==notify_turn['native_id']
assert open_turn['binding_id']!=child_turn['binding_id'] and open_turn['native_id']!=child_turn['native_id']
assert open_turn['profile_id']!=child_turn['profile_id']
assert child_turn['profile_id']==receipt['realChild']['profileId']
mapping={'claude':'claude-sdk','codex':'codex-app-server'}
assert (open_turn['driver_id'],child_turn['driver_id'])==(mapping[kind['parentKind']],mapping[kind['childKind']])
assert len({t['cwd_identity'] for t in turns})==1
notice = one("""SELECT item_id,ordinal,json_extract(payload_ref,'$.attemptId') AS attempt_id,
                json_extract(payload_ref,'$.status') AS status,json_array_length(payload_ref,'$.sourceItemIds') AS source_items
                FROM agent_items WHERE task_id=? AND type='notification'
                AND json_extract(payload_ref,'$.childTaskId')=? AND json_extract(payload_ref,'$.sourceKind')='child_result'""",parent,child)
assert notice['attempt_id']==dispatch['attempt_id'] and notice['status']=='completed' and notice['source_items']>0
assert one("SELECT COUNT(*) AS n FROM agent_items WHERE task_id=? AND turn_id=? AND type='assistant_message' AND ordinal>?",parent,notify_turn['turn_id'],notice['ordinal'])['n']>0
processes = rows("""SELECT p.run_id,p.kind,p.pid,p.process_started_at,p.state,p.ended_at
                    FROM capability_run_processes p JOIN capability_runs r ON r.run_id=p.run_id
                    WHERE r.task_id IN (?,?) ORDER BY p.rowid""",parent,child)
assert processes and all(p['state']=='exited' and p['ended_at'] and p['process_started_at'] for p in processes)
assert all({'cli','bridge'} <= {p['kind'] for p in processes if p['run_id']==t['run_id']} for t in turns)
if args.process_check:
    helper = root / 'package/mac-arm64/WillYou.app/Contents/Resources/native/willyou-process-identity'
    for process in processes:
        actual=json.loads(subprocess.check_output([helper,str(process['pid'])], text=True, timeout=3))
        assert actual['state']=='stopped' or (actual['state']=='running' and actual['startedAt']!=process['process_started_at'])
with db.open('rb') as f:
    db_hash=hashlib.file_digest(f,'sha256').hexdigest()
print(json.dumps({'commit':receipt['sourceCommit'],'asar':receipt['asar'],'case':attempt.name,'databaseSha256':db_hash,
    'turns':turns,'notice':notice,'dispatch':dispatch,'processes':processes,'birthProbes':args.process_check},
    ensure_ascii=False,indent=2))
