"""Independent raw coalition upper adjudication; pure file/data operations only."""
import argparse
import hashlib
import json
from fractions import Fraction
from pathlib import Path
from api_audit import audit

FIELDS=('tasks_started','tasks_exited','time_nonempty','cpu_time')

def adjudicate(events,raw,analysis,proof_ok=True,raw_matches=True,reference_api_ok=True):
    checks=[]
    def check(name,ok,detail=None):checks.append({'id':name,'passed':bool(ok),'detail':detail})
    integer=lambda x:type(x) is int and 0<=x<2**64
    init=[x for x in events if x.get('kind')=='cpu-initialized']
    samples=[x for x in events if x.get('kind')=='cpu-upper-sample']
    finals=[x for x in samples if x.get('final')]
    check('EXACT-INITIAL-FINAL',len(init)==1 and len(finals)==1 and bool(samples))
    check('PROOF-INPUT-HASHES',proof_ok)
    check('ALL-REFERENCE-CAPTURED-API-ATTEMPTS-VALID',reference_api_ok)
    check('FINAL-IS-LAST-CAPTURE',len(finals)==1 and samples and finals[0] is samples[-1])
    check('STREAM-MATCHES-ORIGINAL-NATIVE-RAW',raw_matches)
    check('NO-COLLECTOR-ERRORS',not any(x.get('kind')=='cpu-collector-error' for x in events))
    check('NATIVE-REFERENCE-GAPS-EMPTY',all(not x.get('gaps') for x in samples))
    baseline=init[0] if len(init)==1 else None
    last=finals[0] if len(finals)==1 else None
    first_bindings=None;first_expected=None;first_abi=None;previous={};deltas={};total=None;upper=None;idle=None;lower=None
    sequences=([baseline] if baseline else [])+samples
    request_ids=[x.get('requestId') for x in sequences]
    check('UNIQUE-ORDERED-NATIVE-REQUESTS',all(type(x) is int for x in request_ids) and request_ids==sorted(set(request_ids)))
    for index,event in enumerate(sequences):
        c=event.get('coalition',{});abi=event.get('abi',{});reads=c.get('anchorReads',[]);counters=c.get('counters',[])
        anchor_map={str(k):v for k,v in event.get('anchors',{}).items()}
        expected={pid:(a.get('identity'),a.get('path'),a.get('birth')) for pid,a in anchor_map.items()}
        bindings=c.get('bindings',{})
        phase='initial' if index==0 else 'final' if event.get('final') else 'capture'
        ok=(c.get('phase')==phase and integer(c.get('uid')) and c.get('uid')==raw.get('host',{}).get('uid') and len(reads)==len(anchor_map)>0
            and set(bindings)==set(anchor_map) and len({x.get('pid') for x in reads})==len(reads)
            and set(str(x.get('pid')) for x in reads)==set(anchor_map))
        for row in reads:
            pid=str(row.get('pid'));e=anchor_map.get(pid,{});birth=e.get('birth',{});cid=row.get('coalition',{})
            ok=ok and row.get('expected')==e and cid.get('pid')==row.get('pid') and cid.get('bytes')==40 and cid.get('errno')==0
            ok=ok and integer(cid.get('resourceId')) and cid.get('resourceId',0)>0 and integer(cid.get('jetsamId')) and cid.get('reserved')==[0,0,0]
            ok=ok and bindings.get(pid)==cid.get('resourceId') and integer(cid.get('startNs')) and integer(cid.get('endNs')) and cid.get('endNs',0)>=cid.get('startNs',1)
            for key in ['before','after']:
                b=row.get(key,{}).get('bsd',{});u=row.get(key,{}).get('rusage',{});r=row.get(key,{})
                ok=ok and r.get('pid')==birth.get('pid') and b.get('bytes')==abi.get('bsdSize')==136 and b.get('errno')==0
                ok=ok and b.get('pid')==birth.get('pid') and b.get('uid')==c.get('uid') and b.get('birthSec')==birth.get('birthSec') and b.get('birthUsec')==birth.get('birthUsec')
                ok=ok and u.get('rc')==0 and u.get('errno')==0 and u.get('exitAbstime')==0 and u.get('startAbstime')==birth.get('startAbstime')
                ok=ok and r.get('path')==e.get('path') and r.get('pathRc',0)>0 and r.get('pathErrno')==0
            before=row.get('before',{});after=row.get('after',{});ok=ok and all(integer(r.get(t)) for r in [before,after] for t in ['startReadNs','endReadNs'])
            ok=ok and before.get('endReadNs',1)<=cid.get('startNs',0)<=cid.get('endNs',-1)<=after.get('startReadNs',-2)
        check('ANCHOR-IDENTITY-UID-PERMISSION-'+str(index),ok)
        ids=sorted(set(bindings.values())) if all(integer(v) for v in bindings.values()) else []
        check('DEDUPLICATED-CID-COUNTERS-'+str(index),ids==c.get('resourceIds') and len(counters)==len(ids) and sorted(x.get('resourceId',-1) for x in counters)==ids and len(ids)>0)
        sane=True
        for ctr in counters:
            cid=ctr.get('resourceId');old=previous.get(cid)
            valid=(ctr.get('rc')==0 and ctr.get('errno')==0 and ctr.get('prefixBytes')==32 and all(integer(ctr.get(k)) for k in FIELDS)
                and ctr.get('tasks_started',-1)>=ctr.get('tasks_exited',0) and integer(ctr.get('startNs')) and integer(ctr.get('endNs')) and ctr.get('endNs',0)>=ctr.get('startNs',1))
            if old:valid=valid and all(ctr.get(k,-1)>=old[k] for k in FIELDS) and ctr.get('startNs',0)>=old['endNs']
            sane=sane and valid
            if valid:previous[cid]=ctr
        check('RAW-API-COUNTERS-MONOTONIC-'+str(index),sane)
        if first_bindings is None:first_bindings=dict(bindings);first_expected=expected;first_abi=abi
        check('STABLE-ANCHORS-CIDS-TIMEBASE-'+str(index),bindings==first_bindings and expected==first_expected and abi==first_abi and type(abi.get('numer')) is int and abi.get('numer',0)>0 and type(abi.get('denom')) is int and abi.get('denom',0)>0)
        window_ok=(integer(c.get('startNs')) and integer(c.get('endNs')) and c.get('endNs',0)>=c.get('startNs',1))
        window_ok=window_ok and all(c.get('startNs',1)<=x.get('before',{}).get('startReadNs',0) and x.get('after',{}).get('endReadNs',10**30)<=c.get('endNs',0) for x in reads)
        window_ok=window_ok and all(c.get('startNs',1)<=x.get('startNs',0)<=x.get('endNs',-1)<=c.get('endNs',0) for x in counters)
        check('NATIVE-MONOTONIC-WINDOW-'+str(index),window_ok)
    try:
        exchanges=raw['cpuCollector']['exchanges']
        startx=[x for x in exchanges if x['requestId']==baseline['requestId'] and x['type']=='init']
        endx=[x for x in exchanges if x['requestId']==last['requestId'] and x['final']]
        check('CAUSAL-CUT-COVERS-NODE-MEASUREMENT',len(startx)==1 and len(endx)==1 and int(startx[0]['startDriverMonoNs'])<=int(startx[0]['endDriverMonoNs'])<=int(raw['measurementStartMonoNs'])<int(raw['measurementEndMonoNs'])<=int(endx[0]['startDriverMonoNs'])<=int(endx[0]['endDriverMonoNs']))
        a={x['resourceId']:x['cpu_time'] for x in baseline['coalition']['counters']};z={x['resourceId']:x['cpu_time'] for x in last['coalition']['counters']}
        check('FINAL-CID-SET-UNCHANGED',set(a)==set(z) and bool(a))
        deltas={str(cid):z[cid]-value for cid,value in a.items()}
        total=Fraction(sum(deltas.values())*first_abi['numer'],first_abi['denom']*1_000_000_000)
        duration=Fraction(int(raw['measurementEndMonoNs'])-int(raw['measurementStartMonoNs']),1_000_000_000)
        idle=Fraction(str(analysis['measuredCompleteIdleSeconds']));lower=Fraction(str(analysis['idleWeightedOneCorePercent']))
        check('ORIGINAL-IDLE-DENOMINATOR',duration>=1800 and 0<idle<=duration and 0<=lower)
        upper=100*total/idle
        check('NONNEGATIVE-EXACT-COALITION-DELTA',all(type(x) is int and x>=0 for x in deltas.values()))
    except (KeyError,TypeError,ValueError,ZeroDivisionError,IndexError) as ex:check('CAUSAL-DELTA-DENOMINATOR-COMPLETE',False,repr(ex))
    mandatory=all(c['passed'] for c in checks)
    if lower is not None and lower>5:decision='original-own-lowerbound-fails'
    elif not mandatory:decision='full-scope-incomplete-no-pass'
    elif upper is not None and upper<5:decision='coalition-superset-upper-below-original-five-pending-coordinator-case-review'
    else:decision='coalition-upper-not-below-five-inconclusive'
    return {'kind':'independent-coalition-superset-adjudication','checks':checks,'mandatoryChecksPassed':mandatory,'decision':decision,'scopeApproved':mandatory,'formalCaseCredit':0,'thresholdUnchanged':5,'coalitionDeltaTicksByCid':deltas,'coalitionUpperCpuSeconds':float(total) if total is not None else None,'coalitionUpperOneCorePercent':float(upper) if upper is not None else None,'coalitionUpperExact':str(upper) if upper is not None else None,'originalIdleSeconds':float(idle) if idle is not None else None,'originalOwnLowerPercent':float(lower) if lower is not None else None,'appExclusive':False,'includesOtherCoalitionMembersBusyAndSamplerCost':True}

def main():
    p=argparse.ArgumentParser();p.add_argument('root');a=p.parse_args();r=Path(a.root)
    def load(name):return json.loads((r/name).read_text())
    proof=load('coalition-proof-pin.json');files=proof.get('files',[]);raw=load('raw.json')
    proof_ok=(len(files)==11 and len({f['path'] for f in files})==11
        and proof.get('probe007ManifestSha256')=='755731dfa3a2a01fe89235766a895b83829ae9254c48a0596839174b093a2447'
        and proof.get('sourceManifestSha256',proof.get('source023ManifestSha256'))==raw.get('sourceManifest')
        and (not proof.get('newSourceBridgeSha256') or hashlib.sha256((r/'source024-inheritance-bridge.json').read_bytes()).hexdigest()==proof['newSourceBridgeSha256'])
        and proof.get('helperSourceManifestSha256')=='8ee2435e2019810409c47f1a8b97534738c937b3d2c01f8c74425172d62f13a3'
        and all(hashlib.sha256((r/f['path']).read_bytes()).hexdigest()==f['sha256'] for f in files)
        and hashlib.sha256((r/'coalition-evidence/probe007-manifest.json').read_bytes()).hexdigest()==proof['probe007ManifestSha256'])
    events=[json.loads(s) for s in (r/'coalition-usage.jsonl').read_text().splitlines()]
    reference=[json.loads(s) for s in (r/'cpu-rusage.jsonl').read_text().splitlines()]
    original=[x for x in reference if x.get('coalition')]
    # Error lines are not omitted just because they contain no successful coalition.
    events += [x for x in reference if x.get('kind')=='cpu-collector-error']
    result=adjudicate(events,raw,load('cpu-analysis.json'),proof_ok,original==[x for x in events if x.get('coalition')],audit(reference)['allCapturedApisValid'])
    result['originalAnalysisSha256']=hashlib.sha256((r/'cpu-analysis.json').read_bytes()).hexdigest()
    (r/'coalition-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['decision','scopeApproved','coalitionUpperOneCorePercent','originalOwnLowerPercent','formalCaseCredit']}))

if __name__=='__main__':main()
