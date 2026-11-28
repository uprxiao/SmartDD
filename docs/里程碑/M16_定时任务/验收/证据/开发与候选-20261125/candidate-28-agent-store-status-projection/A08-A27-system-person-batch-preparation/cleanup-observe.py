#!/usr/bin/env python3
"""Exact private closed DB, recorded own runtime births and loopback endpoints only."""
import errno,json,pathlib,re,socket,sqlite3,subprocess,sys,time
BASE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(BASE.parent))
from own_scope_native_diagnostic import ScopeNative
run=pathlib.Path(sys.argv[1]).resolve(strict=True)
assert run.parent==BASE and re.fullmatch(r'a08-a27-c28-system-[A-Za-z0-9]+',run.name)
meta=json.loads((run/'metadata.json').read_text());pins=json.loads((run/'owned-cleanup-pins.json').read_text());exitrow=json.loads((run/'normal-exit.json').read_text())
pr=pathlib.Path(meta['privateRoot']).resolve(strict=True)
assert pr.parent==pathlib.Path('/private/tmp') and re.fullmatch(r'willyou-m16-time-private-[A-Za-z0-9]+',pr.name)
db=pr/'data/smartdd.db';assert db.resolve(strict=True)==db and meta['data']==str(db.parent)
assert exitrow['pid']==pins['appPid']
n=ScopeNative();known={}
for r in pins['nativeRows']:
    t=r['birth']
    if type(r['pid']) is int and r['pid']>1 and isinstance(t,str) and re.fullmatch(r'darwin-proc-v1:[1-9][0-9]*:[0-9]+',t):
        known[(r['pid'],t.split(':',1)[1])]=True
    else:known[(r.get('pid'),None)]=False
deadline=time.monotonic()+8
while True:
    rows=[]
    for (pid,birth),valid in known.items():
        if not valid:rows.append({'pid':pid,'state':'recorded-birth-unverifiable'});continue
        x=n.bsd(pid)
        if x['bytes']==0 and x['errno']==errno.ESRCH:state='gone'
        elif n.bsd_ok(x,pid) and n.born(x)!=birth:state='gone-or-reused-no-path-query'
        elif n.bsd_ok(x,pid) and n.born(x)==birth:state='same-recorded-birth-still-present'
        else:state='unverifiable'
        rows.append({'pid':pid,'birth':birth,'state':state})
    if all(r['state'].startswith('gone') for r in rows) or time.monotonic()>=deadline:break
    time.sleep(.1)
ports=[]
for p in pins['ports']:
    assert type(p) is int and 0<p<65536
    with socket.socket() as s:
        s.settimeout(.5);ports.append({'port':p,'connectEx':s.connect_ex(('127.0.0.1',p))})
lsof=subprocess.run(['/usr/sbin/lsof','-t','--',str(db)],capture_output=True,text=True)
closed=lsof.returncode==1 and not lsof.stdout.strip() and not lsof.stderr.strip()
wal=pathlib.Path(str(db)+'-wal').exists();shm=pathlib.Path(str(db)+'-shm').exists()
counts=None
if closed and not wal and not shm:
    c=sqlite3.connect(db.as_uri()+'?mode=ro&immutable=1',uri=True)
    count=lambda s:c.execute(s).fetchone()[0]
    counts={'quickCheck':count('PRAGMA quick_check'),'secretCount':count('select count(*) from app_secrets'),'providerSecretCount':count('select count(*) from ai_providers where secret_ref is not null'),'enabledPlanCount':count('select count(*) from schedule_plans where enabled=1')}
    c.close()
out={'actualNormalAppExit':exitrow,'knownNativeRows':rows,'allKnownNativeBirthsAbsent':all(r['state'].startswith('gone') for r in rows),'knownPorts':ports,'allKnownPortsClosed':bool(ports) and all(p['connectEx']!=0 for p in ports),'privateDatabaseHandlesClosed':closed,'walPresent':wal,'shmPresent':shm,'closedPrivateDbCounts':counts}
out['clean']=exitrow['code']==0 and exitrow['signal'] is None and out['allKnownNativeBirthsAbsent'] and out['allKnownPortsClosed'] and closed and counts=={'quickCheck':'ok','secretCount':0,'providerSecretCount':0,'enabledPlanCount':0}
(run/'independent-cleanup.json').write_text(json.dumps(out,indent=2)+'\n');(run/'independent-cleanup.json').chmod(0o600)
print(json.dumps(out))
