from pathlib import Path
import json,hashlib
p=Path(__file__).resolve().parent;a=p/'attempt-P0OjQR';load=lambda f:json.loads(f.read_text());checks=load(a/'result.json')['checks'];assert len(checks)==12
for x in checks:
 assert x['status']=='passed' and x['watcherCount']==0 and x['toolCalls']==1
 d=a/x['id'];trace=[json.loads(v) for v in (d/'trace.jsonl').read_text().splitlines()];events=[v['event'] for v in trace];db=load(d/'cleanup-state.json')
 assert events.count('root-exit')==events.count('source-watch-opened')==events.count('source-watch-closed')==1
 assert db['run']['state']=='stopped' and all(v['state']=='released' for v in db['leases']) and all(v['state']=='finished' for v in db['activities'])
 assert all(v['state'] in ['exited','canceled'] for v in db['processes'])
 assert db['invocations'][0]['attempt_count']==1 and db['invocations'][0]['effect_state']=='read-only'
 if x['id'].endswith('-healthy'):
  assert x['proofCount']==1 and db['invocations'][0]['state']=='succeeded'
 else:
  assert x['proofCount']==0 and db['invocations'][0]['state']=='failed'
  assert 'source-handler-rejected' in events and 'source-verified-inside-business' not in events
 if x['id'].endswith('late-cancel'):
  assert events.index('source-read-held')<events.index('revoke')<events.index('pending-read-retains-activity-and-lease')<events.index('source-handler-rejected')
 if x['id'].endswith('late-deadline'):
  assert events.index('source-read-held')<events.index('source-deadline-triggered')<events.index('source-handler-rejected')
 if x['id'].endswith('replace-file'):
  v=next(v for v in trace if v['event']=='source-file-replaced-rejected');assert v['beforeInode']!=v['afterInode']
 if x['id'].endswith(('missing-deadline','replace-file','late-deadline')):
  assert next(v for v in trace if v['event']=='native-complete-with-business-state')['state']=='failed'
wait=load(p/'wait-results.json')['checks'];assert len(wait)==4 and all(x['status']=='passed' for x in wait)
baseline=Path('/Users/hx/projects/SmartDD/docs/里程碑/M14_统一Agent工作区/技研/实验/20261114_回合中输入来源与取消验证/sources.json');sources=load(baseline)
digest=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
for x in sources['sources']:
 f=Path('/Users/hx/projects')/x['repository']/x['path'];assert digest(f)==x['sha256']
for x in sources['dependencies']:assert digest(Path(x['path']))==x['sha256']
for x in load(Path('/private/tmp/willyou-m14-launch-bridge-probe/build.json'))['sources']:
 f=Path(x['path']).resolve()
 if str(f).startswith('/Users/hx/projects/SmartDD/'):assert digest(f)==x['sha256']
result={'nativeCases':12,'nativeProcessesClosed':12,'candidateWaitCases':4,'businessInvocations':{'succeeded':2,'failed':10,'effectState':'read-only','attemptCountEach':1},'watchersAndLeases':'released','sourceAndDependencyHashes':'unchanged','productAcceptance':'0/54 unchanged'}
(p/'audit-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
