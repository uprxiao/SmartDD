#!/usr/bin/env python3
"""Reviewed synthetic wait only. No credentials, CLI, socket, auth or model APIs."""
import json, os, pathlib, stat, time
D=pathlib.Path(__file__).resolve().parent

def regular_json(path):
    s=path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o777!=0o600: raise RuntimeError('Private fixture metadata required')
    return json.loads(path.read_text())
def append(path,value):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_APPEND|getattr(os,'O_NOFOLLOW',0),0o600)
    try: os.write(fd,(json.dumps(value,separators=(',',':'))+'\n').encode())
    finally: os.close(fd)
def main():
    config_deadline=time.monotonic()+90
    while not (D/'runtime.public.json').exists():
        if time.monotonic()>config_deadline:raise RuntimeError('Own actual runtime metadata not ready')
        time.sleep(0.2)
    cfg=regular_json(D/'runtime.public.json'); gate=pathlib.Path(cfg['controller'])/'wait-gate.json'; start=time.monotonic();
    while not gate.exists():
        if time.monotonic()-start>240: raise RuntimeError('No observed first real CLI completion; wait clock not started')
        time.sleep(0.2)
    g=regular_json(gate)
    if (g['marker'],g['runId'],g['taskId'])!=(cfg['marker'],cfg['runId'],cfg['taskId']): raise RuntimeError('Different real run')
    begin=time.monotonic_ns(); wall=time.time_ns(); required=2100*1_000_000_000; events=D/'wait.events.private.jsonl'; last=-1
    append(events,{'kind':'wait-start','pid':os.getpid(),'monotonicNs':begin,'wallNs':wall,'requiredSeconds':2100,'marker':cfg['marker'],'runId':cfg['runId'],'firstRequestId':g['firstRequestId']})
    print(json.dumps({'phase':'wait-started','requiredSeconds':2100}),flush=True)
    while True:
        elapsed=time.monotonic_ns()-begin
        minute=elapsed//(60*1_000_000_000)
        if minute!=last:
            last=minute;append(events,{'kind':'wait-checkpoint','monotonicNs':time.monotonic_ns(),'elapsedNs':elapsed,'wallNs':time.time_ns()});print(json.dumps({'phase':'waiting','completedSeconds':elapsed//1_000_000_000}),flush=True)
        if elapsed>=required: break
        time.sleep(min(1,(required-elapsed)/1_000_000_000))
    done={'kind':'wait-done','monotonicNs':time.monotonic_ns(),'elapsedNs':time.monotonic_ns()-begin,'wallNs':time.time_ns(),'requiredSeconds':2100}
    if done['elapsedNs']<required:raise RuntimeError('Actual35minutes not reached')
    append(events,done);print(json.dumps({'phase':'wait-done','elapsedSeconds':done['elapsedNs']/1_000_000_000,'realTime':True}),flush=True)
if __name__=='__main__':main()
