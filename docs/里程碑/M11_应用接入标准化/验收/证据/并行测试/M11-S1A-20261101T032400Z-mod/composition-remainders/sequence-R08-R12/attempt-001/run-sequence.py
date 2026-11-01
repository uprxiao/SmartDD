import hashlib,json,os,signal,subprocess,time
from datetime import datetime,timezone
from pathlib import Path

BASE=Path('/private/tmp/willyou-m11-s1a')
SOURCE=BASE/'source-attempt-003'
MANIFEST=BASE/'source-manifest-attempt-003.json'
EXPECTED_SOURCE_SHA='74d2d7b7dc4e5ca376620f3b1624a14198cf26e0b857bc92a44dcfe1cc081f1a'
PLAN=BASE/'evidence/composition-remainder-preparation/attempt-001/task-test-partitions.json'
EXPECTED_PLAN_SHA='77210fa6f455d775fad8277604375d5f38d204008871722fff1774fff99ad647'
SEQUENCE=BASE/'evidence/composition-remainders/sequence-R08-R12/attempt-001'
IDENTIFIERS=['M11-S1A-R08','M11-S1A-R09','M11-S1A-R10','M11-S1A-R11','M11-S1A-R12']
def now():return datetime.now(timezone.utc).isoformat()
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def dump(p,data):Path(p).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def file_info(p):
 p=Path(p);return {'path':str(p),'size':p.stat().st_size,'mode':p.stat().st_mode&511,'sha256':sha(p)}
assert sha(PLAN)==EXPECTED_PLAN_SHA and sha(MANIFEST)==EXPECTED_SOURCE_SHA
source_manifest=json.loads(MANIFEST.read_text());plan=json.loads(PLAN.read_text());groups=[next(g for g in plan['groups'] if g['id']==n) for n in IDENTIFIERS]
assert sum(g['count'] for g in groups)==65
rows=source_manifest['files'];critical=[x for x in rows if x['path'].startswith(('src/','scripts/','native/','resources/','build/','applications/','drizzle/','out/')) or '/' not in x['path']]
old_deps=json.loads((BASE/'evidence/composition-remainder-preparation/attempt-001/inputs-before.json').read_text())['sharedDependencies']
def source_bad(items):return [x['path'] for x in items if not(SOURCE/x['path']).exists() or (SOURCE/x['path']).stat().st_size!=x['bytes'] or sha(SOURCE/x['path'])!=x['sha256']]
def dependencies():return [file_info(x['path']) for x in old_deps]
def caches():
 result=[]
 for rel in ['node_modules/.vite','node_modules/.vite-temp','node_modules/.cache/vitest']:
  p=SOURCE/rel
  result.append({'path':str(p),'exists':p.exists(),'immediateEntries':sorted(x.name for x in p.iterdir())[:100] if p.is_dir() else [],'observationOnly':'No cache deletion or mutation by this runner. Other authorized runner may have transient config artifacts. Vitest command uses --no-cache.'})
 return result
def pid_state(pid):
 try:os.kill(pid,0);return 'present'
 except ProcessLookupError:return 'absent'
 except PermissionError:return 'unverified-permission'
def group_state(pgid):
 try:os.killpg(pgid,0);return 'present'
 except ProcessLookupError:return 'absent'
 except PermissionError:return 'unverified-permission'
def tree(root):
 queue=[root];seen=set();items=[]
 while queue and len(seen)<256:
  pid=queue.pop(0)
  if pid in seen:continue
  seen.add(pid);ps=subprocess.run(['ps','-o','pid=,ppid=,pgid=,stat=,comm=','-p',str(pid)],text=True,capture_output=True)
  if ps.returncode==0:items.append({'pid':pid,'ps':ps.stdout.strip()})
  children=subprocess.run(['pgrep','-P',str(pid)],text=True,capture_output=True);queue.extend(int(x) for x in children.stdout.split() if x.isdigit())
 return items
def seal(directory,group):
 files=[{'path':p.name,'size':p.stat().st_size,'sha256':sha(p)} for p in sorted(directory.iterdir()) if p.is_file() and p.name!='manifest.json']
 dump(directory/'manifest.json',{'schema':'m11-test-delivery-v1','group':group,'attempt':'attempt-001','files':files,'formalM11NewPassed':0,'frozen':True})
 return sha(directory/'manifest.json')

started=now();deps_before=dependencies();before_bad=source_bad(rows);assert not before_bad
dump(SEQUENCE/'inputs-before.json',{'at':now(),'source':str(SOURCE),'sourceManifestSha256':EXPECTED_SOURCE_SHA,'sourceFileCount':len(rows),'sourceMismatches':before_bad,'keyFileCount':len(critical),'dependencies':deps_before,'cache':caches()})
probe_source=BASE/'evidence/composition/attempt-001/local-listen-preflight.cjs';probe=SEQUENCE/'local-listen-preflight.cjs';probe.write_bytes(probe_source.read_bytes())
p=subprocess.run(['node',str(probe)],cwd=SOURCE,text=True,capture_output=True,timeout=10);(SEQUENCE/'local-listen-preflight.log').write_text(p.stdout+p.stderr);probe_data=json.loads(p.stdout.strip());dump(SEQUENCE/'local-listen-preflight.json',{'at':now(),'exitCode':p.returncode,**probe_data});assert p.returncode==0 and probe_data['unix']['ok'] and probe_data['tcp']['ok']
print(json.dumps({'event':'sequence-started','at':now(),'sourceFileCount':len(rows),'criticalFileCount':len(critical),'groups':IDENTIFIERS,'expected':65,'preflight':probe_data}),flush=True)
deliveries=[]
for g in groups:
 directory=Path(g['evidenceDirectory']);directory.mkdir(parents=True,exist_ok=True);assert not list(directory.iterdir()),'Evidence directory must be empty before a new execution'
 key_before=source_bad(critical);dep_before=dependencies();assert not key_before and dep_before==deps_before
 dump(directory/'inputs-before.json',{'at':now(),'sourceManifestSha256':EXPECTED_SOURCE_SHA,'keyFileCount':len(critical),'keyMismatches':key_before,'dependencies':dep_before,'cache':caches(),'fullSourceBefore':str(SEQUENCE/'inputs-before.json')})
 argv=g['argv'];assert argv[:2]==['pnpm','test'] and '--configLoader=runner' not in argv and str(directory/'vitest.json') in argv[-1]
 test_start=now();clock=time.monotonic();expired=False;known=set();snapshots=[];next_snapshot=1
 with (directory/'test.log').open('w') as out:
  child=subprocess.Popen(argv,cwd=SOURCE,stdout=out,stderr=subprocess.STDOUT,start_new_session=True);pid=child.pid
  command={'argv':argv,'cwd':str(SOURCE),'pid':pid,'pgid':pid,'runnerPid':os.getpid(),'startedAt':test_start,'outerBudgetSeconds':180,'individualThresholdsUnchanged':True,'defaultConfigLoader':True,'permission':'require_escalated only for private local synthetic HTTP/SMTP/Unix fixtures','scope':'software regression; no real other Agent, no external business resources, no GUI'};dump(directory/'command.json',command)
  print(json.dumps({'event':'group-started','id':g['id'],'expected':g['count'],'pid':pid,'at':test_start}),flush=True)
  while True:
   elapsed=time.monotonic()-clock
   if elapsed>=180:
    expired=True;items=tree(pid);known.update(x['pid'] for x in items);snapshots.append({'at':now(),'reason':'outer-budget','processes':items});os.killpg(pid,signal.SIGTERM)
    try:code=child.wait(timeout=8)
    except subprocess.TimeoutExpired:os.killpg(pid,signal.SIGKILL);code=child.wait()
    break
   try:code=child.wait(timeout=min(2,180-elapsed));break
   except subprocess.TimeoutExpired:pass
   if elapsed>=next_snapshot:
    items=tree(pid);known.update(x['pid'] for x in items);snapshots.append({'at':now(),'reason':'owned-process-observation','processes':items});next_snapshot=elapsed+15
 seconds=round(time.monotonic()-clock,3);known.add(pid)
 state=group_state(pid);cleanup_action=None
 if state=='present':
  cleanup_action='SIGTERM exact owned process group after runner root exit';os.killpg(pid,signal.SIGTERM);deadline=time.monotonic()+5
  while group_state(pid)=='present' and time.monotonic()<deadline:time.sleep(.1)
  if group_state(pid)=='present':cleanup_action+='; then SIGKILL same owned group';os.killpg(pid,signal.SIGKILL)
 state=group_state(pid);process_checks=[{'pid':x,'state':pid_state(x)} for x in sorted(known)];released=state=='absent' and all(x['state']=='absent' for x in process_checks)
 cleanup={'at':now(),'rootPid':pid,'groupState':state,'knownProcesses':process_checks,'cleanupAction':cleanup_action,'resourcesReleased':released,'observationHooks':[],'localListeners':'process-owned synthetic fixtures; all captured process owners absent' if released else 'requires investigation','defaultConfigLoader':True}
 dump(directory/'cleanup.json',cleanup);dump(directory/'process-observations.json',{'scope':'only descendants of exact test root','rootPid':pid,'snapshots':snapshots})
 expected=set(g['expectedNames']);report_path=directory/'vitest.json';executed=[];filtered=[];suites=[];report={}
 if report_path.exists():
  report=json.loads(report_path.read_text())
  for suite in report.get('testResults',[]):
   suites.append({'file':suite.get('name'),'status':suite.get('status'),'message':suite.get('message')})
   for a in suite.get('assertionResults',[]):
    name=' > '.join([*a.get('ancestorTitles',[]),a.get('title','')]);item={'name':name,'status':a.get('status'),'duration':a.get('duration'),'failureMessages':a.get('failureMessages',[])}
    (executed if a.get('status') in ('passed','failed') else filtered).append(item)
 actual={x['name'] for x in executed};missing=sorted(expected-actual);unexpected=sorted(actual-expected);failed=[x for x in executed if x['status']=='failed'];key_after=source_bad(critical);dep_after=dependencies();deps_equal=dep_after==dep_before==deps_before
 dump(directory/'inputs-after.json',{'at':now(),'keyFileCount':len(critical),'keyMismatches':key_after,'dependencies':dep_after,'cache':caches(),'dependenciesUnchanged':deps_equal})
 status='passed' if code==0 and not expired and report.get('success') and not missing and not unexpected and len(executed)==len(expected) and not failed and not key_after and deps_equal and released else 'incomplete-outer-budget' if expired else 'failed'
 result={'schema':'m11-s1a-exact-remainder-result-v1','group':g['id'],'source':str(SOURCE),'sourceManifestSha256':EXPECTED_SOURCE_SHA,'planSha256':EXPECTED_PLAN_SHA,'startedAt':test_start,'finishedAt':now(),'seconds':seconds,'exitCode':code,'outerBudgetExpired':expired,'outerBudgetSeconds':180,'status':status,'expectedCount':g['count'],'executedCount':len(executed),'passedCount':sum(x['status']=='passed' for x in executed),'failedCount':len(failed),'filteredCount':len(filtered),'missingNames':missing,'unexpectedNames':unexpected,'duplicateExecutedNames':len(executed)-len(actual),'executed':executed,'filteredNotCountedAsPassed':filtered,'suiteResults':suites,'reportSuccess':report.get('success'),'reportNumTotalTests':report.get('numTotalTests'),'reportNumPendingTests':report.get('numPendingTests'),'sourceKeyMismatches':key_after,'dependenciesUnchanged':deps_equal,'resourcesReleased':released,'individualThresholdsUnchanged':True,'fullSourceVerification':'Beginning and end of this same-source sequence, with key inputs checked before/after each group.','formalM11NewPassed':0}
 dump(directory/'result.json',result);manifest_sha=seal(directory,g['id']);delivery={'id':g['id'],'directory':str(directory),'manifestSha256':manifest_sha,'status':status,'seconds':seconds,'exitCode':code,'expected':g['count'],'executed':len(executed),'passed':result['passedCount'],'failed':len(failed),'filtered':len(filtered),'missing':missing,'unexpected':unexpected,'resourcesReleased':released};deliveries.append(delivery);dump(SEQUENCE/'progress.json',{'at':now(),'deliveries':deliveries});print(json.dumps({'event':'group-finished',**delivery}),flush=True)
 if not released or key_after or not deps_equal:break

after_bad=source_bad(rows);deps_after=dependencies();dump(SEQUENCE/'inputs-after.json',{'at':now(),'sourceManifestSha256':EXPECTED_SOURCE_SHA,'sourceFileCount':len(rows),'sourceMismatches':after_bad,'dependencies':deps_after,'dependenciesUnchanged':deps_after==deps_before,'cache':caches()})
all_done=len(deliveries)==5 and all(x['status']=='passed' for x in deliveries);result={'schema':'m11-s1a-r08-r12-sequence-result-v1','startedAt':started,'finishedAt':now(),'status':'passed' if all_done and not after_bad and deps_after==deps_before else 'needs-follow-up','expectedTotal':65,'executedTotal':sum(x['executed'] for x in deliveries),'passedTotal':sum(x['passed'] for x in deliveries),'failedTotal':sum(x['failed'] for x in deliveries),'deliveredGroups':len(deliveries),'deliveries':deliveries,'sourceFileCount':len(rows),'sourceMismatches':after_bad,'dependenciesUnchanged':deps_after==deps_before,'formalM11NewPassed':0};dump(SEQUENCE/'result.json',result);dump(SEQUENCE/'cleanup.json',{'at':now(),'groups':[{'id':x['id'],'resourcesReleased':x['resourcesReleased']} for x in deliveries],'resourcesReleased':all(x['resourcesReleased'] for x in deliveries),'preflightRootRemoved':probe_data['createdRootRemoved'],'observationHooks':[]});manifest_sha=seal(SEQUENCE,'M11-S1A-R08-R12-SEQUENCE');print(json.dumps({'event':'sequence-finished','status':result['status'],'passed':result['passedTotal'],'failed':result['failedTotal'],'executed':result['executedTotal'],'sourceMismatches':after_bad,'dependenciesUnchanged':result['dependenciesUnchanged'],'manifestSha256':manifest_sha}),flush=True)
