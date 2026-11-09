# Read-only progress from already-written evidence; never queries App/OS or changes result.
from pathlib import Path
import json
r=Path(__file__).parent
try:x=json.loads((r/'live.json').read_text())
except (FileNotFoundError,json.JSONDecodeError):print(json.dumps({'liveRead':'writer-active'}));raise SystemExit
samples=[]
for line in (r/'resource-samples.jsonl').read_text().splitlines():
 try:samples.append(json.loads(line))
 except json.JSONDecodeError:pass
measured=[a for a in samples if a.get('elapsedSeconds')is not None and a['kind']!='cleanup-observation'];ranges=x.get('activityRanges',[]);cpu=0.;seconds=0.;gaps=0
for a,b in zip(measured,measured[1:]):
 an=int(a['requestedAtDriverMonoNs']);bn=int(b['receivedAtDriverMonoNs']);active=any(int(w['startMonoNs'])<bn and int(w.get('endMonoNs',bn))>an for w in ranges)
 if active:continue
 pa={p['identity']:p for p in a['processes']};pb={p['identity']:p for p in b['processes']};dt=(int(b['monotonicNs'])-int(a['monotonicNs']))/1e9
 if set(pa)!=set(pb)or a['readErrors']or b['readErrors']or dt<=0 or any(pb[k]['cpuSeconds']<pa[k]['cpuSeconds']for k in pa):gaps+=1;continue
 seconds+=dt;cpu+=sum(pb[k]['cpuSeconds']-pa[k]['cpuSeconds']for k in pa)
print(json.dumps({'scope':'read-only-live/provisional-notadjudication','stage':x['stage'],'status':x.get('status'),'clock0':x.get('measurementStartedAtUtc'),'lastSample':x.get('lastSample'),'completedMinutes':[m['minute']for m in x['milestones']],'actualCliTotal':len(x['commands']),'actualFormalCli':sum(c.get('sample')!='warm'for c in x['commands']),'provisionalIdleOneCoreCpuPercent':cpu/seconds*100 if seconds else None,'completeIdleSeconds':seconds,'idleCoverageGaps':gaps,'error':x.get('error')}))
