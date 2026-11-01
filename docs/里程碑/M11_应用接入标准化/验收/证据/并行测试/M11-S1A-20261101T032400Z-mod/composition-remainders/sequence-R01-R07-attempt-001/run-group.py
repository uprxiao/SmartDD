from pathlib import Path
import json,hashlib,datetime,time,subprocess,os,sys,re
sequence=Path('/private/tmp/willyou-m11-s1a/evidence/composition-remainders/sequence-R01-R07-attempt-001')
plan=json.loads((sequence/'plan-selected.json').read_text());baseline=json.loads((sequence/'inputs-before.json').read_text());source=Path(plan['source']);group=next(g for g in plan['groups'] if g['id']==sys.argv[1]);out=Path(group['evidenceDirectory']);out.mkdir(parents=True,exist_ok=True)
assert not (out/'execution-start.json').exists(),'Refuse to overwrite an executed attempt'
def critical_check():
 changed=[]
 for name,item in baseline['criticalInputs'].items():
  p=source/name
  if not p.is_file() or p.stat().st_size!=item['bytes'] or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:changed.append(name)
 return changed
def cache_hash():
 p=source/'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json'
 return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
before_changes=critical_check();assert not before_changes,before_changes
before_cache=cache_hash();command=group['argv'];stdout_path=Path(group['logPath']);assert stdout_path.parent==out
(out/'inputs-before.json').write_text(json.dumps({'sequenceBaseline':str(sequence/'inputs-before.json'),'sequenceBaselineSha256':hashlib.sha256((sequence/'inputs-before.json').read_bytes()).hexdigest(),'sourceManifestSha256':baseline['sourceManifestSha256'],'criticalFileCount':len(baseline['criticalInputs']),'criticalChanges':before_changes,'sharedCacheHash':before_cache,'dependencyCheckBoundary':'Full dependency hashes checked at sequence start/end, not redundantly for every group; sequence read-only lease remains active.'},indent=2)+'\n')
started=datetime.datetime.now(datetime.timezone.utc).isoformat();monotonic=time.monotonic();red_seen=set();timed_out=False
with stdout_path.open('wb') as stdout,(out/'stderr.log').open('wb') as stderr:
 process=subprocess.Popen(command,cwd=source,stdout=stdout,stderr=stderr,start_new_session=True)
 initial={'groupId':group['id'],'command':command,'cwd':str(source),'supervisorPid':os.getpid(),'pid':process.pid,'processGroup':process.pid,'startedAt':started,'outerBudgetSeconds':180,'individualTestTimeout':'Unmodified'}
 (out/'execution-start.json').write_text(json.dumps(initial,indent=2)+'\n')
 while process.poll() is None:
  for line in stdout_path.read_text(errors='replace').splitlines():
   if re.match(r'^\s*[×✗]',line) and line not in red_seen:
    red_seen.add(line);print(json.dumps({'event':'failed-test','groupId':group['id'],'message':line.strip()},ensure_ascii=False),flush=True)
  if time.monotonic()-monotonic>=180:
   timed_out=True;os.killpg(process.pid,15)
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(process.pid,9);process.wait()
   break
  time.sleep(0.25)
 code=process.wait()
execution={**initial,'exitCode':code,'timedOut':timed_out,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':round(time.monotonic()-monotonic,3)}
(out/'execution-exit.json').write_text(json.dumps(execution,indent=2)+'\n');print(json.dumps({'event':'test-exit','groupId':group['id'],'exitCode':code,'timedOut':timed_out,'elapsedSeconds':execution['elapsedSeconds']}),flush=True)
report_path=Path(next(a.split('=',1)[1] for a in command if a.startswith('--outputFile.json=') or a.startswith('--outputFile=')))
report=json.loads(report_path.read_text()) if report_path.is_file() else {};expected=set(group['expectedNames']);items=[]
for suite in report.get('testResults',[]):
 for case in suite.get('assertionResults',[]):
  name=' > '.join(case.get('ancestorTitles',[])+[case['title']]);items.append({'fullName':name,'selected':name in expected,'status':case['status'],'durationMs':case.get('duration'),'failureMessages':case.get('failureMessages',[])})
selected=[i for i in items if i['selected']];outside=[i for i in items if not i['selected']];actual_names=[i['fullName'] for i in selected];missing=sorted(expected-set(actual_names));duplicates=sorted({n for n in actual_names if actual_names.count(n)>1});unexpected=[i['fullName'] for i in outside if i['status'] in ['passed','failed']]
counts={'expected':group['count'],'selectedReported':len(selected),'passed':sum(i['status']=='passed' for i in selected),'failed':sum(i['status']=='failed' for i in selected),'selectedNotExecuted':sum(i['status'] not in ['passed','failed'] for i in selected),'outsideSelection':len(outside),'outsideExecuted':len(unexpected)}
selection_ok=len(selected)==len(expected)==group['count'] and not missing and not duplicates and not unexpected
(out/'per-test-results.json').write_text(json.dumps({'groupId':group['id'],'file':group['file'],'counts':counts,'selectionVerified':selection_ok,'missingExpectedNames':missing,'duplicateExpectedNames':duplicates,'unexpectedExecutedNames':unexpected,'tests':items},ensure_ascii=False,indent=2)+'\n')
critical_changes=critical_check();after_cache=cache_hash();(out/'inputs-after.json').write_text(json.dumps({'criticalFileCount':len(baseline['criticalInputs']),'criticalChanges':critical_changes,'sharedCacheHash':after_cache,'sharedCacheUnchangedDuringGroup':after_cache==before_cache,'fullSequenceIntegrityReceipt':str(sequence/'inputs-after.json'),'sequenceFinalHashCheckPending':True},indent=2)+'\n')
try:os.killpg(process.pid,0);alive=True
except ProcessLookupError:alive=False
except PermissionError:alive='unknown-permission'
cleanup={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ownProcessGroup':process.pid,'ownProcessGroupStillExists':alive,'localGroupProcessesStopped':alive is False,'sequenceDependencyLease':'Remains active for authorized following groups until final sequence check','uiOrRealAgentStarted':False,'externalHooksOrListenersAddedByExecutor':False,'sharedOutOrDependencyBuildPerformed':False,'criticalInputUnchanged':not critical_changes,'sharedCacheUnchangedDuringGroup':after_cache==before_cache}
(out/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n')
passed=code==0 and not timed_out and selection_ok and counts['passed']==group['count'] and counts['failed']==0 and counts['selectedNotExecuted']==0 and not critical_changes
result={'schema':'willyou-test-group-result-v1','groupId':group['id'],'attempt':1,'status':'passed' if passed else 'failed-needs-classification','scope':'Exact assigned remaining software tests; no formal case closed','sourceManifestSha256':baseline['sourceManifestSha256'],'command':command,'cwd':str(source),'file':group['file'],'startedAt':started,'finishedAt':execution['finishedAt'],'elapsedSeconds':execution['elapsedSeconds'],'exitCode':code,'timedOut':timed_out,'outerBudgetSeconds':180,'individualTestTimeout':'Unmodified','selectionVerified':selection_ok,'counts':counts,'missingExpectedNames':missing,'duplicateExpectedNames':duplicates,'unexpectedExecutedNames':unexpected,'perTestResults':'per-test-results.json','failures':[i for i in selected if i['status']=='failed'],'formalCasePassesAdded':0,'criticalChanges':critical_changes,'sharedCacheUnchangedDuringGroup':after_cache==before_cache,'fullSequenceIntegrityReceipt':str(sequence/'inputs-after.json'),'inputBoundary':'Full source and dependencies checked at sequence edges; group checks critical inputs/cache. Final receipt must be consulted for complete sequence integrity.','cleanup':'cleanup.json','resourceState':'local-processes-stopped; sequence-read-lease-active' if alive is False else 'needs-process-check'}
(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');files=[]
for p in sorted(out.iterdir()):
 if p.is_file() and p.name!='manifest.json':files.append({'path':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'schema':'willyou-evidence-manifest-v1','groupId':group['id'],'attempt':1,'files':files},indent=2)+'\n')
print(json.dumps({'event':'group-sealed','groupId':group['id'],'status':result['status'],'counts':counts,'criticalChanges':critical_changes,'cacheUnchanged':after_cache==before_cache,'ownProcessGroupStillExists':alive,'manifestSha256':hashlib.sha256((out/'manifest.json').read_bytes()).hexdigest()},ensure_ascii=False),flush=True)
sys.exit(0 if passed and alive is False else 1)
