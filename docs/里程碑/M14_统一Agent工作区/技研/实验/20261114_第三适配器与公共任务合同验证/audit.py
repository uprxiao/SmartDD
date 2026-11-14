from pathlib import Path
import json,sqlite3
p=Path(__file__).resolve().parent
load=lambda f:json.loads(f.read_text())
result=load(p/'attempt-wrpuAJ/result.json');assert len(result['checks'])==19 and not result.get('error')
assert all(x['status']=='passed' for x in result['checks'])
failed=load(p/'attempt-6NveYU/result.json');assert 'Missing expected rejection' in failed['error'] and len(failed['checks'])==18
summary=[]
for name in ['attempt-4dS2zi','attempt-HiaDRU','attempt-6NveYU','attempt-wrpuAJ']:
 a=p/name;state=load(a/'state.json');trace=load(a/'trace.json');created={x['nativeId'] for x in trace if x['op']=='create'};closed={x['nativeId'] for x in trace if x['op']=='close'}
 unmatched=created-closed;assert len(unmatched)==1
 x=next(x for x in trace if x['op']=='create' and x['nativeId'] in unmatched);assert x['workspace']=='isolated-open-failure'
 pairs=[d for d in state['delegations'].values() if d['parent'].startswith('pair-')];assert len(pairs)==9 and all(d['state']=='completed' and d['delivered'] for d in pairs)
 for d in pairs:
  assert state['tasks'][d['childId']]['history'][0]['source']=='agent-delegation'
  assert state['tasks'][d['parent']]['history'][0]['source']=='agent-result'
 con=sqlite3.connect(f'file:{a}/state.sqlite?mode=ro',uri=True);assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok';stored=json.loads(con.execute("SELECT body FROM host_state WHERE id='root'").fetchone()[0]);assert stored==state;con.close()
 summary.append({'attempt':name,'checks':len(load(a/'result.json')['checks']),'error':load(a/'result.json').get('error'),'nineFixturePairings':True,'createdRuntimeObjectsClosed':True,'openFailureBeforeRuntime':1})
host=(p/'host.mjs').read_text();assert not any(name in host.lower() for name in ['claude','codex','orbit'])
state=load(p/'attempt-wrpuAJ/state.json');assert state['tasks']['capability-race']['state']=='failed';assert state['tasks']['unknown']['state']=='recovery-required'
out={'finalChecksPassed':19,'attempts':summary,'databaseIntegrity':'ok','publicHostBrandBranches':'no fixture brand names; structural check only','scope':'Synthetic adapter/service contract evidence; no production or native execution'}
(p/'audit-result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items() if k!='attempts'},ensure_ascii=False))
