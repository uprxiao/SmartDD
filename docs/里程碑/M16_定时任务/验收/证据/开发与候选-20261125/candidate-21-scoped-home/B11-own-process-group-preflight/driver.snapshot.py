#!/usr/bin/env python3
"""One scoped own test process-group experiment; no App, no global process scan."""
import os, sys, time, json, pathlib, tempfile, uuid, hashlib, errno
sys.path.insert(0, '/private/tmp/willyou-m16-f36-qa/resource-sampler')
from cpu_collector import Native

ROOT=pathlib.Path(tempfile.mkdtemp(prefix='willyou-m16-b11-own-pgrp-',dir='/private/tmp'))
NONCE=uuid.uuid4().hex
start=time.monotonic()
report={'scope':'Only this run forks a unique setsid group leader/intermediate/orphan child. No PIDs outside exact group or test-created lease inspected. No App/30min/performance claim.','root':str(ROOT),'source':'Apple libproc proc_listpgrppids, public wrapper count is number of PIDs; https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/libsyscall/wrappers/libproc/libproc.c','startedAt':time.time()}
def save(name,v):
 f=ROOT/name
 tmp=ROOT/(name+'.tmp')
 tmp.write_text(json.dumps({'nonce':NONCE,**v},indent=2)+'\n')
 os.chmod(tmp,0o600)
 os.replace(tmp,f)
def read(name):
 p=ROOT/name
 try:
  v=json.loads(p.read_text());assert v['nonce']==NONCE;return v
 except FileNotFoundError:return None
def wait_file(name,timeout=6):
 limit=time.monotonic()+timeout
 while time.monotonic()<limit:
  v=read(name)
  if v is not None:return v
  time.sleep(.04)
 raise RuntimeError('bounded waiting '+name)
def marker():
 return {'pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp(),'sid':os.getsid(0),'uid':os.getuid(),'at':time.time()}
def child_worker():
 try:
  save('child-ready.json',marker())
  wait_file('exit-child.json',20)
  save('child-exit.json',marker())
  os._exit(0)
 except Exception as e:
  save('child-failure.json',{'message':str(e)});os._exit(2)
def parent_worker():
 try:
  child=os.fork()
  if child==0:child_worker()
  save('parent-ready.json',{**marker(),'childPid':child})
  wait_file('release-parent.json',15)
  os._exit(0)  # Deliberate own test reparent, child still held.
 except Exception as e:
  save('parent-failure.json',{'message':str(e)});os._exit(2)
def leader_worker():
 try:
  os.setsid()
  assert os.getpgrp()==os.getpid() and os.getsid(0)==os.getpid()
  parent=os.fork()
  if parent==0:parent_worker()
  save('leader-ready.json',{**marker(),'parentPid':parent})
  p,status=os.waitpid(parent,0)
  save('parent-reaped.json',{'pid':p,'rawStatus':status,'exitCode':os.waitstatus_to_exitcode(status),'at':time.time()})
  wait_file('stop-leader.json',20)
  os._exit(0)
 except Exception as e:
  save('leader-failure.json',{'message':str(e)});os._exit(2)

leader=os.fork()
if leader==0:leader_worker()
known={leader};native=None;child=None;parent=None
report['leaderForkPid']=leader
try:
 L=wait_file('leader-ready.json');P=wait_file('parent-ready.json');K=wait_file('child-ready.json');parent=P['pid'];child=K['pid'];known={leader,parent,child}
 assert L['pid']==leader and L['parentPid']==parent and P['ppid']==leader and P['childPid']==child and K['ppid']==parent and len(known)==3
 for x in (L,P,K):assert x['pgid']==x['sid']==leader and x['uid']==os.getuid()
 native=Native();C=native.C
 native.lib.proc_listpgrppids.argtypes=[C.c_int,C.c_void_p,C.c_int];native.lib.proc_listpgrppids.restype=C.c_int
 def own_bsd(pid):
  assert pid in known,'Never query unknown PID'
  b=native.BSD();C.set_errno(0);n=native.lib.proc_pidinfo(pid,3,0,C.byref(b),C.sizeof(b));e=C.get_errno()
  if n!=C.sizeof(b) or e!=0 or b.pid!=pid:raise RuntimeError('own BSD unavailable '+str(pid)+' errno='+str(e))
  assert b.uid==os.getuid() and b.pgid==leader and b.birthSec>0
  return {'pid':int(b.pid),'ppid':int(b.ppid),'pgid':int(b.pgid),'uid':int(b.uid),'status':int(b.status),'birthSec':int(b.birthSec),'birthUsec':int(b.birthUsec),'bytes':n}
 def exact(pid):
  a=own_bsd(pid);cid=native.coalition_id(pid);b=own_bsd(pid)
  assert a==b and cid['pid']==pid and cid['errno']==0 and cid['bytes']==C.sizeof(native.Coalitions) and cid['resourceId']>0
  return {'bsd':a,'coalition':{'resourceId':cid['resourceId'],'jetsamId':cid['jetsamId']}}
 def group_members(expected):
  # Verify still exact owned group leader *before and after* public pgrp enumeration.
  a=exact(leader);assert a['bsd']['pid']==a['bsd']['pgid']==leader
  slots=16;buf=(C.c_int*slots)(*([-777777]*slots));C.set_errno(0);n=native.lib.proc_listpgrppids(leader,buf,C.sizeof(buf));e=C.get_errno();b=exact(leader)
  assert a==b and 0<n<slots and e==0
  ids=set(buf[:n]);assert len(ids)==n and all(x>0 for x in ids)
  if not ids.issubset(known):raise RuntimeError('unexpected group member; no unknown PID observed further')
  assert ids==set(expected),'exact synthetic group membership differs'
  return {'pgrp':leader,'returnCount':n,'errno':e,'members':sorted(ids),'leader':a}
 def identity_birth(row):
  return (row['bsd']['pid'],row['bsd']['birthSec'],row['bsd']['birthUsec'],row['bsd']['pgid'],row['coalition']['resourceId'])
 initial={str(p):exact(p) for p in sorted(known)}
 assert initial[str(parent)]['bsd']['ppid']==leader and initial[str(child)]['bsd']['ppid']==parent
 assert len({x['coalition']['resourceId'] for x in initial.values()})==1
 first=group_members(known)
 left,_=native.children(leader);right,_=native.children(parent)
 assert set(left)=={parent} and set(right)=={child}
 report['before']={'selfCreatedReceipts':[L,P,K],'identities':initial,'pgrp':first,'treeLeaderChildren':left,'treeParentChildren':right}
 save('release-parent.json',{'at':time.time()})
 reaped=wait_file('parent-reaped.json');assert reaped['pid']==parent and reaped['exitCode']==0
 # Observe exact own child now reparented, still alive with same birth/CID/pgrp.
 end=time.monotonic()+4;new=None
 while time.monotonic()<end:
  z=exact(child)
  if z['bsd']['ppid']!=parent:new=z;break
  time.sleep(.04)
 assert new and new['bsd']['ppid']!=leader,'Child was not independently reparented away from known parent tree'
 assert identity_birth(new)==identity_birth(initial[str(child)])
 result=[]
 for _ in range(3):
  current=exact(child);assert identity_birth(current)==identity_birth(initial[str(child)]) and current['bsd']['ppid']==new['bsd']['ppid']
  pgrp=group_members({leader,child})
  left,_=native.children(leader);assert child not in left and parent not in left
  result.append({'at':time.time(),'actualReparentedChild':current,'ownRootChildren':left,'sameOwnPgrpMembers':pgrp})
  time.sleep(.05)
 report['after']={'parentNaturalReap':reaped,'threeStableActualSamples':result}
 report['status']='public-own-pgrp-enumerates-reparented-same-group-child'
except Exception as e:
 report['status']='incomplete';report['error']=str(e)
finally:
 # File signals only to own test children; ordinary exits. No signals to unknown or re-used numeric PID.
 for n in ('release-parent.json','exit-child.json','stop-leader.json'):
  if not (ROOT/n).exists():save(n,{'at':time.time()})
 try:
  deadline=time.monotonic()+25;exit_row=None
  while time.monotonic()<deadline:
   p,status=os.waitpid(leader,os.WNOHANG)
   if p==leader:
    exit_row={'pid':leader,'rawStatus':status,'exitCode':os.waitstatus_to_exitcode(status)};break
   time.sleep(.05)
  report['leaderExit']=exit_row
  if child is not None:
   report['childExitReceipt']=wait_file('child-exit.json',3)
  # Verify only the exact test-created identities disappeared; never read another process after birth mismatch.
  if native and report.get('before'):
   gone={}
   deadline=time.monotonic()+4
   while time.monotonic()<deadline:
    gone={}
    for pid in known:
     b=native.BSD();native.C.set_errno(0);n=native.lib.proc_pidinfo(pid,3,0,native.C.byref(b),native.C.sizeof(b));e=native.C.get_errno()
     gone[str(pid)]='gone' if n==0 and e==errno.ESRCH else ('same-identity-still-present' if n==native.C.sizeof(b) and b.pid==pid and (int(b.birthSec),int(b.birthUsec))==(report['before']['identities'][str(pid)]['bsd']['birthSec'],report['before']['identities'][str(pid)]['bsd']['birthUsec']) else 'unverifiable-or-reused-no-further-query')
    if all(v=='gone' for v in gone.values()):break
    time.sleep(.05)
   report['cleanup']=gone
   if not all(v=='gone' for v in gone.values()):report['status']='incomplete-cleanup-observation'
 except Exception as e:report['cleanupError']=str(e);report['status']='incomplete-cleanup-observation'
 report['elapsedSeconds']=time.monotonic()-start
 file=ROOT/'result.json';file.write_text(json.dumps(report,indent=2)+'\n');os.chmod(file,0o600)
 print(json.dumps({'root':str(ROOT),'status':report['status'],'elapsedSeconds':report['elapsedSeconds'],'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'cleanup':report.get('cleanup'),'error':report.get('error')}))
 sys.exit(0 if report['status']=='public-own-pgrp-enumerates-reparented-same-group-child' else 1)
