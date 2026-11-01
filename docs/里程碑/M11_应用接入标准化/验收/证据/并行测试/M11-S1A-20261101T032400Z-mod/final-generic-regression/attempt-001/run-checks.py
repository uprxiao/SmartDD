import hashlib,json,os,signal,subprocess,time
from datetime import datetime,timezone
from pathlib import Path

BASE=Path('/private/tmp/willyou-m11-s1a');SOURCE=BASE/'source-attempt-004';E=BASE/'evidence/final-generic-regression/attempt-001';M=BASE/'source-manifest-attempt-004.json'
EXPECTED='f6ed0d791607b7dc1cff5a95c72df30ae3982fd38aa2bef749c950a334de9ac5'
FILES=['src/main/core/applications/__tests__/selection-service.test.ts','src/main/core/applications/__tests__/session-diagnostics.test.ts','src/renderer/features/applications/session-applications.test.tsx','src/renderer/features/applications/activity.test.tsx']
def stamp():return datetime.now(timezone.utc).isoformat()
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def dump(p,d):Path(p).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
assert sha(M)==EXPECTED
manifest=json.loads(M.read_text());rows=manifest['files'];assert len(rows)==5017
critical=[x for x in rows if x['path'].startswith(('src/','scripts/','native/','resources/','build/','applications/','drizzle/','out/')) or '/' not in x['path']]
def bad(items):return [x['path'] for x in items if not(SOURCE/x['path']).exists() or (SOURCE/x['path']).stat().st_size!=x['bytes'] or sha(SOURCE/x['path'])!=x['sha256']]
old_deps=json.loads((BASE/'evidence/composition-remainder-preparation/attempt-001/inputs-before.json').read_text())['sharedDependencies'];dep_paths=[Path(x['path']) for x in old_deps]
dep_paths.extend(SOURCE/x for x in ['out/native/willyou-process-identity','out/native/willyou-files','out/native/willyou-foxmail','out/applications/mcp-bridge.cjs','out/capability-bundles/index.json'] if (SOURCE/x).exists())
def dependencies():return [{'path':str(p),'size':p.stat().st_size,'mode':p.stat().st_mode&511,'sha256':sha(p)} for p in dep_paths]
def caches():return [{'path':rel,'exists':(SOURCE/rel).exists(),'immediateEntries':sorted(x.name for x in (SOURCE/rel).iterdir())[:100] if (SOURCE/rel).is_dir() else []} for rel in ['node_modules/.vite','node_modules/.vite-temp','node_modules/.cache/vitest']]
def state(pid,group=False):
 try:(os.killpg if group else os.kill)(pid,0);return 'present'
 except ProcessLookupError:return 'absent'
 except PermissionError:return 'unverified-permission'
def descendants(pid):
 queue=[pid];seen=set();result=[]
 while queue and len(seen)<256:
  current=queue.pop(0)
  if current in seen:continue
  seen.add(current);p=subprocess.run(['ps','-o','pid=,ppid=,pgid=,stat=,comm=','-p',str(current)],capture_output=True,text=True)
  if p.returncode==0:result.append({'pid':current,'ps':p.stdout.strip()})
  children=subprocess.run(['pgrep','-P',str(current)],capture_output=True,text=True);queue.extend(int(x) for x in children.stdout.split() if x.isdigit())
 return result
def seal(p,ident):
 entries=[{'path':x.name,'size':x.stat().st_size,'sha256':sha(x)} for x in sorted(p.iterdir()) if x.is_file() and x.name!='manifest.json']
 dump(p/'manifest.json',{'schema':'m11-test-delivery-v1','group':ident,'attempt':'attempt-001','files':entries,'formalM11NewPassed':0,'frozen':True});return sha(p/'manifest.json')
started=stamp();baseline=dependencies();assert not bad(rows);catalog=SOURCE/'src/shared/application-module-catalog.json';catalog_before=sha(catalog)
old_manifest=json.loads((BASE/'source-manifest-attempt-003.json').read_text());old_map={x['path']:x for x in old_manifest['files']};production_differences=[x['path'] for x in rows if x['path'] in old_map and (x['sha256']!=old_map[x['path']]['sha256'] or x['bytes']!=old_map[x['path']]['bytes'])]
dump(E/'inputs-before.json',{'at':stamp(),'source':str(SOURCE),'sourceManifestSha256':EXPECTED,'fileCount':len(rows),'sourceMismatches':[],'keyFileCount':len(critical),'productionAndTestDifferencesFrom003':production_differences,'metadataCatalogSha256':catalog_before,'dependencies':baseline,'cache':caches()})
probe=E/'local-listen-preflight.cjs';probe.write_bytes((BASE/'evidence/composition/attempt-001/local-listen-preflight.cjs').read_bytes());preflight=subprocess.run(['node',str(probe)],cwd=SOURCE,text=True,capture_output=True,timeout=10);(E/'local-listen-preflight.log').write_text(preflight.stdout+preflight.stderr);probe_data=json.loads(preflight.stdout.strip());dump(E/'local-listen-preflight.json',{'at':stamp(),'exitCode':preflight.returncode,**probe_data});assert preflight.returncode==0
print(json.dumps({'event':'batch-started','sourceFiles':len(rows),'criticalFiles':len(critical),'sourceMismatches':[],'productionAndTestDifferenceCount':len(production_differences),'at':stamp()}),flush=True)
results=[]
def run(ident,argv,kind,expected_names=None):
 p=E/ident;p.mkdir(exist_ok=False);key_before=bad(critical);deps_before=dependencies();assert not key_before and deps_before==baseline
 dump(p/'inputs-before.json',{'at':stamp(),'keyMismatches':key_before,'dependencies':deps_before,'cache':caches()})
 snapshots=[];known=set();clock=time.monotonic();next_snapshot=1;expired=False;at=stamp()
 with (p/'test.log').open('w') as out:
  child=subprocess.Popen(argv,cwd=SOURCE,stdout=out,stderr=subprocess.STDOUT,start_new_session=True);pid=child.pid;dump(p/'command.json',{'argv':argv,'cwd':str(SOURCE),'pid':pid,'pgid':pid,'startedAt':at,'outerSeconds':180,'individualThresholdsUnchanged':True,'kind':kind,'permission':'require_escalated for owned local test fixtures only'});print(json.dumps({'event':'command-started','id':ident,'kind':kind,'pid':pid,'at':at}),flush=True)
  while True:
   elapsed=time.monotonic()-clock
   if elapsed>=180:
    expired=True;items=descendants(pid);known.update(x['pid'] for x in items);snapshots.append({'at':stamp(),'reason':'outer-budget','processes':items});os.killpg(pid,signal.SIGTERM)
    try:code=child.wait(timeout=8)
    except subprocess.TimeoutExpired:os.killpg(pid,signal.SIGKILL);code=child.wait()
    break
   try:code=child.wait(timeout=min(2,180-elapsed));break
   except subprocess.TimeoutExpired:pass
   if elapsed>=next_snapshot:
    items=descendants(pid);known.update(x['pid'] for x in items);snapshots.append({'at':stamp(),'reason':'owned-process-observation','processes':items});next_snapshot=elapsed+15
 seconds=round(time.monotonic()-clock,3);known.add(pid);cleanup_action=None
 if state(pid,True)=='present':
  cleanup_action='SIGTERM exact owned process group after root exit';os.killpg(pid,signal.SIGTERM);deadline=time.monotonic()+5
  while state(pid,True)=='present' and time.monotonic()<deadline:time.sleep(.1)
  if state(pid,True)=='present':cleanup_action+=' then SIGKILL';os.killpg(pid,signal.SIGKILL)
 group_state=state(pid,True);checks=[{'pid':x,'state':state(x)} for x in sorted(known)];released=group_state=='absent' and all(x['state']=='absent' for x in checks);dump(p/'cleanup.json',{'at':stamp(),'rootPid':pid,'groupState':group_state,'knownProcesses':checks,'cleanupAction':cleanup_action,'resourcesReleased':released,'observationHooks':[]});dump(p/'process-observations.json',{'rootPid':pid,'scope':'exact own root descendants only','snapshots':snapshots})
 key_after=bad(critical);deps_after=dependencies();deps_equal=deps_after==deps_before==baseline;dump(p/'inputs-after.json',{'at':stamp(),'keyMismatches':key_after,'dependencies':deps_after,'dependenciesUnchanged':deps_equal,'cache':caches()})
 r={'schema':'m11-s1a-final-generic-command-v1','id':ident,'kind':kind,'sourceManifestSha256':EXPECTED,'startedAt':at,'finishedAt':stamp(),'seconds':seconds,'exitCode':code,'outerBudgetExpired':expired,'sourceKeyMismatches':key_after,'dependenciesUnchanged':deps_equal,'resourcesReleased':released,'formalM11NewPassed':0}
 accepted=code==0 and not expired and not key_after and deps_equal and released
 if kind=='test':
  report=json.loads((p/'vitest.json').read_text()) if (p/'vitest.json').exists() else {};executed=[];filtered=[]
  for suite in report.get('testResults',[]):
   for a in suite.get('assertionResults',[]):
    item={'name':' > '.join([*a.get('ancestorTitles',[]),a.get('title','')]),'status':a.get('status'),'duration':a.get('duration'),'failureMessages':a.get('failureMessages',[])};(executed if a.get('status') in ('passed','failed') else filtered).append(item)
  names={x['name'] for x in executed};expected=set(expected_names);missing=sorted(expected-names);unexpected=sorted(names-expected);failed=[x for x in executed if x['status']=='failed'];r.update({'expectedCount':len(expected),'executedCount':len(executed),'passedCount':sum(x['status']=='passed' for x in executed),'failedCount':len(failed),'filteredCount':len(filtered),'missingNames':missing,'unexpectedNames':unexpected,'executed':executed,'filteredNotCountedAsPassed':filtered,'reportSuccess':report.get('success'),'suiteResults':[{'file':s.get('name'),'status':s.get('status'),'message':s.get('message')} for s in report.get('testResults',[])]});accepted=accepted and report.get('success') and not failed and not missing and not unexpected and len(executed)==len(expected) and len(names)==len(executed)
 if kind=='metadata-check':
  metadata=None
  for line in (p/'test.log').read_text().splitlines():
   try:metadata=json.loads(line)
   except json.JSONDecodeError:pass
  r.update({'metadata':metadata,'catalogUnchanged':sha(catalog)==catalog_before,'remainingScratchDirectories':[x.name for x in (SOURCE/'out').glob('.module-metadata-*')]});accepted=accepted and r['catalogUnchanged'] and metadata is not None and metadata.get('written') is False and metadata.get('changed') is False and not r['remainingScratchDirectories']
 r['status']='passed' if accepted else 'incomplete-outer-budget' if expired else 'failed';dump(p/'result.json',r);delivery={'id':ident,'kind':kind,'status':r['status'],'seconds':seconds,'exitCode':code,'resourcesReleased':released,'manifestSha256':seal(p,'M11-S1A-FINAL-'+ident.upper())}
 for key in ['expectedCount','executedCount','passedCount','failedCount','filteredCount','missingNames','unexpectedNames']:
  if key in r:delivery[key]=r[key]
 results.append(delivery);dump(E/'progress.json',{'at':stamp(),'commands':results});print(json.dumps({'event':'command-finished',**delivery}),flush=True)
 if not released or key_after or not deps_equal:raise RuntimeError('Stop after resource or input integrity failure')
 return r

run('metadata-check',['node','scripts/applications/generate-module-metadata.mjs'],'metadata-check')
run('typecheck',['pnpm','typecheck'],'typecheck')
electron=subprocess.check_output(['node','-p','require("electron")'],cwd=SOURCE,text=True).strip();collection_argv=[electron,str(SOURCE/'node_modules/vitest/vitest.mjs'),'list',*FILES,'--json='+str(E/'collection.json'),'--maxWorkers=1','--no-file-parallelism','--no-cache','--configLoader=runner','--includeTaskLocation'];env=os.environ.copy();env['ELECTRON_RUN_AS_NODE']='1'
with (E/'collection.log').open('w') as out:collection_process=subprocess.Popen(collection_argv,cwd=SOURCE,env=env,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
try:collection_code=collection_process.wait(timeout=60)
except subprocess.TimeoutExpired:
 os.killpg(collection_process.pid,signal.SIGTERM)
 try:collection_code=collection_process.wait(timeout=5)
 except subprocess.TimeoutExpired:os.killpg(collection_process.pid,signal.SIGKILL);collection_code=collection_process.wait()
dump(E/'collection-command.json',{'argv':collection_argv,'cwd':str(SOURCE),'pid':collection_process.pid,'pgid':collection_process.pid,'exitCode':collection_code,'groupState':state(collection_process.pid,True),'collectionOnly':True,'configLoaderDifference':'runner used only to collect exact names without config scratch in shared dependencies; tests retain original default loader'})
assert collection_code==0 and state(collection_process.pid,True)=='absent'
collected=json.loads((E/'collection.json').read_text());counts={file:len([x for x in collected if x['file'].endswith('/'+file)]) for file in FILES};assert counts[FILES[0]]==29
print(json.dumps({'event':'collection-ready','counts':counts,'callbacksExecuted':False}),flush=True)
for file in FILES:
 ident=Path(file).name.replace('.test.tsx','').replace('.test.ts','');expected=[x['name'] for x in collected if x['file'].endswith('/'+file)];assert len(expected)==len(set(expected)) and expected
 run(ident,['pnpm','test',file,'--maxWorkers=1','--no-file-parallelism','--no-cache','--reporter=verbose','--reporter=json','--outputFile.json='+str(E/ident/'vitest.json')],'test',expected)
after_bad=bad(rows);deps_after=dependencies();dump(E/'inputs-after.json',{'at':stamp(),'sourceManifestSha256':EXPECTED,'fileCount':len(rows),'sourceMismatches':after_bad,'dependencies':deps_after,'dependenciesUnchanged':deps_after==baseline,'metadataCatalogSha256':sha(catalog),'catalogUnchanged':sha(catalog)==catalog_before,'remainingMetadataScratchDirectories':[x.name for x in (SOURCE/'out').glob('.module-metadata-*')],'cache':caches()})
result={'schema':'m11-s1a-final-generic-regression-v1','startedAt':started,'finishedAt':stamp(),'status':'passed' if len(results)==6 and all(x['status']=='passed' for x in results) and not after_bad and deps_after==baseline else 'needs-follow-up','source':str(SOURCE),'sourceManifestSha256':EXPECTED,'sourceFileCount':len(rows),'sourceMismatches':after_bad,'dependenciesUnchanged':deps_after==baseline,'commands':results,'testsExecuted':sum(x.get('executedCount',0) for x in results),'testsPassed':sum(x.get('passedCount',0) for x in results),'testsFailed':sum(x.get('failedCount',0) for x in results),'formalM11NewPassed':0};dump(E/'result.json',result);dump(E/'cleanup.json',{'at':stamp(),'commands':[{'id':x['id'],'resourcesReleased':x['resourcesReleased']} for x in results],'resourcesReleased':all(x['resourcesReleased'] for x in results),'collectionGroupState':state(collection_process.pid,True),'preflightRootRemoved':probe_data['createdRootRemoved'],'observationHooks':[]});manifest_sha=seal(E,'M11-S1A-FINAL-GENERIC-REGRESSION');print(json.dumps({'event':'batch-finished','status':result['status'],'testsExecuted':result['testsExecuted'],'testsPassed':result['testsPassed'],'testsFailed':result['testsFailed'],'sourceMismatches':after_bad,'dependenciesUnchanged':result['dependenciesUnchanged'],'manifestSha256':manifest_sha}),flush=True)
