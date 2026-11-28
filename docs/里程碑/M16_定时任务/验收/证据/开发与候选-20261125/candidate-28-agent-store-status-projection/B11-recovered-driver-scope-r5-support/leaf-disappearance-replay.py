#!/usr/bin/env python3
"""Pure replay of preserved actual scope attempts, with labelled hypothetical endpoints."""
from pathlib import Path
import copy
import gzip
import hashlib
import json

from closure_contract import exact_coherent, retry_resolution, retry_gap_classification

BASE=Path(__file__).resolve().parent
HISTORY=BASE.parents[2]/'docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125'
R4=BASE/'run-0iKsJY/scope-attempts.jsonl'
C22=HISTORY/'candidate-22-notification-ownership-and-cold-paint/B11-full-1800s-scoped-rss-trend-red-agent-staging/archive-safe/scope-attempts.jsonl.gz'
C27=HISTORY/'candidate-27-schedule-active-query-reuse/B11-real-1800s-recheck/archive-safe/scope-attempts.jsonl.gz'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def records(path):
    data=gzip.open(path,'rt') if path.suffix=='.gz' else path.open()
    with data:return [json.loads(line) for line in data]
def exact(attempt):
    required={int(pid):row for pid,row in attempt['required'].items()}
    return exact_coherent(attempt,required,attempt['cid'],live_count_contract_verified=True)
r4,c22,c27=map(records,(R4,C22,C27))
failed=r4[-1]['attempts'][-1]
assert r4[-1]['label']=='milestone-post-command' and r4[-1]['minute']==0 and not r4[-1]['closedCandidate']
assert failed['candidateVerdict']['state']=='fatal'
child=84385
parent=83351
node=lambda a,pid:next(x for x in a['nodes'] if x['pid']==pid)
checks=[]
def check(name,test):
    test();checks.append(name)
def ensure(condition,message='assertion'):
    assert condition,message

check('actual R4 original failure is retry-eligible only, not a closed sample',lambda:ensure(exact(failed).state=='retry' and retry_gap_classification(failed)[1]==[child] and failed['candidateVerdict']['state']=='fatal'))

def actual_closed(all_records):
    count=0
    for rec in all_records:
        if not rec['closedCandidate']:continue
        latest=rec['attempts'][-1]
        assert exact(latest).state=='closed'
        ident=lambda rows:{(x['pid'],x['birth']) for x in rows}
        assert ident(latest['uidBefore']['members'])==ident(latest['uidAfter']['members'])==ident(latest['nodes'])
        assert sum(n['rss'] for n in latest['nodes']if n['role']=='product')==rec['actualProductRssBytes']
        count+=1
    return count
check('all 18 original C27 actual closed scope endpoints and RSS unchanged',lambda:ensure(actual_closed(c27)==18))
check('all prior 5 actual R4 accepted endpoints and RSS unchanged',lambda:ensure(actual_closed(r4)==5))
check('all original accepted C22 endpoints remain closed',lambda:ensure(actual_closed(c22)>0))
def original_c22_retry():
    found=[]
    for rec in c22:
        if not rec['closedCandidate']:continue
        for attempt in rec['attempts'][:-1]:
            if any(g['kind']=='candidate-all-esrch' for g in attempt.get('gaps',[])):
                assert exact(attempt).state=='retry'
                assert retry_resolution(attempt,rec['attempts'][-1],same_period=True).state=='endpoint-resampled'
                found.append(rec['label'])
    assert found==['milestone-pre-command'],found
check('retained C22 actual ESRCH and actual subsequent full closure still pass original resolution',original_c22_retry)

# No actual R4 sample after the failure exists. Construct a labelled hypothetical
# later stable endpoint from the earlier exact 34-member graph, following the
# observed failed endpoint counters. This is only a predicate control.
candidate=copy.deepcopy(r4[-2]['attempts'][-1])
candidate['startNs']=failed['endNs']+20_000_000
candidate['endNs']=candidate['startNs']+15_000_000
for name,offset in [('counterBefore',0),('counterAfter',10_000_000)]:
    value=copy.deepcopy(failed['counterAfter'])
    value.update(tasks_exited=value['tasks_exited']+1,cpu_time=value['cpu_time']+1,startNs=candidate['startNs']+offset,endNs=candidate['startNs']+offset+1)
    candidate[name]=value
assert exact(candidate).state=='closed'
check('hypothetical new complete same-CID endpoint after the actual R4 failure is eligible',lambda:ensure(retry_resolution(failed,candidate,same_period=True).state=='endpoint-resampled'))
check('actual earlier R4 closed sample must not be substituted as a new endpoint',lambda:ensure(retry_resolution(failed,r4[-2]['attempts'][-1],same_period=True).state!='endpoint-resampled'))

def reject_prior(label,modify):
    def test():
        raw=copy.deepcopy(failed);modify(raw)
        assert exact(raw).state=='fatal',exact(raw)
    check(label,test)
reject_prior('generic family gap without independent paired disappearance remains fatal',lambda a:a['gaps'].pop())
reject_prior('non-ESRCH generic family read remains fatal',lambda a:a['gaps'][0]['minimalBefore'].update(errno=13))
reject_prior('different child birth remains fatal',lambda a:a['gaps'][1].update(oldBirth='1:2'))
reject_prior('retained root cannot be retired by this rule',lambda a:a['required'].update({str(child):{'birth':node(a,child)['birth'],'pathClass':node(a,child)['pathClass']}}))
reject_prior('foreign UID remains fatal',lambda a:node(a,child)['minimalBefore'].update(uid=999))
reject_prior('foreign CID remains fatal',lambda a:node(a,child).update(cid=a['cid']+1))
reject_prior('unknown role remains fatal',lambda a:node(a,child).update(role='unknown'))
reject_prior('missing direct parent proof remains fatal',lambda a:node(a,parent)['childrenBefore'].remove(child))
reject_prior('parent birth change remains fatal',lambda a:node(a,parent)['minimalFinal'].update(birthUsec=0))
reject_prior('leaf with earlier children remains fatal',lambda a:node(a,child).update(childrenBefore=[123456]))
reject_prior('failed original family inventory remains fatal',lambda a:a['families'][str(child)]['beforeAttempts'][-1].update(errno=13))
reject_prior('missing old PID from exact UID-before census remains fatal',lambda a:a['uidBefore'].update(members=[m for m in a['uidBefore']['members'] if m['pid']!=child]))
reject_prior('reused PID in UID-after census remains fatal',lambda a:a['uidAfter']['members'][-1].update(pid=child,birth='1:2'))
reject_prior('uncertain matched UID identity remains fatal',lambda a:a['uidAfter']['summary'].update(matchedIdentityGap=1))
reject_prior('unchanged exit counter cannot prove this disappearance class',lambda a:a['counterAfter'].update(tasks_exited=a['counterBefore']['tasks_exited']))
reject_prior('other unrelated identity gap stays fatal',lambda a:a['gaps'].append({'kind':'unbound-coalition','pid':123456}))

def reject_final(label,modify):
    def test():
        endpoint=copy.deepcopy(candidate);modify(endpoint)
        assert retry_resolution(failed,endpoint,same_period=True).state!='endpoint-resampled'
    check(label,test)
reject_final('new endpoint beyond original two-second budget rejected',lambda a:a.update(endNs=failed['startNs']+2_000_000_001))
reject_final('new endpoint missing complete UID-after member closure rejected',lambda a:a['uidAfter']['members'].pop())
reject_final('new endpoint UID-after still includes old numeric PID rejected',lambda a:a['uidAfter']['members'][-1].update(pid=child))
reject_final('new endpoint still lists prior child in parent table rejected',lambda a:node(a,parent)['childrenAfter'].append(child))
reject_final('new endpoint changed coalition rejected',lambda a:a.update(cid=a['cid']+1))
reject_final('new endpoint counters moving backwards rejected',lambda a:a['counterBefore'].update(cpu_time=0))
reject_final('new endpoint unknown product identity rejected',lambda a:node(a,parent).update(role='unknown'))
reject_final('new endpoint original parent birth changed rejected',lambda a:node(a,parent).update(birth='1:2'))

result={'staticOnly':True,'actualSources':{str(p):sha(p) for p in (R4,C22,C27)},'actualR4':{'originalVerdict':failed['candidateVerdict'],'currentEligibility':exact(failed).__dict__,'rawGapsPreserved':failed['gaps'],'oldChildBirth':node(failed,child)['birth'],'parentBirth':node(failed,parent)['birth'],'newEndpointActuallyRecorded':False,'finalStatus':'original failed/current bounded-retry-only eligibility'},'hypotheticalConditionalControl':'Later stable endpoint uses R4 preceding actual member graph but explicitly synthetic later timestamps/counters; no actual resolved R4 sample exists. No prior result reclassified as a valid measurement.','actualC27AcceptedEndpoints':actual_closed(c27),'actualC22AcceptedEndpoints':actual_closed(c22),'actualR4PriorAcceptedEndpoints':actual_closed(r4),'checks':checks,'passed':len(checks),'failed':0}
(BASE/'leaf-disappearance-replay.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'passed':len(checks),'failed':0,'actualC27':actual_closed(c27),'actualC22':actual_closed(c22),'actualR4Prior':actual_closed(r4),'actualR4Failure':'retry-only; no later endpoint'}))
