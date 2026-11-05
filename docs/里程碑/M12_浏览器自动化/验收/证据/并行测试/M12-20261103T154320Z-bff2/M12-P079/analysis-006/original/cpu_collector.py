#!/usr/bin/env python3
"""Blocking private Darwin collector. Native APIs load only inside --serve.
Separate from the unchanged psutil own/RSS stream; no App mutation or signals.
"""
import argparse,errno,json,math,os,sys,time

class Native:
 def __init__(self):
  if sys.platform!='darwin':raise RuntimeError('Darwin required')
  import ctypes as C
  self.C=C
  class BSD(C.Structure):
   _fields_=[(x,C.c_uint32) for x in ['flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','reserved']]+[('comm',C.c_char*16),('name',C.c_char*32)]+[(x,C.c_uint32) for x in ['nfiles','pgid','pjobc','tdev','tpgid']]+[('nice',C.c_int32),('birthSec',C.c_uint64),('birthUsec',C.c_uint64)]
  names=['user','system','idleWake','interruptWake','pageins','wired','rss','footprint','startAbstime','exitAbstime','childUser','childSystem','childIdleWake','childInterruptWake','childPageins','childElapsed','diskRead','diskWrite']
  class Usage(C.Structure):_fields_=[('uuid',C.c_uint8*16)]+[(x,C.c_uint64) for x in names]
  class Timebase(C.Structure):_fields_=[('numer',C.c_uint32),('denom',C.c_uint32)]
  self.BSD=BSD;self.Usage=Usage;self.names=names
  self.lib=C.CDLL('/usr/lib/libproc.dylib',use_errno=True)
  self.lib.proc_pidinfo.argtypes=[C.c_int,C.c_int,C.c_uint64,C.c_void_p,C.c_int];self.lib.proc_pidinfo.restype=C.c_int
  self.lib.proc_pid_rusage.argtypes=[C.c_int,C.c_int,C.c_void_p];self.lib.proc_pid_rusage.restype=C.c_int
  self.lib.proc_listchildpids.argtypes=[C.c_int,C.c_void_p,C.c_int];self.lib.proc_listchildpids.restype=C.c_int
  self.lib.proc_pidpath.argtypes=[C.c_int,C.c_void_p,C.c_uint32];self.lib.proc_pidpath.restype=C.c_int
  system=C.CDLL('/usr/lib/libSystem.B.dylib',use_errno=True);system.mach_timebase_info.argtypes=[C.POINTER(Timebase)];system.mach_timebase_info.restype=C.c_int
  t=Timebase();rc=system.mach_timebase_info(C.byref(t))
  if rc or not t.numer or not t.denom or C.sizeof(BSD)!=136 or C.sizeof(Usage)!=160:raise RuntimeError('SDK ABI/timebase gate failed')
  self.abi={'bsdSize':C.sizeof(BSD),'v2Size':C.sizeof(Usage),'numer':t.numer,'denom':t.denom,'pidSize':C.sizeof(C.c_int)}
 def read(self,pid):
  C=self.C;before=time.monotonic_ns();b=self.BSD();C.set_errno(0);br=self.lib.proc_pidinfo(pid,3,0,C.byref(b),C.sizeof(b));be=C.get_errno()
  u=self.Usage();C.set_errno(0);ur=self.lib.proc_pid_rusage(pid,2,C.byref(u));ue=C.get_errno()
  p=C.create_string_buffer(4096);C.set_errno(0);pr=self.lib.proc_pidpath(pid,p,len(p));pe=C.get_errno()
  return {'pid':pid,'startReadNs':before,'endReadNs':time.monotonic_ns(),'bsd':{'bytes':br,'errno':be,'pid':b.pid,'ppid':b.ppid,'uid':b.uid,'status':b.status,'birthSec':b.birthSec,'birthUsec':b.birthUsec},'rusage':dict(rc=ur,errno=ue,**{x:int(getattr(u,x)) for x in self.names}),'path':p.value.decode(errors='replace') if pr>0 else None,'pathRc':pr,'pathErrno':pe}
 def children(self,pid):
  C=self.C;attempts=[];slots=32
  while slots<=65536:
   buf=(C.c_int*slots)(*([-777777]*slots));C.set_errno(0);begin=time.monotonic_ns();ret=self.lib.proc_listchildpids(pid,buf,C.sizeof(buf));error=C.get_errno()
   valid=list(buf[:max(0,min(ret,slots))]);attempts.append({'slots':slots,'bytes':C.sizeof(buf),'returnCount':ret,'errno':error,'pids':valid,'startNs':begin,'endNs':time.monotonic_ns()})
   if ret<0:raise RuntimeError('child-list error '+json.dumps(attempts))
   if ret>=slots:slots*=2;continue
   if any(p<=0 for p in valid) or len(set(valid))!=len(valid):raise RuntimeError('invalid child-list '+json.dumps(attempts))
   return valid,attempts
  raise RuntimeError('child-list capacity not closed '+json.dumps(attempts))

class Collector:
 def __init__(self,native):self.n=native;self.anchors={};self.credits={};self.births={};self.parents={};self.gaps=[];self.inited=False;self.helperPages={};self.metricPids=set();self.captureNo=0
 def gap(self,code,**detail):self.gaps.append({'capture':self.captureNo,'code':code,**detail})
 def identity(self,row,parent=None,ownedListConfirmed=False):
  u=row['rusage'];b=row['bsd'];pid=row['pid']
  if u['rc']!=0 or not u['startAbstime']:return None
  key=str(pid)+':'+str(u['startAbstime']);valid=b['bytes']==self.n.abi['bsdSize'] and b['pid']==pid
  if valid and b['uid']!=os.getuid():self.gap('uid-mismatch',pid=pid);return None
  old=self.births.get(key)
  if valid:
   birth={'pid':pid,'startAbstime':u['startAbstime'],'birthSec':b['birthSec'],'birthUsec':b['birthUsec'],'path':row['path']}
   if old and (old['birthSec'],old['birthUsec'])!=(birth['birthSec'],birth['birthUsec']):self.gap('birth-conflict',identity=key)
   self.births[key]=birth
  elif old:birth=old
  elif parent is not None and ownedListConfirmed and u['exitAbstime']:
   # Known real parent's two inventories bind an unreaped PID; no BSD fiction.
   birth={'pid':pid,'startAbstime':u['startAbstime'],'birthSec':None,'birthUsec':None,'path':None,'kernelParentList':parent,'terminatedUnreaped':True};self.births[key]=birth
  else:self.gap('identity-unverifiable',pid=pid,parent=parent);return None
  return key
 def credit(self,key,row):
  u=row['rusage'];own=u['user']+u['system'];child=u['childUser']+u['childSystem'];old=self.credits.get(key)
  if old and (own<old['maxOwnRaw'] or child<old['maxChildRaw']):self.gap('counter-decreased',identity=key)
  self.credits[key]={'maxOwnRaw':max(own,old['maxOwnRaw'] if old else 0),'maxChildRaw':max(child,old['maxChildRaw'] if old else 0),'lastCapture':self.captureNo,'pid':row['pid']}
 def init(self,req):
  if self.inited:raise RuntimeError('collector already initialized')
  for anchor in req['anchors']:
   pid=int(anchor['pid']);row=self.n.read(pid);key=self.identity(row)
   if not key or row['rusage']['exitAbstime']:raise RuntimeError('retained anchor native identity unavailable '+str(pid))
   if anchor.get('expectedPath') and row['path']!=anchor['expectedPath']:raise RuntimeError('anchor executable mismatch')
   if 'createdAtEpochSeconds' in anchor:
    x=row['bsd']['birthSec']+row['bsd']['birthUsec']/1e6
    if abs(x-float(anchor['createdAtEpochSeconds']))>1e-6:raise RuntimeError('psutil/native birth mismatch')
   self.anchors[pid]={'identity':key,'birth':dict(self.births[key]),'role':anchor['role'],'path':row['path']};self.credit(key,row)
  self.helperPages={x['pageId']:x['pids'][0] for x in req['helpers'] if len(x['pids'])==1}
  if len(self.helperPages)!=5:raise RuntimeError('exact five fixed daemon identities required')
  if len(self.anchors)!=len(req['anchors']):raise RuntimeError('duplicate anchors')
  self.metricPids=set(req.get('electronMetricPids',[]));self.inited=True
  return {'kind':'cpu-initialized','collectorPid':os.getpid(),'abi':self.n.abi,'anchors':self.anchors,'credits':self.credits,'helperPages':self.helperPages,'scopeApproved':False}
 def capture(self,req):
  if not self.inited:raise RuntimeError('initialize first')
  self.captureNo+=1;start=time.monotonic_ns();nodes=[];families=[];races=[];seen=set();active=set();errors=[]
  helpers={x['pageId']:x['pids'][0] for x in req['helpers'] if len(x['pids'])==1}
  if helpers!=self.helperPages:self.gap('fixed-daemon-inventory-changed',actual=helpers,expected=self.helperPages)
  metrics=set(req['electronMetricPids']);expected_metrics=self.metricPids
  if metrics!=expected_metrics:self.gap('electron-anchor-set-changed',actual=sorted(metrics),expected=sorted(expected_metrics))
  def visit(pid,parent=None,anchor=False):
   if pid in active:self.gap('parent-cycle',pid=pid);return
   if pid in seen:return
   if len(seen)>=2048:self.gap('owned-node-limit');return
   seen.add(pid);active.add(pid)
   first=self.n.read(pid)
   if first['rusage']['rc']!=0:
    if anchor:self.gap('anchor-counter-unreadable',pid=pid,raw=first)
    else:races.append({'pid':pid,'parent':parent,'kind':'child-missing-before-read','raw':first,'reapOrOrphanUnresolved':True})
    active.remove(pid);return
   try:before,attempt1=self.n.children(pid)
   except Exception as exc:self.gap('child-inventory-unreadable',pid=pid,error=str(exc));active.remove(pid);return
   for child in before:
    # A fixed daemon may appear before orphaning during warm. During captures all
    # retained anchors remain separately pinned and are not silently reparented.
    visit(child,pid,child in self.anchors)
   try:after,attempt2=self.n.children(pid)
   except Exception as exc:self.gap('child-inventory-final-unreadable',pid=pid,error=str(exc));after=[];attempt2=[]
   last=self.n.read(pid)  # parent-after-children, not an earlier endpoint counter
   key=self.identity(last,parent,ownedListConfirmed=bool(parent is not None))
   # For a new zombie the caller's direct inventories, not this process's own
   # child-list, establish parenthood; unresolved cases remain explicitly gaps.
   if not key:key=self.identity(first,parent,ownedListConfirmed=False)
   if anchor:
    expected=self.anchors[pid]
    if key!=expected['identity'] or last['rusage']['rc'] or last['rusage']['exitAbstime'] or last['path']!=expected['path']:
     self.gap('retained-anchor-identity-or-life-changed',pid=pid,expected=expected,first=first,last=last)
   if key:
    for row in [first,last]:
     if row['rusage']['rc']==0 and row['rusage']['startAbstime']==int(key.split(':')[1]):self.credit(key,row)
    self.parents[key]=parent
   if parent is not None and last['rusage']['exitAbstime'] and last['bsd']['bytes']!=self.n.abi['bsdSize']:
    races.append({'pid':pid,'parent':parent,'kind':'unreaped-parent-binding-needs-post-inventory','rusageStartAbstime':last['rusage']['startAbstime']})
   for node in nodes:
    birth=self.births.get(node.get('identity'),{})
    if node.get('parentFromInventory')==pid and birth.get('terminatedUnreaped') and birth.get('kernelParentList')==pid:
     node['parentListBindingConfirmedAfterRead']=node['pid'] in after
     if node['pid'] not in after:self.gap('new-unreaped-parent-binding-raced',pid=node['pid'],parent=pid)
   if set(before)!=set(after):races.append({'pid':pid,'kind':'family-changed-during-scan','before':before,'after':after,'parentBeforeChildRaw':first['rusage']['childUser']+first['rusage']['childSystem'],'parentAfterChildRaw':last['rusage']['childUser']+last['rusage']['childSystem'] if last['rusage']['rc']==0 else None,'coverageConditionalOnWaitedLeafNoOrphan':True})
   if parent is not None and last['bsd']['bytes']==self.n.abi['bsdSize'] and last['bsd']['ppid']!=parent:
    self.gap('unexpected-reparent',pid=pid,expectedParent=parent,actualParent=last['bsd']['ppid'])
   nodes.append({'pid':pid,'parentFromInventory':parent,'identity':key,'anchor':anchor,'first':first,'last':last});families.append({'pid':pid,'before':before,'after':after,'attemptsBefore':attempt1,'attemptsAfter':attempt2});active.remove(pid)
  for pid in sorted(self.anchors):visit(pid,None,True)
  for race in races:
   # A missing/final-family change never becomes a zero or unconditional covered
   # result. The accounting proof must supply actual waited-leaf/no-orphan closure.
   if race.get('reapOrOrphanUnresolved'):self.gap('unresolved-reap-or-orphan',pid=race['pid'],parent=race['parent'])
  raw=sum(x['maxOwnRaw']+x['maxChildRaw'] for x in self.credits.values());abi=self.n.abi
  return {'kind':'cpu-upper-sample','requestId':req['requestId'],'capture':self.captureNo,'collectorPid':os.getpid(),'startNs':start,'endNs':time.monotonic_ns(),'finalCutBeforeScanNs':start if req.get('final') else None,'final':bool(req.get('final')),'abi':abi,'nodes':nodes,'families':families,'races':races,'anchors':self.anchors,'credits':self.credits,'births':self.births,'upperLifetimeRaw':raw,'upperLifetimeSeconds':raw*abi['numer']/abi['denom']/1e9,'gaps':list(self.gaps),'runtimeCountersReadable':not self.gaps,'scopeAssumptionsStillRequired':['closed-owned-anchor-inventory','all-hidden-transients-eventually-waited-by-retained-root-or-inventoried-unreaped','no-unaccounted-orphan','final-family-scan-race-closure'],'scopeApproved':False}

def main():
 p=argparse.ArgumentParser();p.add_argument('--serve',action='store_true');a=p.parse_args()
 if not a.serve:raise SystemExit('Native collector starts only --serve inside explicit isolated lease')
 native=Native();collector=Collector(native)
 for line in sys.stdin:
  req=None
  try:
   req=json.loads(line)
   if req.get('type')=='stop':print(json.dumps({'kind':'cpu-stopped','collectorPid':os.getpid(),'captures':collector.captureNo,'scopeApproved':False}),flush=True);return
   result=collector.init(req) if req['type']=='init' else collector.capture(req);result['requestId']=req['requestId'];print(json.dumps(result,separators=(',',':')),flush=True)
  except Exception as exc:print(json.dumps({'kind':'cpu-collector-error','requestId':req.get('requestId') if req else None,'error':type(exc).__name__+': '+str(exc),'scopeApproved':False}),flush=True)
if __name__=='__main__':main()
