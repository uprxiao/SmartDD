import json
from fractions import Fraction
from pathlib import Path

def judge(root):
    root = Path(root)
    events = [json.loads(s) for s in (root/'stdout.jsonl').read_text().splitlines() if s.strip()]
    by = lambda k: [x for x in events if x.get('kind') == k]
    checks = []
    def check(name, ok, detail=None): checks.append({'name':name,'pass':bool(ok),'detail':detail})
    def one(k):
        found = by(k)
        check('exactly-one-'+k,len(found)==1)
        return found[0] if len(found)==1 else {}
    run = json.loads((root/'execution.json').read_text())
    cleanup = json.loads((root/'cleanup.json').read_text())
    check('bounded-normal-exit',run.get('returnCode')==0 and run['elapsedSeconds']<5,run)
    s,b,a,z,d = [one(k) for k in ['self','before','afterDetachedExit','settled','daemonFinished']]
    check('no-errors',not by('error') and not by('daemonError'))
    check('known-controlled-identity-cleanup',cleanup.get('allKnownGone') is True,cleanup)
    check('same-own-resource-coalition',bool(s.get('resourceId')) and all(x.get('resourceId')==s.get('resourceId') for x in [b,a,z,d]))
    check('real-detached-parent',d.get('ppid')==1,d.get('ppid'))
    check('successful-read-only-counters',all(x.get('rc')==0 and x.get('errno')==0 for x in [b,a,z]))
    check('exit-and-start-counters-progress',z.get('tasks_started',0)-b.get('tasks_started',0)>=2 and z.get('tasks_exited',0)-b.get('tasks_exited',0)>=2)
    tb=s.get('timebase',{})
    try:
        cpu=Fraction(z['cpu_time']-b['cpu_time'])*tb['numer']/tb['denom']/1_000_000_000
        direct=Fraction(str(d['usageUserSeconds']))+Fraction(str(d['usageSystemSeconds']))
        check('mach-tick-delta-covers-detached-cpu',cpu>=direct-Fraction(1,200) and cpu>Fraction(1,25),{'coalitionDeltaSeconds':float(cpu),'detachedOwnSeconds':float(direct),'toleranceSeconds':0.005})
    except (KeyError,ZeroDivisionError,ValueError) as e: check('mach-tick-delta-covers-detached-cpu',False,str(e))
    return {'checks':checks,'viabilityProbePassed':all(c['pass'] for c in checks),'appScopeApproved':False,'nativeExecutedOnlyWhenExplicitlyLeased':True,'boundary':'Own coalition may include unrelated Codex tasks. This cannot establish exact CPU attribution or App coalition membership.'}

if __name__=='__main__':
    import sys
    p=Path(sys.argv[1]); result=judge(p); (p/'result.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result,indent=2))
