from pathlib import Path
import json,hashlib,os,datetime
root=Path('/private/tmp/willyou-m11-s0b-xyp5tfp9')
source=root/'source-attempt-004'
out=root/'evidence/composition-split1/attempt-001'
execution=json.loads((out/'execution-exit.json').read_text())
typecheck=json.loads((out/'typecheck-exit.json').read_text())
before=json.loads((out/'inputs-before.json').read_text())
original=json.loads((root/'source-manifest-attempt-004.json').read_text())
selection=json.loads((out/'selection.json').read_text())
expected=set(selection['expectedNames'])
report=json.loads((out/'vitest.json').read_text()) if (out/'vitest.json').is_file() else {}
items=[]
for suite in report.get('testResults',[]):
 for case in suite.get('assertionResults',[]):
  name=' > '.join([*case.get('ancestorTitles',[]),case.get('title','')])
  items.append({'fullName':name,'reportFullName':case.get('fullName'),'selected':name in expected,'status':case.get('status'),'durationMs':case.get('duration'),'failureMessages':case.get('failureMessages',[])})
selected=[item for item in items if item['selected']]
outside=[item for item in items if not item['selected']]
missing=sorted(expected-{item['fullName'] for item in selected})
unexpected=[item['fullName'] for item in outside if item['status'] in ['passed','failed']]
selected_names=[item['fullName'] for item in selected]
duplicates=sorted({name for name in selected_names if selected_names.count(name)>1})
counts={'expected':len(expected),'selectedReported':len(selected),'passed':sum(item['status']=='passed' for item in selected),'failed':sum(item['status']=='failed' for item in selected),'selectedNotExecuted':sum(item['status'] not in ['passed','failed'] for item in selected),'outsideSelection':len(outside),'outsideExecuted':len(unexpected)}
(out/'per-test-results.json').write_text(json.dumps({'selectionId':selection['id'],'metric':'Vitest test cases, not individual expect calls','counts':counts,'missingExpectedNames':missing,'duplicateExpectedNames':duplicates,'unexpectedExecutedNames':unexpected,'tests':items},ensure_ascii=False,indent=2)+'\n')
source_changes=[]
for name,want in original['files'].items():
 p=source/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=want:source_changes.append(name)
dependency_changes=[]
for name,want in before['dependencyAndOutputHashes'].items():
 p=source/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=want:dependency_changes.append(name)
cache=source/'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json'
cache_hash=hashlib.sha256(cache.read_bytes()).hexdigest() if cache.is_file() else None
(out/'inputs-after.json').write_text(json.dumps({'sourceManifestSha256':hashlib.sha256((root/'source-manifest-attempt-004.json').read_bytes()).hexdigest(),'sourceFileCount':len(original['files']),'sourceChanges':source_changes,'dependencyAndOutputFileCount':len(before['dependencyAndOutputHashes']),'dependencyAndOutputChanges':dependency_changes,'sharedCacheHash':cache_hash,'sharedCacheUnchanged':cache_hash==before['sharedCacheHash']},indent=2)+'\n')
groups=[]
for phase,data in [('typecheck',typecheck),('tests',execution)]:
 try:os.killpg(data['processGroup'],0);alive=True
 except ProcessLookupError:alive=False
 except PermissionError:alive='unknown-permission'
 groups.append({'phase':phase,'processGroup':data['processGroup'],'stillExists':alive})
clean=all(group['stillExists'] is False for group in groups)
cleanup={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ownProcessGroups':groups,'ownProcessGroupsStopped':clean,'uiOrRealAgentStarted':False,'externallyInstalledHooks':False,'fixtureTeardownBoundary':'Original test file retains its own afterEach/finally cleanup; no external UI hooks or business listeners were added by this executor.','sourceUnchanged':not source_changes,'observedNativeDependenciesAndOutUnchanged':not dependency_changes,'noCacheFlagUsed':True,'sharedCacheUnchanged':cache_hash==before['sharedCacheHash']}
(out/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n')
selection_ok=len(expected)==128 and len(selected)==128 and not missing and not duplicates and not unexpected
passed=typecheck['exitCode']==0 and execution['exitCode']==0 and not execution['timedOut'] and selection_ok and counts['passed']==128 and counts['failed']==0 and counts['selectedNotExecuted']==0 and not source_changes and not dependency_changes
status='passed' if passed else 'failed-needs-classification'
result={'schema':'willyou-test-group-result-v1','groupId':'M11-S0B-C1','attempt':1,'status':status,'scope':'Independent frozen TaskService composition tests with controlled processes/private SQLite and local Unix endpoints; no UI or external model.','baseCommit':original.get('baseCommit'),'sourceManifestSha256':before['sourceManifestSha256'],'selectionId':selection['id'],'partitionsSha256':selection['partitionsSha256'],'selectionVerified':selection_ok,'command':execution['command'],'cwd':execution['cwd'],'startedAt':execution['startedAt'],'finishedAt':execution['finishedAt'],'elapsedSeconds':execution['elapsedSeconds'],'exitCode':execution['exitCode'],'timedOut':execution['timedOut'],'outerBudgetSeconds':1800,'individualTestTimeout':'Unmodified','typecheck':{'exitCode':typecheck['exitCode'],'elapsedSeconds':typecheck['elapsedSeconds'],'startedAt':typecheck['startedAt'],'finishedAt':typecheck['finishedAt']},'counts':counts,'missingExpectedNames':missing,'duplicateExpectedNames':duplicates,'unexpectedExecutedNames':unexpected,'perTestResults':'per-test-results.json','failures':[item for item in selected if item['status']=='failed'],'formalCasePassesAdded':0,'sourceChanges':source_changes,'dependencyAndOutputChanges':dependency_changes,'sharedCacheUnchanged':cache_hash==before['sharedCacheHash'],'cleanup':'cleanup.json','resourceState':'released' if clean else 'needs-process-check'}
(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
files=[]
for p in sorted(out.iterdir()):
 if p.is_file() and p.name!='manifest.json':files.append({'path':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'schema':'willyou-evidence-manifest-v1','groupId':'M11-S0B-C1','attempt':1,'files':files},indent=2)+'\n')
print(json.dumps({'status':status,'counts':counts,'sourceChanges':source_changes,'dependencyAndOutputChanges':dependency_changes,'sharedCacheUnchanged':cache_hash==before['sharedCacheHash'],'resourceState':result['resourceState'],'manifestSha256':hashlib.sha256((out/'manifest.json').read_bytes()).hexdigest()}))
