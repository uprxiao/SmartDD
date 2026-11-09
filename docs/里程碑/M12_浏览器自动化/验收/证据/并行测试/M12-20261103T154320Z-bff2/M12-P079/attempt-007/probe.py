"""Own-coalition read-only probe; no App/UI/ports or coalition reassignment."""
import ctypes as C
import json
import os
import resource
import select
import signal
import sys
import time

class Coalitions(C.Structure):
    _fields_ = [('ids', C.c_uint64 * 2), ('reserved', C.c_uint64 * 3)]

class Prefix(C.Structure):
    _fields_ = [(n, C.c_uint64) for n in ('tasks_started', 'tasks_exited', 'time_nonempty', 'cpu_time')]

class BSD(C.Structure):
    _fields_ = [(n, C.c_uint32) for n in ('flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','reserved')] + [('comm', C.c_char*16), ('name', C.c_char*32)] + [(n,C.c_uint32) for n in ('nfiles','pgid','pjobc','tdev','tpgid')] + [('nice',C.c_int32),('birthSec',C.c_uint64),('birthUsec',C.c_uint64)]

class Timebase(C.Structure):
    _fields_ = [('numer', C.c_uint32), ('denom', C.c_uint32)]

def main():
    assert '--execute' in sys.argv
    raw = {'events': [], 'errors': [], 'scope': 'only self resource coalition; controlled fork descendants; no App'}
    def record(kind, **values):
        item = {'kind': kind, 'monotonicNs': time.monotonic_ns(), **values}
        raw['events'].append(item)
        print(json.dumps(item), flush=True)
        return item
    def alarm(_a, _b):
        raise TimeoutError('4-second probe bound')
    signal.signal(signal.SIGALRM, alarm)
    signal.setitimer(signal.ITIMER_REAL, 4)
    middle = None
    fds = []
    try:
        lib = C.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        system = C.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
        lib.proc_pidinfo.argtypes = [C.c_int,C.c_int,C.c_uint64,C.c_void_p,C.c_int]
        lib.proc_pidinfo.restype = C.c_int
        query = system.coalition_info_resource_usage
        query.argtypes = [C.c_uint64, C.c_void_p, C.c_size_t]
        query.restype = C.c_int
        system.mach_timebase_info.argtypes = [C.POINTER(Timebase)]
        system.mach_timebase_info.restype = C.c_int
        assert C.sizeof(Coalitions) == 40 and C.sizeof(Prefix) == 32 and C.sizeof(BSD) == 136
        tb = Timebase()
        assert system.mach_timebase_info(C.byref(tb)) == 0 and tb.numer and tb.denom
        def self_id():
            c = Coalitions(); C.set_errno(0)
            n = lib.proc_pidinfo(os.getpid(),20,0,C.byref(c),C.sizeof(c)); e = C.get_errno()
            if n != 40 or e: raise OSError(e, f'proc_pidinfo coalition bytes={n}')
            b = BSD(); C.set_errno(0)
            n = lib.proc_pidinfo(os.getpid(),3,0,C.byref(b),C.sizeof(b)); e = C.get_errno()
            if n != 136 or e or b.uid != os.getuid(): raise OSError(e, 'self BSD identity')
            return {'pid':os.getpid(),'ppid':os.getppid(),'uid':os.getuid(),'resourceId':int(c.ids[0]),'jetsamId':int(c.ids[1]),'birthSec':int(b.birthSec),'birthUsec':int(b.birthUsec)}
        identity = self_id(); cid = identity['resourceId']
        assert cid > 0
        record('self', **identity, timebase={'numer':tb.numer,'denom':tb.denom}, prefixSize=32)
        def usage(label):
            p = Prefix(); C.set_errno(0)
            rc = query(cid, C.byref(p), C.sizeof(p)); e = C.get_errno()
            item = record(label, rc=rc, errno=e, resourceId=cid, **{n:int(getattr(p,n)) for n,_ in p._fields_})
            if rc != 0 or e: raise OSError(e, 'own coalition read unsupported/denied')
            return item
        usage('before')
        rr, rw = os.pipe(); gr, gw = os.pipe(); fds = [rr,rw,gr,gw]
        middle = os.fork()
        if middle == 0:
            signal.alarm(2)
            os.close(rr); os.close(gw)
            daemon = os.fork()
            if daemon:
                os.close(rw); os.close(gr); os._exit(0)
            try:
                signal.alarm(2)
                os.setsid()
                born = self_id()
                os.write(1,(json.dumps({'kind':'daemonOwnedIdentity',**born})+'\n').encode())
                os.write(rw,(json.dumps({'kind':'daemonBorn',**born})+'\n').encode())
                if os.read(gr,1) != b'G': os._exit(3)
                end = time.monotonic()+0.5
                while os.getppid() != 1 and time.monotonic() < end: time.sleep(0.001)
                identity_after = self_id()
                t0 = time.process_time_ns()
                while time.process_time_ns()-t0 < 50_000_000: pass
                u = resource.getrusage(resource.RUSAGE_SELF)
                os.write(rw,(json.dumps({'kind':'daemonFinished',**identity_after,'burnNs':time.process_time_ns()-t0,'usageUserSeconds':u.ru_utime,'usageSystemSeconds':u.ru_stime})+'\n').encode())
                os.close(rw); os.close(gr); os._exit(0)
            except BaseException as ex:
                os.write(rw,(json.dumps({'kind':'daemonError','error':repr(ex)})+'\n').encode()); os._exit(4)
        os.close(rw); os.close(gr); fds = [rr,gw]
        _, status = os.waitpid(middle,0); record('middleReaped',pid=middle,status=status); middle=None
        os.write(gw,b'G'); os.close(gw); fds=[rr]
        data = b''
        while True:
            if not select.select([rr],[],[],0.7)[0]: raise TimeoutError('daemon pipe')
            block = os.read(rr,8192)
            if not block: break
            data += block
        for line in data.splitlines():
            item = json.loads(line); kind=item.pop('kind'); record(kind,**item)
        os.close(rr); fds=[]
        usage('afterDetachedExit')
        time.sleep(0.01)
        usage('settled')
    except BaseException as ex:
        raw['errors'].append(repr(ex)); record('error',error=repr(ex))
    finally:
        for fd in fds:
            try: os.close(fd)
            except OSError: pass
        if middle is not None:
            try: os.kill(middle, signal.SIGKILL)
            except ProcessLookupError: pass
            try: os.waitpid(middle,0)
            except ChildProcessError: pass
        signal.setitimer(signal.ITIMER_REAL,0)
        record('probeFinal', errors=len(raw['errors']), noApp=True, noPorts=True, detachedChildSelfAlarmSeconds=2)
    return int(bool(raw['errors']))

if __name__ == '__main__':
    if '--execute' not in sys.argv: raise SystemExit('Requires explicit --execute; importing does not call native APIs')
    raise SystemExit(main())
