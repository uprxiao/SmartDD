from pathlib import Path
import json,hashlib,datetime,re,collections
root=Path('/private/tmp/willyou-m11-c23-2637');source=root/'software-source-attempt-002';out=root/'software-evidence/attempt-005-final-full'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(name,value):(out/name).write_text(json.dumps(value,ensure_ascii=True,indent=2)+'\n',encoding='utf-8')
assert not (out/'manifest.json').exists(),'Do not overwrite sealed full-suite evidence'
execution=json.loads((out/'execution.json').read_text());cleanup=json.loads((out/'cleanup.json').read_text());assert cleanup['allOwnProcessesStopped']
report=json.loads((out/'vitest.json').read_text());fixture_list_path=root/'supplemented-fixture-test-files.json';fixture_files=json.loads(fixture_list_path.read_text());fixture_set=set(fixture_files)
tests=[];files=[];failures=[];pending=[];by_path={}
for suite in report.get('testResults',[]):
 p=Path(suite['name']).resolve();relative=str(p.relative_to(source)) if p.is_relative_to(source) else str(p)
 items=[]
 for test in suite.get('assertionResults',[]):
  name=test.get('fullName') or ' > '.join(test.get('ancestorTitles',[])+[test.get('title','')]);messages=test.get('failureMessages',[])
  item={'file':relative,'fullName':name,'status':test['status'],'durationMs':test.get('duration'),'failureMessages':messages}
  if item['status']=='failed':
   text='\n'.join(messages);item['classification']='environment-missing-frozen-docs-fixture' if 'ENOENT' in text and 'docs/' in text else 'needs-coordinator-diagnosis';failures.append(item)
  if item['status'] not in ('passed','failed'):pending.append(item)
  items.append(item);tests.append(item)
 counts=dict(collections.Counter(t['status'] for t in items));message=suite.get('message') or '';text=message+'\n'+'\n'.join(m for t in items for m in t['failureMessages'])
 failed=suite.get('status')=='failed' or any(t['status']=='failed' for t in items)
 entry={'file':relative,'reportedStatus':suite.get('status'),'reportedMessage':message,'observedTests':len(items),'statuses':counts,'docsFixtureDependent':relative in fixture_set,'failed':failed,'classification':('environment-missing-frozen-docs-fixture' if 'ENOENT' in text and 'docs/' in text else 'needs-coordinator-diagnosis') if failed else None}
 files.append(entry);by_path[relative]=entry
statuses=dict(collections.Counter(t['status'] for t in tests));failed_files=[f for f in files if f['failed']]
mapping=[]
for relative in fixture_files:
 entry=by_path.get(relative);path=source/relative;lines=path.read_text(errors='replace').splitlines() if path.is_file() else []
 gates=[{'line':i+1,'text':line.strip()} for i,line in enumerate(lines) if re.search(r'skipIf|runIf|existsSync|accessSync|describe\.skip|it\.skip|test\.skip|process\.env|process\.platform',line)]
 has_exists=any('existsSync' in g['text'] or 'accessSync' in g['text'] for g in gates);has_env=any('process.env' in g['text'] or 'process.platform' in g['text'] for g in gates)
 assessment='No pending assertions in original result'
 if entry and any(status not in ('passed','failed') and count for status,count in entry['statuses'].items()):
  assessment='Combined input-existence and platform/env gates; cannot attribute all skips solely to missing fixtures' if has_exists and has_env else 'Potential missing-input conditional gate; supplement under unchanged flags to determine actual execution' if has_exists else 'Platform/env/native gate or helper-derived condition; retain original flags, do not force execution merely for a pass count'
 mapping.append({'file':relative,'collectedInOriginalFull':entry is not None,'originalFileResult':entry,'originalGateLines':gates,'pendingCauseAssessment':assessment,'futureEvidenceBoundary':'A supplemented run is required to distinguish input-dependent skips empirically; no skipped assertion is counted passed here.'})
write('archive-error-001.json',{'phase':'post-test raw-summary serialization','error':'UnicodeEncodeError: UTF-8 cannot encode unpaired surrogate in an intentional test title','testRerun':False,'originalVitestJsonModified':False,'resolution':'Derived JSON evidence uses ensure_ascii=True; original final vitest.json remains byte-for-byte unchanged.','heavyLeaseAlreadyReleased':True})
write('per-test-results.json',{'observedTests':len(tests),'statuses':statuses,'tests':tests})
write('failures.json',{'failedTests':len(failures),'failedFiles':failed_files,'tests':failures,'originalJson':'vitest.json'})
write('pending-tests.json',{'count':len(pending),'tests':pending,'boundary':'Pending/skipped/todo are not passed. Source gate statements below distinguish inputs from platform/env conditions without changing them.'})
write('fixture-dependency-mapping.json',{'fixtureTestFilesReceipt':str(fixture_list_path),'receiptSha256':sha(fixture_list_path),'fileCount':len(fixture_files),'files':mapping})
already_assigned={'src/renderer/features/files/office/preview.test.tsx','src/main/core/files/office/range-input-transaction-acceptance.test.ts'}
write('proposed-fixture-recheck-files.json',{'source':'/private/tmp/willyou-m11-c23-2637/software-source-fixtures-attempt-003','executeOnlyAfterCoordinatorLease':True,'keepOriginalFlagsAndThresholds':True,'separateLightweightChecksAlreadyAssigned':sorted(already_assigned),'remainingFiles':[f for f in fixture_files if f not in already_assigned],'boundary':'Proposal only, no follow-up test command executed by this finalizer.'})
nonfixture=[f for f in failed_files if f['classification']!='environment-missing-frozen-docs-fixture'];assert len(tests)>0
result={'schema':'willyou-v010-final-full-result-v1','status':'completed-with-environment-fixture-failures' if failed_files and not nonfixture else 'completed-with-failures' if failed_files else 'passed' if execution['exitCode']==0 else 'completed-needs-diagnosis','execution':execution,'finalJson':'vitest.json','finalJsonSha256':sha(out/'vitest.json'),'actualFileResults':len(files),'fileStatusCounts':dict(collections.Counter(f['reportedStatus'] for f in files)),'reported':{k:report.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTodoTests','numTotalTestSuites','numPassedTestSuites','numFailedTestSuites','numPendingTestSuites']},'observedTests':len(tests),'observedStatuses':statuses,'observedCountMatchesFinalJson':len(tests)==report.get('numTotalTests'),'failedAssertionCount':len(failures),'failedFileCount':len(failed_files),'nonMissingFixtureFailedFiles':nonfixture,'pendingAssertionCount':len(pending),'filteredAssertions':0,'failures':'failures.json','pendingTests':'pending-tests.json','fixtureDependencyMapping':'fixture-dependency-mapping.json','proposedFixtureRecheck':'proposed-fixture-recheck-files.json','source':str(source),'sourceInputReceipt':'inputs-before.json','correctedSourceDrift':cleanup['correctedSourceDrift'],'candidateAssociation':'candidate-association.json','candidateCheckoutLaunch':False,'heavyLeaseReleased':True,'allOwnProcessesStopped':True,'additionalTestCommandsExecuted':False,'formalUniqueCasesAdded':0,'boundary':'One full suite ran from the original corrected frozen source, not a later candidate checkout. All environment reds and original conditional skips remain. Candidate CI success and supplemental fixture passes are separate coordinator evidence, not replacements inside this raw run.','finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
write('raw-summary.json',{'execution':execution,'counts':result['observedStatuses'],'tests':tests,'fileResults':files,'failures':failures,'correctedSourceDrift':cleanup['correctedSourceDrift'],'allOwnProcessesStopped':True,'formalUniqueCasesAdded':0})
write('result.json',result)
rows=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json'];write('manifest.json',{'schema':'willyou-evidence-manifest-v1','group':'V010-FINAL-FULL','attempt':5,'files':rows})
print(json.dumps({'status':result['status'],'actualFiles':len(files),'reported':result['reported'],'observedTests':len(tests),'statuses':statuses,'failedFiles':len(failed_files),'nonFixtureFailedFiles':nonfixture,'fixtureFiles':len(mapping),'remainingFixtureFileProposal':len(fixture_files)-len(already_assigned),'manifestSha256':sha(out/'manifest.json')},ensure_ascii=True))
