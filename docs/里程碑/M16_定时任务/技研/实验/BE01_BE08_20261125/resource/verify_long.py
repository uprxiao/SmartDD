#!/usr/bin/env python3
"""Independent checkpoint/cleanup and CPU denominator checks, using saved synthetic BE08 runs only."""
from pathlib import Path
import json, collections, hashlib, math
root=Path(__file__).resolve().parent

def read(path):return json.loads(path.read_text())
def close(a,b):return math.isclose(a,b,rel_tol=1e-9,abs_tol=1e-7)
def verify(mode):
    folder=root/(mode+'-long');s=read(folder/'summary.json');man=read(folder/'manifest.json');launch=read(folder/'run-result.json');events=[json.loads(l) for l in (folder/'raw.jsonl').read_text().splitlines() if l]
    assert s['length']=='long' and s['mode']==mode and s['probeEvidenceComplete'] and not s['errors']
    assert s['operationCount']==s['operationPassed']==40 and s['normalCleanupConfirmed'] and s['resourceScopeComplete']
    assert s['observedMeasurementMs']>=1800000 and s['scheduledCheckpointCount']==7 and s['scheduleConfirmed']
    assert launch['exitCode']==0 and not launch['timeout'] and not launch['forcedTermination'] and launch['processGroupMembersAfterExit']==[]
    for key,file in [('probeSha256','resource-probe.cjs'),('analyzerSha256','analyze.py')]:assert hashlib.sha256((folder/file).read_bytes()).hexdigest()==man[key]
    metrics=[r for r in events if r.get('event')=='metric'];points=sorted((r for r in metrics if r.get('phase')=='checkpoint-before'),key=lambda r:r['checkpoint']);assert len(points)==7 and [r['checkpoint'] for r in points]==list(range(7))
    assert all(not r.get('missingExpectedPids') for r in metrics)
    def total(r):return sum(p['memory']['workingSetSize'] for p in r['processes'])
    sizes=[total(p) for p in points];assert sizes==s['checkpointBeforeWorkingSetKiB']
    ratio=sizes[-1]/sizes[2];monotone=all(b>a for a,b in zip(sizes[-4:],sizes[-3:]));assert close(ratio,s['lastToThirdCheckpointWorkingSetRatio']) and monotone==s['last4WorkingSetsStrictlyIncreasing']
    start={p['pid']:p for p in points[2]['processes']};end={p['pid']:p for p in points[6]['processes']};process_types=collections.defaultdict(int);deltas=[]
    for pid,p in end.items():
        if pid not in start or p.get('creationTime')!=start[pid].get('creationTime'):continue
        delta=p['memory']['workingSetSize']-start[pid]['memory']['workingSetSize'];process_types[p['type']]+=delta;deltas.append({'pid':pid,'type':p['type'],'deltaKiB10to30':delta})
    cpu=s['idleCPU'];covered=[i for i in cpu['intervals'] if isinstance(i.get('cumulativeCpuSecondsDelta'),(int,float))];observed=sum(i['durationSec'] for i in covered);cumulative=sum(i['cumulativeCpuSecondsDelta'] for i in covered)
    assert close(observed,cpu['cumulativeCpuCoveredSeconds']);avg=100*cumulative/observed
    assert close(avg,cpu['weightedIdleCPUPercentOfOneLogicalCPU'])
    actual_cleanup=[x for x in events if x.get('event')=='cleanup'];assert len(actual_cleanup)==1 and actual_cleanup[0]['allDestroyed'] and actual_cleanup[0]['windowDestroyed'] and actual_cleanup[0]['remainingWindows']==0 and actual_cleanup[0]['remainingWebContents']==[] and not actual_cleanup[0]['errors']
    expected={'workingSet30to10Within110pct':ratio<=1.10,'lastFourWorkingSetsNotStrictlyGrowing':not monotone,'idleCumulativeCPUPercentOfOneLogicalCpuBelow5':avg<5};assert expected==s['syntheticLongTrendChecks']
    return {'mode':mode,'observedMeasurementMs':s['observedMeasurementMs'],'operationPassed':s['operationPassed'],'metricSamples':len(metrics),'workingSetKiB':sizes,'workingSet30to10':ratio,'lastFourStrictlyIncreasing':monotone,'cpuPercentOneLogicalCPU':avg,'cpuCoverage':cpu['cumulativeCpuCoverageFraction'],'medianTimerHz':s['medianIdleFixtureTickRateHz'],'medianPageOperationMs':s['medianCheckpointPageOperationMs'],'sameProcessIdentityAt10And30':set(start)==set(end) and all(start[k].get('creationTime')==end[k].get('creationTime') for k in start),'processTypeNetKiB10to30':dict(process_types),'processNetGrowthKiB':sorted(deltas,key=lambda x:x['deltaKiB10to30'],reverse=True),'cleanupConfirmed':True,'syntheticChecks':expected,'electronSha':man['electronExecutableSha256'],'driverSha':man['probeSha256']}
if __name__=='__main__':
    keep=verify('keep');idle=verify('idle');assert keep['electronSha']==idle['electronSha'] and keep['driverSha']==idle['driverSha']
    print(json.dumps({'scope':'two sequential fixed synthetic trials, not M12-T111 or formal product performance proof','keep':keep,'idle':idle},indent=2))
