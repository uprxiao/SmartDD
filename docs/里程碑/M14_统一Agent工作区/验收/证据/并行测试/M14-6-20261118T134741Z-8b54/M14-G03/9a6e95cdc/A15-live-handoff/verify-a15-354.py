import hashlib,json,sqlite3,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve(strict=True)
attempt=root/'g03/attempt-354'
e=attempt/'result.json'
r=json.loads(e.read_text())
assert r['exitEvidenceError']=='AssertionError [ERR_ASSERTION]: Native CLI process birth is missing'
assert not r.get('failure') and not r.get('transportError') and not r.get('cleanupError')
assert r['exit']=={'pid':13958,'code':0,'signal':None} and r['rendererErrors']==[]
assert r['listenerClosed'] and r['socketsRemaining']==0
assert len(r['turns'])==len(r['timeline'])==len(r['requests'])==6
v=r['fixtureFacts']
expected=[f"A={v['A']}",f"A={v['A']} B={v['B']}",f"A={v['A']} B={v['B']} C={v['C']}",
          f"A={v['A']} B={v['B']} C={v['C']} D={v['D']}",'E=UNKNOWN',f"A={v['A']} B={v['B']} D=UNKNOWN"]
assert [t['exactAnswer'] for t in r['turns']]==expected
assert [t['transfer']['kind'] if t['transfer'] else None for t in r['turns']]==[None,'full','incremental','incremental',None,'incremental']
assert r['timeline'][-1]['switchLines']==['此处切换到 A15 fixture '+x for x in ('claude','codex','claude','codex')]
assert all(req['upstreamStatus']==200 for req in r['requests'])
stop=r['requests'][-1]
assert stop['withheldId']==stop['newlyInjectedId']==r['turns'][-1]['transfer']['transfer_id']
assert stop['introducedNewFact'] and stop['forwardedFactNames']==['A','B','C'] and stop['inputSha256']!=stop['forwardedSha256']
p=(Path(r['data'])/'smartdd.db').resolve(strict=True)
assert p.is_relative_to(attempt)
wal=Path(str(p)+'-wal')
assert not wal.exists() or wal.stat().st_size==0
db=sqlite3.connect(p.as_uri()+'?immutable=1&mode=ro',uri=True)
db.row_factory=sqlite3.Row
turns=[dict(t) for t in db.execute("""SELECT turn_id,native_turn_id,run_id,status,source_kind FROM agent_turns
WHERE task_id=? ORDER BY rowid""",(r['taskId'],))]
assert len(turns)==6
for saved,turn in zip(r['turns'],turns):
    assert turn.pop('source_kind')=='user'
    assert turn=={key:saved['turn'][key] for key in turn}
    answer=db.execute("""SELECT json_extract(payload_ref,'$.text') FROM agent_items
      WHERE turn_id=? AND type='assistant_message' ORDER BY ordinal DESC LIMIT 1""",(turn['turn_id'],)).fetchone()[0]
    assert answer.strip()==saved['exactAnswer']
    if saved['transfer']:
        transfer=db.execute('SELECT delivery_state,kind,payload_hash FROM agent_transfers WHERE transfer_id=?',
            (saved['transfer']['transfer_id'],)).fetchone()
        assert tuple(transfer)==('accepted',saved['transfer']['kind'],saved['transfer']['payload_hash'])
rows=[dict(x) for x in db.execute("""SELECT r.run_id,r.pid,r.process_started_at,r.generation,r.owner_pid,r.owner_started_at,r.state,r.binding_id,
 b.driver_id,b.native_id,b.native_confirmed_at FROM capability_runs r JOIN agent_bindings b ON r.binding_id=b.binding_id
 WHERE r.task_id=? ORDER BY r.rowid""",(r['taskId'],))]
assert len(rows)==5 and len({row['binding_id'] for row in rows})==2
reader=root/'package/mac-arm64/WillYou.app/Contents/Resources/native/willyou-process-identity'
def observed(pid,birth):
    assert pid and re.fullmatch(r'darwin-proc-v1:\d+:\d+',birth)
    now=json.loads(subprocess.check_output([reader,str(pid)],text=True,timeout=3))
    assert now['state']=='stopped' or (now['state']=='running' and now['startedAt']!=birth)
    return now['state']
import re
app_state=observed(r['appBirth']['pid'],r['appBirth']['startedAt'])
for row in rows:
    assert row['state']=='stopped' and row['native_confirmed_at']
    assert (row['owner_pid'],row['owner_started_at'])==(r['appBirth']['pid'],r['appBirth']['startedAt'])
    row['rootObserved']=observed(row['pid'],row['process_started_at'])
    row['registeredProcesses']=[dict(rec) for rec in db.execute('SELECT kind,pid,process_started_at,state FROM capability_run_processes WHERE run_id=?',(row['run_id'],))]
    for process in row['registeredProcesses']:
        assert process['state']=='exited'
        process['observed']=observed(process['pid'],process['process_started_at'])
assert sum(len(row['registeredProcesses']) for row in rows)==6
print(json.dumps({'sourceCommit':r['sourceCommit'],'asar':r['asar'],'originalResultSha256':hashlib.sha256(e.read_bytes()).hexdigest(),
    'businessChecks':'All six actual outcomes, persisted 4 transfers, exact omitted final fact and unchanged binding identities',
    'nativeRuns':rows,'app':{'pid':r['exit']['pid'],'observed':app_state,'exit':r['exit']},
    'closedListener':r['listenerClosed'],'finalForwardedFacts':stop['forwardedFactNames'],'answer':expected[-1]},ensure_ascii=False,indent=2))
