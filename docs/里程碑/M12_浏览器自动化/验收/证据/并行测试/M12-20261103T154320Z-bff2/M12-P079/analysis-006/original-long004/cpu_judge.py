#!/usr/bin/env python3
"""Only reads original psutil analysis and supplemental Native raw; no OS calls."""
import argparse,hashlib,json
from fractions import Fraction
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('root');a=p.parse_args();r=Path(a.root)
 events=[json.loads(x) for x in (r/'cpu-rusage.jsonl').read_text().splitlines()];samples=[x for x in events if x.get('kind')=='cpu-upper-sample'];inits=[x for x in events if x.get('kind')=='cpu-initialized'];errors=[x for x in events if x.get('kind')=='cpu-collector-error'];raw=json.loads((r/'raw.json').read_text());policy=json.loads((r/'cpu-scope-policy.json').read_text())
 final=[x for x in samples if x.get('final')];gaps=[];checks=[]
 def check(k,v,detail):checks.append({'id':k,'passed':bool(v),'detail':detail})
 check('REAL-COLLECTOR-INIT',len(inits)==1,{'count':len(inits)})
 check('REAL-SAMPLES-AND-FINAL',bool(samples) and len(final)==1,{'samples':len(samples),'final':len(final)})
 check('COLLECTOR-ERROR-FREE',not errors,errors)
 last=final[0] if len(final)==1 else samples[-1] if samples else None
 total=Fraction(0)
 if last:
  for sample in samples:gaps.extend(sample.get('gaps',[]))
  # Credits retained after disappearance; reaped ancestry is deliberately charged
  # again. Derive raw ourselves instead of trusting floating output or exit0.
  n=last['abi']['numer'];d=last['abi']['denom'];sumraw=sum(int(c['maxOwnRaw'])+int(c['maxChildRaw']) for c in last['credits'].values());total=Fraction(sumraw*n,d*1000000000)
  check('UPPER-RAW-RECOMPUTED',sumraw==last['upperLifetimeRaw'],{'raw':sumraw,'seconds':float(total)})
  check('FIXED-ANCHOR-COUNTERS-READABLE',not gaps,gaps)
 else:check('UPPER-RAW-RECOMPUTED',False,'No native final sample')
 unresolved=[k for k,v in policy['requirements'].items() if v.get('status')!='independently-verified' or not v.get('evidenceSha256')]
 check('SCOPE-PREMISES-EXPLICITLY-CLOSED',not unresolved,unresolved)
 short=raw.get('shortCpuPreflight',False);lower=None;idle=None;upper=None
 short_observed=None
 if short:
  points=[json.loads(x) for x in (r/'resource-samples.jsonl').read_text().splitlines()]
  points=[x for x in points if x.get('elapsedSeconds') is not None and not x['kind'].startswith('cleanup')]
  active=[((int(x['startMonoNs'])-int(raw['measurementStartMonoNs']))/1e9,(int(x['endMonoNs'])-int(raw['measurementStartMonoNs']))/1e9) for x in raw['activityRanges'] if x.get('endMonoNs')]
  duration=0;counter=0;details=[]
  for a,b in zip(points,points[1:]):
   if any(a['elapsedSeconds']<end and b['elapsedSeconds']>start for start,end in active):continue
   before={x['identity']:x for x in a['processes']};after={x['identity']:x for x in b['processes']};dt=(int(b['monotonicNs'])-int(a['monotonicNs']))/1e9
   ok=set(before)==set(after) and not a['readErrors'] and not b['readErrors'] and dt>0 and all(after[k]['cpuSeconds']>=before[k]['cpuSeconds'] for k in before)
   if ok:
    delta=sum(after[k]['cpuSeconds']-before[k]['cpuSeconds'] for k in before);duration+=dt;counter+=delta;details.append({'seconds':dt,'ownCpuSeconds':delta,'oneCorePercent':delta/dt*100})
  short_observed={'weightedObservedOwnOneCorePercent':counter/duration*100 if duration else None,'completeObservedIdleSeconds':duration,'intervals':details,'boundary':'Informational short original own CPU only; no1800s/5% product verdict and no full-scope claim.'}
 if not short:
  cp=r/'cpu-analysis.json'
  if cp.is_file():
   original=json.loads(cp.read_text());idle=Fraction(str(original['measuredCompleteIdleSeconds']));lower=original['idleWeightedOneCorePercent'];upper=100*total/idle if idle>0 else None
   check('ORIGINAL-IDLE-DENOMINATOR-UNCHANGED',idle>0,{'seconds':float(idle),'fileSha256':hashlib.sha256(cp.read_bytes()).hexdigest(),'originalMethod':original['method']})
  else:check('ORIGINAL-IDLE-DENOMINATOR-UNCHANGED',False,'Original analysis has not run; no invented idle denominator')
 if lower is not None and lower>5:decision='original-own-lowerbound-fails'
 elif short:decision='short-preflight-only-no-T111-or-five-percent-verdict'
 elif gaps or errors or unresolved or len(final)!=1:decision='full-scope-incomplete-no-pass'
 elif upper is not None and upper<5:decision='conservative-upper-below-original-five-pending-coordinator-case-review'
 else:decision='upper-not-below-five-inconclusive-unless-original-lower-fails'
 output={'kind':'independent-supplemental-cpu-scope-adjudication','checks':checks,'shortPreflight':short,'shortObservedOwn':short_observed,'candidateLifetimeUpperSeconds':float(total),'originalObservedOwnOneCorePercent':lower,'originalIdleSeconds':float(idle) if idle else None,'candidateUpperOneCorePercent':float(upper) if upper is not None else None,'candidateUpperExact':str(upper) if upper is not None else None,'thresholdUnchanged':5,'scopeUnresolved':unresolved,'nativeGaps':gaps,'decision':decision,'originalRawAndAnalyzerChanged':False,'formalCaseCredit':0,'scopeApproved':not unresolved and not gaps and not errors and len(final)==1,'rawEvidence':'cpu-rusage.jsonl','policySha256':hashlib.sha256((r/'cpu-scope-policy.json').read_bytes()).hexdigest()}
 (r/'cpu-scope-result.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'decision':decision,'nativeSamples':len(samples),'runtimeErrors':len(errors),'scopeUnresolved':unresolved,'upperSeconds':float(total),'formalCaseCredit':0}))
if __name__=='__main__':main()
