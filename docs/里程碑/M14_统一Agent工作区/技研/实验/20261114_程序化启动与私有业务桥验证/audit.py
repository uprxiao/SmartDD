from pathlib import Path
import json,hashlib
p=Path(__file__).resolve().parent
rows=lambda f:[json.loads(x) for x in f.read_text().splitlines()]
a=p/'attempt-OewsB2';b=p/'attempt-rL37br';results=[]
for driver in ['claude','codex']:
 for mode in ['healthy','attach-rejected','cancel-before-attach','stop-in-flight','stop-during-auth']:
  attempt=a if mode=='healthy' else b;id=driver+'-'+mode;d=attempt/id
  result=next(x for x in json.loads((attempt/'result.json').read_text())['checks'] if x['id']==id);assert result['status']=='passed'
  t=rows(d/'trace.jsonl');events=[x['event'] for x in t];db=json.loads((d/'database-result.json').read_text());assert db['run']['state']=='stopped' and all(x['state']=='released' for x in db['leases']);assert all(x['state'] in ['exited','canceled'] for x in db['processes']);assert events.index('held-before-attach-verified')<events.index('root-exit')
  if mode in ['attach-rejected','cancel-before-attach']:
   assert 'native-gate-released' not in events and 'bridge-authenticated' not in events
   assert result['modelRequests']==result['toolCalls']==0
   if mode=='attach-rejected':assert next(x for x in t if x['event']=='gate-rejected')['message']=='原生进程身份未知，保留启动窗口与占用'
  else:
   assert events.index('owner-attached')<events.index('native-gate-released')<events.index('kernel-peer')
   peer=next(x for x in t if x['event']=='kernel-peer');assert any(x['pid']==db['run']['pid'] and x['startedAt']==db['run']['processStartedAt'] for x in peer['ancestors'])
   if mode=='stop-during-auth':
    assert 'bridge-authenticated' not in events and result['toolCalls']==result['modelRequests']==0
    held=next(x for x in t if x['event']=='stopped-root-pending-identity');assert held['run']['state']=='stopping' and held['leases']==[{'state':'active'}];assert any(x['kind']=='bridge' and x['state']=='armed' and x['pid'] is None for x in held['processes'])
    assert events.index('stopped-root-pending-identity')<events.index('peer-attach-rejected')<events.index('all-owned-closed-and-released')
   else:
    assert events.index('bridge-authenticated')<events.index('business-handler-entered')
    assert result['toolCalls']==1 and len(db['invocations'])==1 and db['invocations'][0]['attempt_count']==1
    if mode=='healthy':assert db['invocations'][0]['state']=='succeeded' and result['modelRequests']==2
    else:
     held=next(x for x in t if x['event']=='stopped-processes-live-business');assert held['run']['state']=='stopping' and held['leases']==[{'state':'active'}];assert all(x['state']=='exited' for x in held['processes']);assert any(x['state']=='active' for x in held['activities']);assert held['invocations'][0]['state']=='running';assert db['invocations'][0]['state']=='failed' and db['invocations'][0]['error_code']=='SCOPE_DENIED' and db['invocations'][0]['effect_state']=='read-only'
     errors=[x for x in t if x['event']=='model-request-rejected'];assert len(errors)==1 and errors[0]['code']=='SCOPE_DENIED' and errors[0]['runAborted'];assert result['modelRequests']==2
  results.append({'id':id,'attempt':attempt.name,'status':'passed'})
wrappers=0;native=0;bridges=0
for attempt in [a,b]:
 for d in attempt.iterdir():
  if not d.is_dir():continue
  t=rows(d/'trace.jsonl');events=[x['event'] for x in t];assert events.count('spawn-wrapper')==events.count('root-exit')==1;wrappers+=1;native+='native-gate-released' in events;bridges+='kernel-peer' in events
  cleanup=json.loads((d/'cleanup-state.json').read_text());assert cleanup['run']['state']=='stopped';assert all(x['state']=='released' for x in cleanup['leases'])
assert (wrappers,native,bridges)==(16,8,8)
for src in json.loads((p/'build.json').read_text())['sources']:assert hashlib.sha256(Path(src['path']).read_bytes()).hexdigest()==src['sha256'],src['path']
old=Path('/Users/hx/projects/SmartDD/docs/里程碑/M14_统一Agent工作区/技研/实验/20261114_运行所有权验证/additional-source-hashes.json')
for x in json.loads(old.read_text()):
 if x['path'].endswith('/process-identity') or x['path'].endswith('/process-identity.cc'):assert hashlib.sha256(Path(x['path']).read_bytes()).hexdigest()==x['sha256']
result={'distinctChecks':results,'rootWrappersClosed':wrappers,'nativeExecutions':native,'provedBridgeProcesses':bridges,'sourceHashes':'unchanged','reusedIdentityHelper':'matches earlier owner evidence','note':'Model requests can arrive after cancellation starts; second requests in stop-in-flight were rejected by the fake endpoint. Only one read operation occurred; not proof of instant network quiescence or real business write cancellation.'}
(p/'audit-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='distinctChecks'},ensure_ascii=False))
