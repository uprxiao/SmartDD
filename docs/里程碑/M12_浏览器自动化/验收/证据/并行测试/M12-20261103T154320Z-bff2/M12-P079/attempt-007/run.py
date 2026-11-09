"""Explicitly leased execution only; no native API at module import."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

def main():
    if sys.argv[1:] != ['--execute']: raise SystemExit('explicit --execute required')
    root=Path(__file__).resolve().parent
    if (root/'execution.json').exists(): raise SystemExit('fresh directory required; no rerun')
    assert Path(os.environ['WILLYOU_TEST_CACHE_DIR']).resolve()==root/'cache'
    (root/'cache').mkdir(exist_ok=True)
    started=time.monotonic(); child=None; code=None; failure=None
    with (root/'stdout.jsonl').open('w') as out, (root/'stderr.log').open('w') as err:
        try:
            child=subprocess.Popen([sys.executable,str(root/'probe.py'),'--execute'],stdout=out,stderr=err,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
            (root/'started.json').write_text(json.dumps({'runnerPid':os.getpid(),'probePid':child.pid,'nativeLeaseRequired':True})+'\n')
            print(json.dumps({'runnerPid':os.getpid(),'probePid':child.pid,'ports':[]}),flush=True)
            code=child.wait(timeout=4.6)
        except BaseException as ex:
            failure=repr(ex)
            if child is not None and child.poll() is None: child.kill(); code=child.wait()
    (root/'execution.json').write_text(json.dumps({'returnCode':code,'failure':failure,'elapsedSeconds':time.monotonic()-started},indent=2)+'\n')
    # Exact known birth identities only; read-only residual check. No process is killed here.
    import ctypes as C
    from probe import BSD
    class Usage(C.Structure):
        _fields_=[('uuid',C.c_uint8*16),('times',C.c_uint64*18)]
    lib=C.CDLL('/usr/lib/libproc.dylib',use_errno=True)
    lib.proc_pidinfo.argtypes=[C.c_int,C.c_int,C.c_uint64,C.c_void_p,C.c_int];lib.proc_pidinfo.restype=C.c_int
    lib.proc_pid_rusage.argtypes=[C.c_int,C.c_int,C.c_void_p];lib.proc_pid_rusage.restype=C.c_int
    events=[json.loads(s) for s in (root/'stdout.jsonl').read_text().splitlines() if s.strip()]
    owned=[x for x in events if x.get('kind')=='daemonOwnedIdentity']
    attempts=[]
    for identity in owned:
        limit=time.monotonic()+0.15
        while True:
            b=BSD();C.set_errno(0);rc=lib.proc_pidinfo(identity['pid'],3,0,C.byref(b),C.sizeof(b));e=C.get_errno()
            u=Usage();C.set_errno(0);ur=lib.proc_pid_rusage(identity['pid'],2,C.byref(u));ue=C.get_errno()
            same=rc==C.sizeof(b) and [b.birthSec,b.birthUsec]==[identity['birthSec'],identity['birthUsec']]
            gone=(rc==0 and e==3 and ur==-1 and ue==3) or (rc==C.sizeof(b) and not same)
            attempts.append({'identity':identity,'bsdBytes':rc,'errno':e,'rusageRc':ur,'rusageErrno':ue,'sameBirth':same,'gone':gone})
            if gone or time.monotonic()>=limit:break
            time.sleep(0.005)
    cleanup={'probeWaited':child is not None and child.poll() is not None,'knownDetached':attempts,'allKnownGone':len(owned)==1 and bool(attempts) and attempts[-1]['gone'],'noApp':True,'noPorts':True,'noHooks':True}
    (root/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n')
    (root/'execution.json').write_text(json.dumps({'returnCode':code,'failure':failure,'elapsedSeconds':time.monotonic()-started},indent=2)+'\n')
    from judge import judge
    result=judge(root);(root/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':result['viabilityProbePassed'],'cleanup':cleanup}),flush=True)

if __name__=='__main__':main()
