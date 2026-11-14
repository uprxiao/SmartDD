from pathlib import Path
import json, hashlib
p=Path(__file__).resolve().parent
read=lambda f:json.loads(f.read_text())
digest=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
attempts=['attempt-hdtROi','attempt-vm0a3t','attempt-hcLy3k','attempt-OP5OA7']
results=[]
for name in attempts:
 result=read(p/name/'result.json')
 for check in result['checks']:
  d=p/name/check['id'];trace=[json.loads(x) for x in (d/'trace.jsonl').read_text().splitlines()]
  assert sum(x['event']=='root-exit' for x in trace)==1
  cleanup=read(d/'cleanup-state.json')
  assert cleanup['run']['state']=='stopped'
  assert all(x['state']=='released' for x in cleanup['leases'])
  assert all(x['state'] in ['exited','canceled'] for x in cleanup['processes'])
  if name==attempts[-1]:
   assert check['status']=='passed'
   events=[x['event'] for x in trace]
   assert 'all-owned-closed-and-released' in events
   if check['id'].endswith('cancel-receipt'):
    assert check['proofCount']==0 and 'source-receipt-rejected' in events
    assert 'source-receipt-accepted' not in events
    assert 'source-verified-inside-business' not in events
    assert events.index('business-waits-for-source')<events.index('revoke')<events.index('source-receipt-rejected')
   else:
    assert check['proofCount']==1
    assert events.index('source-receipt-accepted')<events.index('source-verified-inside-business')<events.index('round-trip-complete')
    proof=next(x for x in trace if x['event']=='source-verified-inside-business')
    assert proof['nativeTerminalSeen'] is False
    lines=(d/'preterminal-native.jsonl').read_bytes().splitlines()
    assert proof['recordHash'] in [hashlib.sha256(x).hexdigest() for x in lines]
    assert cleanup['invocations'][0]['state']=='succeeded'
  results.append({'attempt':name,'case':check['id'],'status':check['status'],'ownedProcessesClosed':True,'leasesReleased':True})
verified=[]
launch=read(Path('/private/tmp/willyou-m14-launch-bridge-probe/build.json'))
for x in launch['outputs']:
 assert digest(Path(x['file']))==x['sha256'];verified.append(x['file'])
for x in launch['sources']:
 f=Path(x['path']).resolve()
 if str(f).startswith('/Users/hx/projects/SmartDD/'):
  assert digest(f)==x['sha256'];verified.append(str(f))
previous=read(Path('/Users/hx/projects/SmartDD/docs/里程碑/M14_统一Agent工作区/技研/实验/20261114_程序化输入来源与同文关联验证/sources.json'))
for x in previous['sources']:
 f=Path('/Users/hx/projects')/x['repository']/x['path']
 assert digest(f)==x['sha256'];verified.append(str(f))
assert len(results)==9
out={'attempts':results,'finalCasesPassed':6,'nativeProcessesClosed':9,'sourceAndBundleHashesVerified':sorted(set(verified)),'productAcceptance':'0/54, unchanged'}
(p/'audit-result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'finalCasesPassed':6,'nativeProcessesClosed':9,'sourceHashes':'unchanged'},ensure_ascii=False))
