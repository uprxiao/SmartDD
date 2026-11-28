#!/usr/bin/env python3
"""Read-only private native own-tree snapshot. No global process iteration.

Requires explicit exact isolated anchor lease from the current driver. CPU group
and live-count proof remain separate; a coherent candidate is not automatically
formal B11 scope approval. Do not use this outside one isolated test run.
"""
import sys,os,time,json,errno,pathlib,hashlib,sqlite3,re
from collections import deque
from closure_contract import exact_coherent,retry_resolution
sys.path.insert(0,'/private/tmp/willyou-m16-f36-qa/resource-sampler')
from cpu_collector import Native,InventoryError
from coalition_accounting import cid_valid,counter_valid
import psutil

class ScopeNative(Native):
 def bsd(self,pid):
  C=self.C;b=self.BSD();C.set_errno(0);rc=self.lib.proc_pidinfo(pid,3,0,C.byref(b),C.sizeof(b));err=C.get_errno();return {'pid':pid,'returnedPid':b.pid,'ppid':b.ppid,'uid':b.uid,'status':b.status,'bytes':rc,'errno':err,'birthSec':int(b.birthSec),'birthUsec':int(b.birthUsec)}
 def usage(self,pid):
  C=self.C;u=self.Usage();C.set_errno(0);rc=self.lib.proc_pid_rusage(pid,2,C.byref(u));err=C.get_errno();return {'rc':rc,'errno':err,**{x:int(getattr(u,x))for x in self.names}}
 def path(self,pid):
  C=self.C;p=C.create_string_buffer(4096);C.set_errno(0);rc=self.lib.proc_pidpath(pid,p,len(p));err=C.get_errno();return(rc,err,p.value.decode(errors='replace') if rc>0 else None)
 def bsd_ok(self,b,pid):return b['bytes']==self.abi['bsdSize'] and b['errno']==0 and b['returnedPid']==pid and b['uid']==self.uid and b['birthSec']>0
 def born(self,b):return f"{b['birthSec']}:{b['birthUsec']}"

class Collector:
 def __init__(self):self.n=ScopeNative();self.required={};self.lastCounter=None;self.previousAttempts=[];self.sequence=0;self.initialized=False
 def path_class(self,path):
  if path.startswith(self.bundle+'/'):return 'candidate/'+path[len(self.bundle)+1:]
  if path==self.cli:return 'verified-codex-exact-binary'
  if path.startswith(self.cohortRoot+'/'):return 'own-cohort/'+path[len(self.cohortRoot)+1:]
  if path in self.knownInstrumentPaths:return self.knownInstrumentPaths[path]
  if path.startswith('/usr/bin/') or path.startswith('/bin/') or path.startswith('/usr/sbin/'):return 'system/'+pathlib.Path(path).name
  # An exact owned descendant may legitimately have another executable. Do not
  # disclose local unrelated paths; keep equality binding in-memory and hash.
  return 'owned-path-sha256:'+hashlib.sha256(path.encode()).hexdigest()
 def counter(self):
  c=self.n.coalition_counter(self.cid)
  if not counter_valid(c,self.cid):raise RuntimeError('native counter invalid')
  if self.lastCounter and any(c[k]<self.lastCounter[k]for k in ('tasks_started','tasks_exited','cpu_time')):raise RuntimeError('native counter decreased')
  self.lastCounter=c;return c
 def exact_row(self,pid,parent=None,expected=None):
  # First minimal BSD ownership; do not query any path/RSS if not bound.
  first=self.n.bsd(pid)
  if not self.n.bsd_ok(first,pid):
   if first['errno']==errno.ESRCH and parent is not None and expected is None:
    second=self.n.bsd(pid)
    if second['errno']==errno.ESRCH:return None,{'kind':'candidate-all-esrch','pid':pid,'parent':parent,'firstOwnedInventory':True,'parentVerified':True,'minimalBefore':first,'minimalAfter':second}
   return None,{'kind':'unbound-native-bsd','pid':pid,'first':first}
  if parent is not None and first['ppid']!=parent and expected is None:return None,{'kind':'unbound-parent','pid':pid,'parent':parent,'actualParent':first['ppid']}
  birth=self.n.born(first)
  if expected and expected.get('birth') and expected['birth']!=birth:return None,{'kind':'anchor-birth-changed','pid':pid}
  cid=self.n.coalition_id(pid)
  if not cid_valid(cid,pid) or cid['resourceId']!=self.cid:return None,{'kind':'unbound-coalition','pid':pid}
  usage=self.n.usage(pid);rc,pe,path=self.n.path(pid)
  if usage['rc']!=0 or usage['errno']!=0 or usage['exitAbstime'] or not usage['startAbstime'] or rc<=0 or pe or not path:
   second=self.n.bsd(pid)
   failed=[usage['errno']]if usage['rc']!=0 or usage['errno']else[];failed+=([pe]if rc<=0 or pe else[])
   if expected is None and parent is not None and failed and all(e==errno.ESRCH for e in failed) and second['errno']==errno.ESRCH:return None,{'kind':'candidate-identity-disappeared','pid':pid,'parent':parent,'firstOwnedInventory':True,'parentVerified':True,'oldBirth':birth,'minimalBefore':first,'minimalAfter':second}
   return None,{'kind':'read-gap-after-owned-binding','pid':pid,'usageRc':usage['rc'],'usageErrno':usage['errno'],'pathRc':rc,'pathErrno':pe}
  if expected and expected.get('pathExact') and expected['pathExact']!=path:return None,{'kind':'anchor-executable-changed','pid':pid}
  if expected and expected.get('pathPrefix') and not path.startswith(expected['pathPrefix']):return None,{'kind':'anchor-executable-prefix-changed','pid':pid}
  try:rss=psutil.Process(pid).memory_info().rss
  except (psutil.NoSuchProcess,psutil.AccessDenied):return None,{'kind':'rss-unreadable-after-owned-binding','pid':pid}
  second=self.n.bsd(pid);cid2=self.n.coalition_id(pid);rc2,pe2,path2=self.n.path(pid) if self.n.bsd_ok(second,pid) and self.n.born(second)==birth and cid_valid(cid2,pid) and cid2['resourceId']==self.cid else (0,0,None)
  if not self.n.bsd_ok(second,pid) or self.n.born(second)!=birth or not cid_valid(cid2,pid) or cid2['resourceId']!=self.cid or path2!=path or rc2<=0 or pe2:return None,{'kind':'identity-raced-after-owned-binding','pid':pid}
  return {'pid':pid,'birth':birth,'startAbstime':usage['startAbstime'],'pathClass':self.path_class(path),'sameUid':True,'alive':True,'cid':self.cid,'stableBeforeAfter':True,'rss':rss,'nativeRss':usage['rss'],'nativeCpuUser':usage['user'],'nativeCpuSystem':usage['system'],'parent':second['ppid'],'minimalBefore':first,'minimalAfter':second},None
 def init(self,req):
  assert not self.initialized;self.cid=int(req['cid']);self.outsideCid=int(req['outsideCid']);assert self.cid>0 and self.cid!=self.outsideCid;self.bundle=str(pathlib.Path(req['bundle']).resolve());self.cohortRoot=str(pathlib.Path(req['cohortRoot']).resolve());self.cli=str(pathlib.Path(req['cli']).resolve());assert self.bundle.startswith('/private/tmp/willyou-') and self.bundle.endswith('/WillYou.app') and self.cohortRoot.startswith('/private/tmp/willyou-m16-f36-cohort-') and self.cli.startswith('/private/tmp/willyou-m16-verified-codex-')
  self.knownInstrumentPaths={req['node']:'own-driver-node',os.path.realpath(sys.executable):'own-sampler-python','/Library/Frameworks/Python.framework/Versions/3.11/Resources/Python.app/Contents/MacOS/Python':'own-sampler-python'}
  self.dbPath=str(pathlib.Path(req['dbPath']).resolve());self.taskIds=req['taskIds'];assert self.dbPath.startswith('/private/tmp/willyou-m16-f36-run-') and self.dbPath.endswith('/data/smartdd.db') and len(self.taskIds)==5 and len(set(self.taskIds))==5 and all(re.fullmatch(r'[a-f0-9-]{36}',t)for t in self.taskIds)
  self.db=sqlite3.connect('file:'+self.dbPath+'?mode=ro',uri=True,timeout=0.2)
  self.db.execute('PRAGMA query_only=ON')
  for a in req['requiredAnchors']:
   row,gap=self.exact_row(a['pid'],expected=a)
   if gap:raise RuntimeError('required anchor did not bind '+str(a['pid'])+':'+gap['kind'])
   self.required[a['pid']]={'birth':row['birth'],'pathClass':row['pathClass'],'role':a['role'],'pathExact':a.get('pathExact')}
  # Sampler itself is inside the measured coalition and is an exact instrument.
  row,gap=self.exact_row(os.getpid(),expected={'pathExact':None})
  if gap:raise RuntimeError('sampler itself not exact coalition member')
  self.required[os.getpid()]={'birth':row['birth'],'pathClass':row['pathClass'],'role':'instrument'}
  assert len(self.required)==len(req['requiredAnchors'])+1
  self.initialized=True;return {'kind':'scope-initialized','cid':self.cid,'outsideCid':self.outsideCid,'required':self.required,'samplerPid':os.getpid(),'abi':self.n.abi,'scopeApproved':False}
 def owned_children(self,pid,row):
  # Never deliberately query a family from an unbound or reused numeric PID.
  first=self.n.bsd(pid)
  if not self.n.bsd_ok(first,pid) or self.n.born(first)!=row['birth']:return None,None,{'kind':'owned-parent-not-current','pid':pid,'minimalBefore':first}
  c=self.n.coalition_id(pid)
  if not cid_valid(c,pid) or c['resourceId']!=self.cid:return None,None,{'kind':'owned-parent-coalition-changed','pid':pid}
  try:children,attempts=self.n.children(pid)
  except InventoryError as exc:return None,None,{'kind':'owned-child-inventory-read-failed','pid':pid,'errorType':type(exc).__name__}
  end=self.n.bsd(pid);c2=self.n.coalition_id(pid)
  if not self.n.bsd_ok(end,pid) or self.n.born(end)!=row['birth'] or not cid_valid(c2,pid) or c2['resourceId']!=self.cid:
   # Do not persist possible unrelated child identities after parent reuse.
   return None,None,{'kind':'owned-parent-raced-during-inventory','pid':pid,'untrustedCountOnly':len(children)}
  return children,attempts,None
 def runtime_roots(self):
  # Exact active own run records; no data values except pid/birth/kind/state.
  marks=','.join('?'for _ in self.taskIds);rows=self.db.execute('SELECT p.pid,p.process_started_at,p.kind FROM capability_run_processes p JOIN capability_runs c ON c.run_id=p.run_id WHERE c.task_id IN ('+marks+') AND c.state=\'active\' AND p.state=\'active\' AND p.pid IS NOT NULL',self.taskIds).fetchall();out=[]
  for pid,token,kind in rows:
   if not re.fullmatch(r'darwin-proc-v1:[1-9][0-9]*:[0-9]+',token or '') or kind not in ('cli','bridge'):raise RuntimeError('own active ledger birth/kind invalid')
   path=self.cli if kind=='cli'else self.bundle+'/Contents/MacOS/WillYou';out.append({'pid':pid,'birth':':'.join(token.split(':')[1:]),'pathExact':path,'role':'product','ledgerKind':kind})
  if len({a['pid']for a in out})!=len(out):raise RuntimeError('duplicate current own runtime pid')
  return out
 def capture_once(self,req):
  start=time.monotonic_ns();counter_before=self.counter();gaps=[];rows={};parents={};families={};roots=dict(self.required)
  # Current exact private run DB anchors are supplied by coordinator, typed birth
  # and product/instrument role. No wildcard process lookup.
  for a in self.runtime_roots()+req.get('instrumentExtra',[]):
   if a['pid'] in roots:continue
   roots[a['pid']]=a
  queue=deque((p,None,a,a['role'])for p,a in roots.items())
  while queue:
   pid,parent,expect,role=queue.popleft()
   if pid in rows:
    if parent is not None and rows[pid]['parent']!=parent:gaps.append({'kind':'child-parent-conflict','pid':pid,'parent':parent})
    continue
   row,gap=self.exact_row(pid,parent,expect)
   if gap:
    if gap['kind'] in ('candidate-all-esrch','candidate-identity-disappeared') and parent in rows:gap['parentBirth']=rows[parent]['birth']
    gaps.append(gap);continue
   if expect and expect.get('pathClass') and row['pathClass']!=expect['pathClass']:
    gaps.append({'kind':'anchor-pathclass-change','pid':pid});continue
   row['role']=role;rows[pid]=row
   children,attempts,childGap=self.owned_children(pid,row)
   if childGap:gaps.append(childGap);continue
   row['childrenBefore']=children;families[pid]={'beforeAttempts':attempts}
   for child in children:
    childExpect=roots.get(child);childRole=childExpect['role'] if childExpect else ('product' if role=='product' else 'unknown')
    queue.append((child,pid,childExpect,childRole))
  for pid,row in rows.items():
   children,attempts,childGap=self.owned_children(pid,row)
   if childGap:gaps.append(childGap);row['childrenAfter']=[]
   else:row['childrenAfter']=children;families.setdefault(pid,{})['afterAttempts']=attempts
   row.setdefault('childrenBefore',[])
   final=self.n.bsd(pid)
   if final['errno']==errno.ESRCH and pid not in roots and row['parent']in rows:
    second=self.n.bsd(pid)
    if second['errno']==errno.ESRCH:gaps.append({'kind':'candidate-identity-disappeared','pid':pid,'parent':row['parent'],'parentBirth':rows[row['parent']]['birth'],'firstOwnedInventory':True,'parentVerified':True,'oldBirth':row['birth'],'minimalBefore':final,'minimalAfter':second});row['stableBeforeAfter']=False;row['minimalFinal']=second;continue
   c=self.n.coalition_id(pid);valid=self.n.bsd_ok(final,pid) and self.n.born(final)==row['birth'] and cid_valid(c,pid) and c['resourceId']==self.cid
   if valid:
    pr,pe,ppath=self.n.path(pid);valid=pr>0 and pe==0 and ppath and self.path_class(ppath)==row['pathClass']
   if not valid:gaps.append({'kind':'final-owned-identity-changed','pid':pid});row['stableBeforeAfter']=False
   row['minimalFinal']=final
  # Exact known anchor set includes all independently bound dynamic runtime roots.
  required={}
  for pid,a in roots.items():
   if pid not in rows:required[pid]={'birth':a.get('birth'),'pathClass':a.get('pathClass')}
   else:required[pid]={'birth':rows[pid]['birth'] if not a.get('birth') else a['birth'],'pathClass':rows[pid]['pathClass'] if not a.get('pathClass') else a['pathClass']}
  after=self.counter();attempt={'startNs':start,'endNs':time.monotonic_ns(),'cid':self.cid,'outsideCid':self.outsideCid,'counterBefore':counter_before,'counterAfter':after,'nodes':list(rows.values()),'families':families,'gaps':gaps,'required':required}
  # Candidate closure is always explicit; formal proof must independently verify
  # current live-count semantics and whole owned coalition inheritance.
  # Pure contract does not declare formal approval on its own.
  candidate=exact_coherent(attempt,required,self.cid,live_count_contract_verified=True);attempt['candidateVerdict']={'state':candidate.state,'reason':candidate.reason};return attempt
 def capture(self,req):
  self.sequence+=1;started=time.monotonic_ns();attempts=[];final=None
  for _ in range(3):
   a=self.capture_once(req);attempts.append(a);v=a['candidateVerdict']['state']
   if v=='closed':
    prior=[r for r in attempts[:-1] if r['gaps']];valid=True;resolutions=[]
    for x in prior:
     q=retry_resolution(x,a,same_period=True);resolutions.append({'state':q.state,'reason':q.reason});valid=valid and q.state=='endpoint-resampled'
    if valid and time.monotonic_ns()-started<=2_000_000_000:final=a;break
   if v=='fatal' or time.monotonic_ns()-started>2_000_000_000:break
   time.sleep(.06)
  # If no coherent current endpoint, no fabricated RSS value returned.
  return {'kind':'scope-snapshot','requestId':req['requestId'],'capture':self.sequence,'attempts':attempts,'closedCandidate':bool(final),'actualProductRssBytes':sum(n['rss']for n in final['nodes']if n['role']=='product') if final else None,'actualInstrumentRssBytes':sum(n['rss']for n in final['nodes']if n['role']=='instrument') if final else None,'actualFinalNetLive':final['counterAfter']['tasks_started']-final['counterAfter']['tasks_exited'] if final else None,'scopeApproved':False,'currentLiveCountSemanticsMustBeVerifiedSeparately':True,'sameCadenceElapsedNs':time.monotonic_ns()-started}

if __name__=='__main__':
 if sys.argv[1:]!=['--serve']:raise SystemExit('private collector only --serve')
 c=Collector()
 for line in sys.stdin:
  req=None
  try:
   req=json.loads(line)
   if req['type']=='stop':print(json.dumps({'kind':'scope-stopped','requestId':req.get('requestId'),'scopeApproved':False}),flush=True);break
   result=c.init(req)if req['type']=='init'else c.capture(req);result['requestId']=req['requestId'];print(json.dumps(result,separators=(',',':')),flush=True)
  except Exception as e:print(json.dumps({'kind':'scope-error','requestId':req.get('requestId')if req else None,'error':type(e).__name__+': '+str(e),'scopeApproved':False}),flush=True)
