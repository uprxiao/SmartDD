#!/usr/bin/env python3
"""Independent existing-native-output judge. No OS/API/process execution."""
import json
from pathlib import Path
R=Path(__file__).resolve().parent

def main():
 events=[];errors=[]
 for n,line in enumerate((R/'native-stdout.jsonl').read_text().splitlines(),1):
  try:events.append(json.loads(line))
  except Exception as exc:errors.append({'line':n,'error':str(exc)})
 execution=json.loads((R/'execution.json').read_text());cleanup=json.loads((R/'cleanup.json').read_text())
 checks=[]
 def check(name,passed,data):checks.append({'id':name,'passed':bool(passed),'evidence':data})
 def one(kind,label=None):
  rows=[x for x in events if x.get('kind')==kind and (label is None or x.get('label')==label)]
  if len(rows)!=1:raise ValueError('nonunique %s/%s'%(kind,label))
  return rows[0]
 def snap(label):return one('snapshot',label)
 def listed(label):return one('child-list',label)
 def pids(x):return sorted({p for p in x['slots'][:x['capacityPids']] if p>0})
 def childraw(x):return x['v2']['childUser']+x['v2']['childSystem']
 check('RAW-JSON',not errors,errors)
 check('COMPILE-GATE',execution['compiler'].get('returnCode')==0,execution['compiler'])
 check('NATIVE-NORMAL-EXIT',execution['probe'].get('returnCode')==0 and not execution['probe'].get('terminationByRunner',True),execution['probe'])
 complete=[x for x in events if x.get('kind')=='complete'];fatal=[x for x in events if x.get('kind')=='error']
 check('BOTH-GROUPS-COMPLETE',len(complete)==1 and complete[0].get('groups')==2 and not fatal,{'complete':complete,'errors':fatal})
 check('EXACT-CLEANUP',cleanup.get('exactOwnedIdentitiesClear') is True and not cleanup.get('errors'),cleanup)
 observed={};capability=False
 try:
  a=snap('A-live')['targetPid'];b=snap('B-live')['targetPid'];abi=one('abi');live=listed('two-live-full');short=listed('two-live-one-slot');zero=listed('two-live-zero-bytes')
  check('KNOWN-LIVE-CHILDREN-IN-FULL-LIST',pids(live)==sorted([a,b]),live)
  candidates=[]
  if live['returnValue']==len(pids(live)):candidates.append('pid-count')
  if live['returnValue']==len(pids(live))*abi['pidSize']:candidates.append('bytes-written')
  check('RETURN-UNIT-DETERMINED',len(candidates)==1,{'candidates':candidates,'fullRaw':live})
  inventory=[x for x in events if x.get('kind')=='child-list']
  guards=all(x['guardBeforeIntact'] and x['guardAfterIntact'] and all(v==-777777 for v in x['slots'][x['capacityPids']:]) for x in inventory)
  check('REQUESTED-BYTE-BOUNDARY-RESPECTED',guards,inventory)
  check('TRUNCATION-IS-NOT-COMPLETE-INVENTORY',len(pids(short))<2 and set(pids(short))<={a,b} and short['capacityPids']==1,short)
  terminated=one('terminated-unreaped-observed');u=listed('A-unreaped-B-live-full');waited=listed('A-waited-B-live-full')
  check('REAL-WNOWAIT-BOUNDARY',terminated['pid']==a and terminated['siginfoPid']==a and terminated['wnowait'] and terminated['rc']==0,terminated)
  capability=set(pids(u))=={a,b}
  check('UNREAPED-ZOMBIE-IS-IN-FULL-CHILD-INVENTORY',capability,{'expectedKernelChildren':[a,b],'actualPids':pids(u),'raw':u,'boundary':'If false, this API alone cannot close a hidden unreaped-child frontier. Do not call a stable endpoint list full scope.'})
  check('WAITED-CHILD-REMOVED-LIVE-B-RETAINED',pids(waited)==[b],waited)
  z=snap('A-unreaped');check('UNREAPED-RUSAGE-READABLE-WITH-LIVE-BIRTH',z['v1']['rc']==0 and z['v2']['rc']==0 and z['v2']['exitAbstime']>0 and z['v2']['startAbstime']==snap('A-live')['v2']['startAbstime'],z)
  scan=listed('race-child-scan-before-reap');bw=one('wait4','B-race-waited');missing=snap('race-B-after-reap');last=snap('race-parent-last-counter');before=snap('race-parent-before-scan');final=listed('race-final-empty-full')
  order=scan['endMonotonicNs']<bw['atMonotonicNs']<missing['startMonotonicNs']<=last['startMonotonicNs']
  check('FINAL-SCAN-REAL-REAP-RACE-ORDER',pids(scan)==[b] and order and bw['exited'] and bw['exitCode']==0,{'scan':scan,'wait4':bw,'missingTarget':missing,'parentLast':last})
  check('TARGET-AFTER-REAP-ACTUALLY-UNAVAILABLE',missing['v1']['rc']==-1 and missing['v2']['rc']==-1 and missing['v2']['errno']==3,missing)
  scale=1e9*abi['denom']/abi['numer'];delta=(childraw(last)-childraw(before))/scale;reference=(bw['userUs']+bw['systemUs'])/1e6
  check('POST-REAP-ANCHOR-COUNTER-COVERS-REAL-LEAF',last['v2']['rc']==0 and abs(delta-reference)<.003,{'parentChildDeltaSeconds':delta,'wait4Seconds':reference,'scaleRawPerSecond':scale})
  negative={'unsafeAlgorithm':'Use pre-scan parent children counter and treat the missing scanned target as zero.','unsafeChildrenSeconds':childraw(before)/scale,'postAnchorChildrenSeconds':childraw(last)/scale,'underchargedSeconds':delta,'actualWait4Seconds':reference,'unsafeCollectorMustReject':delta>.025,'safeClaimBoundary':'This one controlled reap race has a real post-parent counter. It does not prove arbitrary missing PIDs reaped here, other orphans, or all production concurrency.'}
  check('NEGATIVE-CONTROL-DOES-NOT-SILENTLY-ZERO-MISSING-PID',negative['unsafeCollectorMustReject'],negative)
  check('FINAL-FAMILY-EMPTY',pids(final)==[],final)
  observed={'returnUnitCandidates':candidates,'liveFull':live,'oneSlot':short,'zeroByteQueryRaw':zero,'zeroByteQueryNotAssumedTotalCount':True,'unreapedZombieIncluded':capability,'raceCounterReference':{'parentChildDeltaSeconds':delta,'wait4Seconds':reference},'negativeControl':negative}
 except Exception as exc:check('JUDGE-CARRIER-COMPLETE',False,{'kind':type(exc).__name__,'message':str(exc)})
 out={'kind':'native-child-inventory-and-final-race-preflight','checks':checks,'observations':observed,'nativeProtocolCompleted':bool(complete) and not fatal,'allRequiredTechnicalChecksPassed':bool(checks) and all(x['passed'] for x in checks),'zombieListingCapabilityObserved':capability,'fullScopeAccountingApproved':False,'originalT111PassClaim':False,'originalThresholdPercent':5,'productionSamplerChanged':False,'status':'all-short-gates-satisfied-scope-still-needs-production-proof' if checks and all(x['passed'] for x in checks) else 'native-capability-gap-or-fixture-failure-preserved'}
 (R/'result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':out['status'],'checks':len(checks),'passed':sum(x['passed'] for x in checks),'zombieIncluded':capability,'fullScopeApproved':False}))
 return 0 if out['allRequiredTechnicalChecksPassed'] else 1
if __name__=='__main__':raise SystemExit(main())
