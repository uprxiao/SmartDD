"""Read-only coalition side stream. Native methods called only by leased collector."""
import time

FIELDS = ('tasks_started','tasks_exited','time_nonempty','cpu_time')

def integer(x):
    return type(x) is int and 0 <= x < 2**64

def identity_valid(row, expected, uid, abi):
    b,u=row.get('bsd',{}),row.get('rusage',{})
    birth=expected['birth']
    return (b.get('bytes')==abi['bsdSize'] and b.get('errno')==0 and b.get('pid')==birth['pid']
        and b.get('uid')==uid and b.get('birthSec')==birth['birthSec'] and b.get('birthUsec')==birth['birthUsec']
        and u.get('rc')==0 and u.get('errno')==0 and u.get('exitAbstime')==0
        and u.get('startAbstime')==birth['startAbstime'] and row.get('path')==expected['path']
        and row.get('pathRc',0)>0 and row.get('pathErrno')==0)

def cid_valid(row,pid):
    return (row.get('pid')==pid and row.get('bytes')==40 and row.get('errno')==0
        and integer(row.get('resourceId')) and row['resourceId']>0
        and integer(row.get('jetsamId')) and row.get('reserved')==[0,0,0]
        and integer(row.get('startNs')) and integer(row.get('endNs')) and row['endNs']>=row['startNs'])

def counter_valid(row,cid):
    return (integer(row.get('resourceId')) and row.get('resourceId')==cid and row.get('rc')==0 and row.get('errno')==0
        and row.get('prefixBytes')==32 and all(integer(row.get(k)) for k in FIELDS)
        and row['tasks_started']>=row['tasks_exited']
        and integer(row.get('startNs')) and integer(row.get('endNs')) and row['endNs']>=row['startNs'])

class CoalitionTracker:
    def __init__(self,native,anchors):
        self.n=native;self.anchors=anchors;self.bindings={};self.baseline={};self.last={}
    def capture(self,phase):
        start=time.monotonic_ns();reads=[];bindings={};self.partial={'phase':phase,'startNs':start,'anchorReads':reads,'counters':[]}
        for pid,expected in sorted(self.anchors.items()):
            before=self.n.read(pid)
            attempt={'pid':pid,'expected':expected,'before':before};reads.append(attempt)
            if not identity_valid(before,expected,self.n.uid,self.n.abi):raise RuntimeError('coalition own-anchor identity precheck failed '+str(pid))
            cid=self.n.coalition_id(pid)
            after=self.n.read(pid);attempt.update(coalition=cid,after=after)
            if not cid_valid(cid,pid) or not identity_valid(after,expected,self.n.uid,self.n.abi):raise RuntimeError('coalition own-anchor permission/ABI/identity failed '+str(pid))
            bindings[str(pid)]=cid['resourceId']
        if self.bindings and bindings!=self.bindings:raise RuntimeError('retained anchor coalition changed')
        counters=self.partial['counters']
        for cid in sorted(set(bindings.values())):
            row=self.n.coalition_counter(cid);counters.append(row)
            if not counter_valid(row,cid):raise RuntimeError('coalition counter permission/ABI/structure failed '+str(cid))
            if cid in self.last and any(row[k]<self.last[cid][k] for k in FIELDS):raise RuntimeError('coalition counter decreased '+str(cid))
        if not self.bindings:
            self.bindings=bindings;self.baseline={x['resourceId']:x for x in counters}
        self.last={x['resourceId']:x for x in counters}
        return {'phase':phase,'uid':self.n.uid,'startNs':start,'endNs':time.monotonic_ns(),'anchorReads':reads,'bindings':bindings,'resourceIds':sorted(self.last),'counters':counters,'notAppExclusive':True}
