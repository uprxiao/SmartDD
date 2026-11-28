"""Aggregate the previously archived C10 fixed-known idle process identities. Not formal scope."""
import collections, gzip, hashlib, json, sys
from pathlib import Path
source=Path(sys.argv[1])
rows=[x for line in gzip.open(source,'rt') if (x:=json.loads(line)).get('elapsedSeconds') is not None]
acc=collections.defaultdict(lambda:[0.,0.,0.,set()]);duration=0.;pairs=0
for a,b in zip(rows,rows[1:]):
 if a['label'] not in {'milestone-post-command','idle-observation'} or b['label'] not in {'idle-observation','milestone-pre-command'}:continue
 duration+=(b['monotonicNs']-a['monotonicNs'])/1e9;pairs+=1
 aa={x['identity']:x for x in a['processes']};bb={x['identity']:x for x in b['processes']}
 assert aa.keys()==bb.keys(), 'fixed identity membership changed'
 for k in aa.keys():
  x,y=aa[k],bb[k];g=(x['name'],','.join(x['ownership']));r=acc[g]
  for i,key in enumerate(['cpuSeconds','userCpuSeconds','systemCpuSeconds']):
   delta=y[key]-x[key];assert delta>=-1e-6; r[i]+=max(0,delta)
  r[3].add(k)
result={'scope':'Only exact fixed-known archived own C10 idle observations; no unknown process attribution or formal pass','sourceGzipSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'idlePairs':pairs,'idleSeconds':duration,'knownTotalCpuSeconds':sum(r[0] for r in acc.values()),'roles':[{'name':g[0],'ownership':g[1],'count':len(r[3]),'cpuSeconds':r[0],'userCpuSeconds':r[1],'systemCpuSeconds':r[2],'idlePercent':100*r[0]/duration} for g,r in sorted(acc.items(),key=lambda item:-item[1][0])]}
print(json.dumps(result,indent=2,ensure_ascii=False))
