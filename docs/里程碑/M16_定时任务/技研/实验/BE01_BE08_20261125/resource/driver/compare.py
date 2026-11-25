#!/usr/bin/env python3
"""Compare matched isolated keep/idle experimental summaries; never qualify T111."""
import argparse
import json
import math
from pathlib import Path


def valid_root(raw):
    path=Path(raw).resolve(strict=True)
    if path.parent!=Path('/private/tmp') or not path.name.startswith('willyou-f36-resource-run-'):
        raise ValueError('only isolated run roots are allowed')
    return path


def n(x): return type(x) in (float,int) and math.isfinite(x)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('keep');p.add_argument('idle');args=p.parse_args()
    roots=[valid_root(args.keep),valid_root(args.idle)]
    if roots[0]==roots[1]: p.error('Each strategy must have its own fresh trial root/process')
    keep,idle=[json.loads((r/'summary.json').read_text()) for r in roots]
    differences=[]
    if keep['mode']!='keep' or idle['mode']!='idle': differences.append('strategy order')
    for k in ('length','checkpointMs','sampleMs','platform','arch','electron','chromium','logicalCPUs','pageCount','backgroundThrottling'):
        if keep['environment'].get(k)!=idle['environment'].get(k): differences.append(k)
    for k in ('electronExecutableSha256','probeSha256','analyzerSha256'):
        if keep['manifest'].get(k)!=idle['manifest'].get(k): differences.append(k)
    if differences: p.error('unmatched protocol/environment: '+', '.join(differences))
    if keep['launcher'].get('pid')==idle['launcher'].get('pid'):
        p.error('process identities need independent fresh runs')
    points=[]
    kp={x['checkpoint']:x for x in keep['checkpointBeforePoints']};ip={x['checkpoint']:x for x in idle['checkpointBeforePoints']}
    for index in sorted(kp.keys()&ip.keys()):
        a,b=kp[index],ip[index];av,bv=a['workingSetKiB'],b['workingSetKiB'];matched=bool(a['complete'] and b['complete'] and n(av) and n(bv) and av>0)
        points.append(dict(checkpoint=index,scheduledSeconds=a['scheduledElapsedMs']/1000,keepKiB=av,idleKiB=bv,
                           idleMinusKeepKiB=bv-av if matched else None,idleRelativeToKeepPercent=100*(bv-av)/av if matched else None,
                           keepProcessCount=a['processCount'],idleProcessCount=b['processCount'],pointCoverageConfirmed=matched))
    result=dict(classification='two independent synthetic exploratory trials; not T111, product acceptance, or causal/performance proof from repeated controls',
                keepRoot=str(roots[0]),idleRoot=str(roots[1]),length=keep['length'],matchedProtocol=True,
                bothProbeEvidenceComplete=keep['probeEvidenceComplete'] and idle['probeEvidenceComplete'],
                keepEvidenceErrors=keep['errors'],idleEvidenceErrors=idle['errors'],matchedCheckpointWorkingSetPoints=points,
                keepMedianIdleTicksHz=keep['medianIdleFixtureTickRateHz'],idleMedianIdleTicksHz=idle['medianIdleFixtureTickRateHz'],
                keepMedianPageOperationMs=keep['medianCheckpointPageOperationMs'],idleMedianPageOperationMs=idle['medianCheckpointPageOperationMs'],
                keepIdleCPUPercent=keep['idleCPU']['weightedIdleCPUPercentOfOneLogicalCPU'] if keep['idleCPU'] else None,
                idleIdleCPUPercent=idle['idleCPU']['weightedIdleCPUPercentOfOneLogicalCPU'] if idle['idleCPU'] else None,
                keepIdleCPUCoverage=keep['idleCPU']['cumulativeCpuCoverageFraction'] if keep['idleCPU'] else None,
                idleIdleCPUCoverage=idle['idleCPU']['cumulativeCpuCoverageFraction'] if idle['idleCPU'] else None,
                keepSyntheticLongTrendChecks=keep['syntheticLongTrendChecks'],idleSyntheticLongTrendChecks=idle['syntheticLongTrendChecks'])
    print(json.dumps(result,indent=2,ensure_ascii=False))
    raise SystemExit(0 if result['bothProbeEvidenceComplete'] else 1)


if __name__=='__main__': main()
