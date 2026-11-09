"""Audit all captured API attempts; never invoke a Native function."""
def audit(events):
 errors=[];attempts=0;reads=0;finals=[];inits=[x for x in events if x.get('kind')=='cpu-initialized']
 def bad(code,**details):errors.append(dict(code=code,**details))
 for init in inits:
  for row in init.get('initialReads',[]):
   reads+=1
   if row.get('rusage',{}).get('rc')!=0 or row.get('rusage',{}).get('errno')!=0:bad('initial-rusage-read-error',raw=row)
 for sample in [x for x in events if x.get('kind')=='cpu-upper-sample']:
  number=sample.get('capture');abi=sample.get('abi',{})
  if sample.get('final'):finals.append(number)
  for node in sample.get('nodes',[]):
   for phase in ['first','last']:
    row=node.get(phase,{})
    if not row:bad('missing-node-read',capture=number,pid=node.get('pid'),phase=phase);continue
    reads+=1;usage=row.get('rusage',{})
    if usage.get('rc')!=0 or usage.get('errno')!=0:bad('rusage-read-error',capture=number,pid=node.get('pid'),phase=phase,raw=usage)
    if node.get('anchor') and (row.get('bsd',{}).get('bytes')!=abi.get('bsdSize') or row.get('bsd',{}).get('errno')!=0 or row.get('pathRc',0)<=0 or row.get('pathErrno')!=0):bad('anchor-identity-read-error',capture=number,pid=node.get('pid'),phase=phase,raw=row)
  for family in sample.get('families',[]):
   for phase,field in [('before','attemptsBefore'),('after','attemptsAfter')]:
    trace=family.get(field,[])
    if not trace:bad('missing-family-attempts',capture=number,pid=family.get('pid'),phase=phase)
    for index,a in enumerate(trace):
     attempts+=1;ret=a.get('returnCount');cap=a.get('slots');pids=a.get('pids',[])
     if not isinstance(ret,int) or not isinstance(cap,int) or cap<=0:bad('invalid-list-return-shape',capture=number,pid=family.get('pid'),phase=phase,raw=a);continue
     if ret<0 or a.get('errno')!=0:bad('list-api-error-including-zero-return',capture=number,pid=family.get('pid'),phase=phase,raw=a)
     if len(pids)!=min(max(ret,0),cap) or any(not isinstance(p,int) or p<=0 for p in pids) or len(set(pids))!=len(pids):bad('list-count-buffer-mismatch',capture=number,pid=family.get('pid'),phase=phase,raw=a)
     if index==len(trace)-1 and ret>=cap:bad('final-list-still-truncated',capture=number,pid=family.get('pid'),phase=phase,raw=a)
     if index<len(trace)-1 and trace[index+1].get('slots',0)<=cap:bad('list-capacity-not-grown',capture=number,pid=family.get('pid'),phase=phase)
    if trace and set(family.get(phase,[]))!=set(trace[-1].get('pids',[])):bad('family-final-buffer-not-matched',capture=number,pid=family.get('pid'),phase=phase)
 for sample in [x for x in events if x.get('kind')=='cpu-upper-sample']:
  for race in sample.get('races',[]):
   row=race.get('raw')
   if isinstance(row,dict) and 'rusage' in row:
    reads+=1
    if row['rusage'].get('rc')!=0 or row['rusage'].get('errno')!=0:bad('race-carrier-rusage-error',raw=row)
  for gap in sample.get('gaps',[]):
   for attempt in gap.get('nativeAttempts',[]):
    attempts+=1
    if attempt.get('returnCount',-1)<0 or attempt.get('errno')!=0:bad('gap-carrier-list-api-error',raw=attempt)
 for err in [x for x in events if x.get('kind')=='cpu-collector-error']:bad('collector-error',raw=err)
 return {'capturedListAttempts':attempts,'capturedNodeRusageReads':reads,'initRawReadsCaptured':sum(len(x.get('initialReads',[])) for x in inits),'legacyInitRawCoverageBoundary':'005 init output has anchor identities/credits but no initialReads; cannot fabricate original init errno. All available before/after raw attempts are independently audited.','errors':errors,'allCapturedApisValid':not errors}
