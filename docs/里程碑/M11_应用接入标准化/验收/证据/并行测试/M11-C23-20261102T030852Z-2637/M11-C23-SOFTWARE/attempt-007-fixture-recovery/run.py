from pathlib import Path
import json,hashlib,datetime,subprocess,time,os
root=Path('/private/tmp/willyou-m11-c23-2637');source=root/'software-source-fixtures-attempt-003';out=root/'software-evidence/attempt-007-fixture-recovery'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=True,indent=2)+'\n')
assert not (out/'execution.json').exists(),'Never repeat a started fixture recovery run'
files=json.loads((root/'remaining-fixture-tests.json').read_text());plan=json.loads((root/'remaining-fixture-test-plan.json').read_text());assert len(files)==len(set(files))==60 and files==plan['remainingFiles']
proof=json.loads((root/'software-evidence/attempt-003-preparation/corrected-source-inputs.json').read_text());fixtures=json.loads((root/'supplemented-fixtures-source.json').read_text())['fixturesFromCandidateGitTree']
def changed(rows):return [r['path'] for r in rows if not (source/r['path']).is_file() or (source/r['path']).stat().st_size!=r.get('size',r.get('bytes')) or sha(source/r['path'])!=r['sha256']]
assert not changed(proof['files']);assert not changed(fixtures)
wrapper=source/'vitest.fixture.config.ts';assert sha(wrapper)==plan['wrapper']['sha256']
write('inputs-before.json',{'at':now(),'source':str(source),'codeInputCount':len(proof['files']),'codeInputReceiptSha256':sha(root/'software-evidence/attempt-003-preparation/corrected-source-inputs.json'),'fixtureCount':len(fixtures),'fixtureReceiptSha256':sha(root/'supplemented-fixtures-source.json'),'wrapperSha256':sha(wrapper),'wrapperScope':plan['wrapper'],'remainingFilesReceiptSha256':sha(root/'remaining-fixture-tests.json'),'outIsSymlink':(source/'out').is_symlink(),'noLiveAcceptanceFlagsChanged':True})
env={**os.environ,'WILLYOU_TEST_CACHE_DIR':str(root/'software-cache-fixture-final'),'COREPACK_ENABLE_NETWORK':'0'}
argv=['pnpm','test',*files,'--config','vitest.fixture.config.ts','--maxWorkers=2','--reporter=json','--outputFile='+str(out/'vitest.json'),'--reporter=verbose']
start=time.monotonic();timed=False;last=0
with (out/'test.log').open('wb') as log:
 p=subprocess.Popen(argv,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 execution={'argv':argv,'cwd':str(source),'pid':p.pid,'processGroup':p.pid,'startedAt':now(),'outerBudgetSeconds':3600,'individualFlagsAndThresholds':'unchanged','additionalCommandsQueued':False};write('execution.json',execution);print(json.dumps({'event':'started','pid':p.pid,'processGroup':p.pid,'cwd':str(source),'fileCount':len(files),'argvReceipt':str(out/'execution.json'),'startedAt':execution['startedAt']}),flush=True)
 while p.poll() is None:
  elapsed=time.monotonic()-start
  if elapsed-last>=30:last=elapsed;print(json.dumps({'event':'running','pid':p.pid,'elapsedSeconds':round(elapsed,1),'logBytes':(out/'test.log').stat().st_size}),flush=True)
  if elapsed>=3600:
   timed=True;os.killpg(p.pid,15)
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(p.pid,9);p.wait()
   break
  time.sleep(.5)
 code=p.wait()
execution.update({'exitCode':code,'timedOut':timed,'elapsedSeconds':round(time.monotonic()-start,3),'finishedAt':now()});write('execution.json',execution)
report=json.loads((out/'vitest.json').read_text()) if (out/'vitest.json').is_file() else {}
tests=[{'file':str(Path(s['name']).relative_to(source)),'fullName':t.get('fullName') or ' > '.join(t.get('ancestorTitles',[])+[t.get('title','')]),'status':t['status'],'durationMs':t.get('duration'),'failureMessages':t.get('failureMessages',[])} for s in report.get('testResults',[]) for t in s.get('assertionResults',[])]
counts={'reportedTotal':report.get('numTotalTests'),'observedTests':len(tests),'passed':sum(t['status']=='passed' for t in tests),'failed':sum(t['status']=='failed' for t in tests),'notExecuted':sum(t['status'] not in ('passed','failed') for t in tests),'files':len(report.get('testResults',[]))}
selection_ok=bool(tests) and report.get('numTotalTests')==len(tests) and {str(Path(s['name']).relative_to(source)) for s in report.get('testResults',[])}==set(files)
code_drift=changed(proof['files']);fixture_drift=changed(fixtures);wrapper_drift=sha(wrapper)!=plan['wrapper']['sha256']
try:os.killpg(p.pid,0);alive=True
except ProcessLookupError:alive=False
write('cleanup.json',{'at':now(),'ownProcessGroup':p.pid,'ownProcessGroupStillExists':alive,'allOwnProcessesStopped':alive is False,'heavyLeaseReleasable':alive is False,'codeDrift':code_drift,'fixtureDrift':fixture_drift,'privateWrapperDrift':wrapper_drift,'additionalCommandsStarted':False,'productionOrOriginalTestsModified':False})
write('raw-summary.json',{'execution':execution,'counts':counts,'selectionVerified':selection_ok,'reportedSuccess':report.get('success'),'tests':tests,'fileResults':[{'file':str(Path(s['name']).relative_to(source)),'status':s.get('status'),'message':s.get('message')} for s in report.get('testResults',[])],'codeDrift':code_drift,'fixtureDrift':fixture_drift,'privateWrapperDrift':wrapper_drift,'allOwnProcessesStopped':alive is False,'formalUniqueCasesAdded':0})
print(json.dumps({'event':'fixture-recovery-complete-resources-stopped','exitCode':code,'counts':counts,'selectionVerified':selection_ok,'reportedSuccess':report.get('success'),'codeDrift':code_drift,'fixtureDrift':fixture_drift,'privateWrapperDrift':wrapper_drift,'ownProcessGroupStillExists':alive,'leaseReleasable':alive is False}),flush=True)
