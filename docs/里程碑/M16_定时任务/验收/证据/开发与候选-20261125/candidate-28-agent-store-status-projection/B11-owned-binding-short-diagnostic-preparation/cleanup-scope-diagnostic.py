#!/usr/bin/env python3
"""Independent check of only the recorded owned births, paths and endpoints."""
import errno,json,pathlib,re,socket,subprocess,sys,time
from own_scope_native import ScopeNative
from coalition_accounting import cid_valid
base=pathlib.Path(__file__).resolve().parent
run,cohort=[pathlib.Path(a).resolve(strict=True) for a in sys.argv[1:3]]
assert run.parent==cohort.parent==base and run.name.startswith('run-') and cohort.name.startswith('cohort-')
report=json.loads((run/'result.json').read_text())
assert report.get('schema')=='M16-B11-scope-diagnostic-only' and report.get('formalEligible') is False
driver=json.loads((cohort/'driver-exit.json').read_text())
lease=json.loads((cohort/'expected-cohort.json').read_text())
known={}
scope_log=run/'scope-attempts.jsonl'
for ln in (scope_log.read_text().splitlines() if scope_log.exists() else []):
 for a in json.loads(ln).get('attempts',[]):
  for n in a.get('nodes',[]):
   known[(n['pid'],n['birth'])]={'pid':n['pid'],'birth':n['birth'],'role':n['role'],'pathClass':n['pathClass']}
  # An identity sampled by the exact own-UID/own-CID census but omitted from
  # the invalid RSS graph is still a recorded own birth for cleanup only.
  # This is never a product classification or a resource-scope closure.
  for name in ('uidBefore','uidAfter'):
   for m in a.get(name,{}).get('members',[]):
    assert type(m['pid']) is int and m['pid']>0 and re.fullmatch(r'[1-9][0-9]*:[0-9]+',m['birth'])
    key=(m['pid'],m['birth'])
    known.setdefault(key,{'pid':m['pid'],'birth':m['birth'],'role':'owned-cid-unclassified-diagnostic-only','pathClass':None})
for row in lease['rows']:
 b=row['before']['bsd'];born=str(b['birthSec'])+':'+str(b['birthUsec'])
 known[(row['pid'],born)]={'pid':row['pid'],'birth':born,'role':'instrument','pathClass':'own-cohort'}
n=ScopeNative();deadline=time.monotonic()+12
while True:
 states=[]
 for item in known.values():
  b=n.bsd(item['pid'])
  if b['bytes']==0 and b['errno']==errno.ESRCH:status='gone'
  elif n.bsd_ok(b,item['pid']) and n.born(b)!=item['birth']:status='gone-or-reused-no-other-inspection'
  elif n.bsd_ok(b,item['pid']) and n.born(b)==item['birth']:status='same-recorded-birth-still-present'
  else:status='unverifiable'
  states.append({**item,'state':status})
 if all(x['state'].startswith('gone') for x in states) or time.monotonic()>deadline:break
 time.sleep(.1)
paths=set()
for h in report.get('resource',{}).get('preflight',{}).get('helpers',[]):
 for g in h['generations']:
  p=pathlib.Path(g['dir']);assert p.parent==pathlib.Path('/private/tmp') and re.fullmatch(r'wy-ab-[a-f0-9]{24}',p.name)
  for name in g['socketNames']:
   assert pathlib.PurePath(name).name==name
   paths.add(p/name)
endpoints=[]
for port in report.get('ports',[3425]):
 assert type(port) is int and 0<port<65536
 with socket.socket() as sock:
  sock.settimeout(.5)
  endpoints.append({'port':port,'connectEx':sock.connect_ex(('127.0.0.1',port))})
db=pathlib.Path(report['userData'])/'smartdd.db'
private_root=pathlib.Path(report['privateRoot']).resolve()
assert private_root.parent==pathlib.Path('/private/tmp') and private_root.name.startswith('willyou-m16-b11-private-') and db.resolve().parent==private_root/'data'
lsof=subprocess.run(['/usr/sbin/lsof','-t','--',str(db)],capture_output=True,text=True)
handlesClosed=lsof.returncode==1 and not lsof.stdout.strip() and not lsof.stderr.strip()
counter=n.coalition_counter(lease['resourceId'])
# A released resource coalition is either ESRCH or has zero remaining live tasks.
coalitionEmpty=(counter['tasks_started']==counter['tasks_exited']) if counter['rc']==0 else (True if counter['errno']==errno.ESRCH else None)
out={'scope':'exact recorded owned births, derived helper metadata paths, recorded own ports and private DB only','knownBirths':len(known),'allKnownBirthsAbsent':bool(known) and all(x['state'].startswith('gone') for x in states),'knownRows':states,'knownHelperPaths':len(paths),'allKnownHelperPathsAbsent':bool(paths) and not any(x.exists() or x.is_symlink() for x in paths),'ports':endpoints,'allKnownPortsClosed':bool(endpoints) and all(x['connectEx']!=0 for x in endpoints),'privateDatabaseHandlesClosed':handlesClosed,'coalitionEmpty':coalitionEmpty,'coalitionFinal':counter,'appExit':report.get('exit'),'driverExit':driver}
out['resourcesReleased']=all(out[k] for k in ['allKnownBirthsAbsent','allKnownHelperPathsAbsent','allKnownPortsClosed','privateDatabaseHandlesClosed']) and out['coalitionEmpty'] is True and out['appExit'] is not None and out['appExit'].get('code')==0 and out['appExit'].get('signal') is None
out['clean']=out['resourcesReleased'] and not driver.get('stopSent') and driver.get('terminationReason')==1 and driver.get('terminationStatus')==0
(run/'independent-cleanup.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k not in ['knownRows','coalitionFinal']}))
