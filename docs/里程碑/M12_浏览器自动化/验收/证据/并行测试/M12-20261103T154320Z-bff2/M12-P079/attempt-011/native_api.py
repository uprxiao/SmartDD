"""Exact Native class extracted from executed long004; no instantiation at import."""
import os,sys,time
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
  class Coalitions(C.Structure):_fields_=[('ids',C.c_uint64*2),('reserved',C.c_uint64*3)]
  class CoalitionPrefix(C.Structure):_fields_=[(name,C.c_uint64) for name in ('tasks_started','tasks_exited','time_nonempty','cpu_time')]
  self.Coalitions=Coalitions;self.CoalitionPrefix=CoalitionPrefix;self.uid=os.getuid()
  if C.sizeof(Coalitions)!=40 or C.sizeof(CoalitionPrefix)!=32:raise RuntimeError('coalition private-prefix ABI mismatch')
  self.BSD=BSD;self.Usage=Usage;self.names=names
  self.lib=C.CDLL('/usr/lib/libproc.dylib',use_errno=True)
  self.lib.proc_pidinfo.argtypes=[C.c_int,C.c_int,C.c_uint64,C.c_void_p,C.c_int];self.lib.proc_pidinfo.restype=C.c_int
  self.lib.proc_pid_rusage.argtypes=[C.c_int,C.c_int,C.c_void_p];self.lib.proc_pid_rusage.restype=C.c_int
  self.lib.proc_listchildpids.argtypes=[C.c_int,C.c_void_p,C.c_int];self.lib.proc_listchildpids.restype=C.c_int
  self.lib.proc_pidpath.argtypes=[C.c_int,C.c_void_p,C.c_uint32];self.lib.proc_pidpath.restype=C.c_int
  system=C.CDLL('/usr/lib/libSystem.B.dylib',use_errno=True);system.mach_timebase_info.argtypes=[C.POINTER(Timebase)];system.mach_timebase_info.restype=C.c_int
  self.coalitionQuery=system.coalition_info_resource_usage;self.coalitionQuery.argtypes=[C.c_uint64,C.c_void_p,C.c_size_t];self.coalitionQuery.restype=C.c_int
  t=Timebase();rc=system.mach_timebase_info(C.byref(t))
  if rc or not t.numer or not t.denom or C.sizeof(BSD)!=136 or C.sizeof(Usage)!=160:raise RuntimeError('SDK ABI/timebase gate failed')
  self.abi={'bsdSize':C.sizeof(BSD),'v2Size':C.sizeof(Usage),'numer':t.numer,'denom':t.denom,'pidSize':C.sizeof(C.c_int)}
 def read(self,pid):
  C=self.C;before=time.monotonic_ns();b=self.BSD();C.set_errno(0);br=self.lib.proc_pidinfo(pid,3,0,C.byref(b),C.sizeof(b));be=C.get_errno()
  u=self.Usage();C.set_errno(0);ur=self.lib.proc_pid_rusage(pid,2,C.byref(u));ue=C.get_errno()
  p=C.create_string_buffer(4096);C.set_errno(0);pr=self.lib.proc_pidpath(pid,p,len(p));pe=C.get_errno()
  return {'pid':pid,'startReadNs':before,'endReadNs':time.monotonic_ns(),'bsd':{'bytes':br,'errno':be,'pid':b.pid,'ppid':b.ppid,'uid':b.uid,'status':b.status,'birthSec':b.birthSec,'birthUsec':b.birthUsec},'rusage':dict(rc=ur,errno=ue,**{x:int(getattr(u,x)) for x in self.names}),'path':p.value.decode(errors='replace') if pr>0 else None,'pathRc':pr,'pathErrno':pe}
 def coalition_id(self,pid):
  C=self.C;v=self.Coalitions();start=time.monotonic_ns();C.set_errno(0);rc=self.lib.proc_pidinfo(pid,20,0,C.byref(v),C.sizeof(v));error=C.get_errno()
  return {'pid':pid,'startNs':start,'endNs':time.monotonic_ns(),'bytes':rc,'errno':error,'resourceId':int(v.ids[0]),'jetsamId':int(v.ids[1]),'reserved':list(v.reserved)}
 def coalition_counter(self,cid):
  C=self.C;v=self.CoalitionPrefix();start=time.monotonic_ns();C.set_errno(0);rc=self.coalitionQuery(cid,C.byref(v),C.sizeof(v));error=C.get_errno()
  return {'resourceId':cid,'startNs':start,'endNs':time.monotonic_ns(),'rc':rc,'errno':error,'prefixBytes':C.sizeof(v),**{n:int(getattr(v,n)) for n,_ in v._fields_}}
 def children(self,pid):
  C=self.C;attempts=[];slots=32
  while slots<=65536:
   buf=(C.c_int*slots)(*([-777777]*slots));C.set_errno(0);begin=time.monotonic_ns();ret=self.lib.proc_listchildpids(pid,buf,C.sizeof(buf));error=C.get_errno()
   valid=list(buf[:max(0,min(ret,slots))]);attempts.append({'slots':slots,'bytes':C.sizeof(buf),'returnCount':ret,'errno':error,'pids':valid,'startNs':begin,'endNs':time.monotonic_ns()})
   if ret<0 or error!=0:raise InventoryError('child-list error',attempts)
   if ret>=slots:slots*=2;continue
   if any(p<=0 for p in valid) or len(set(valid))!=len(valid):raise InventoryError('invalid child-list',attempts)
   return valid,attempts
  raise InventoryError('child-list capacity not closed',attempts)
