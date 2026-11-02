from pathlib import Path
import json,hashlib,datetime,subprocess,time,os
root=Path('/private/tmp/willyou-m11-c23-2637');source=root/'software-source-attempt-002';out=root/'software-evidence/attempt-005-final-full'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
assert not (out/'execution.json').exists(),'Never restart an executed final full suite'
delta=json.loads((root/'test-only-corrections.json').read_text());test_pins={r['path']:r['afterSha256'] for r in delta['changes']}
assert {n:sha(source/n) for n in test_pins}==test_pins
proof_path=root/'software-evidence/attempt-003-preparation/corrected-source-inputs.json';proof=json.loads(proof_path.read_text());expected={r['path']:r for r in proof['files']}
critical=['package.json','pnpm-lock.yaml','vitest.config.ts','scripts/run-tests.mjs']
critical_hashes={n:sha(source/n) for n in critical};assert all(critical_hashes[n]==expected[n]['sha256'] for n in critical)
assert json.loads((source/'package.json').read_text())['version']=='0.1.0'
write('inputs-before.json',{'at':now(),'source':str(source),'correctedInputReceipt':str(proof_path),'correctedInputReceiptSha256':sha(proof_path),'testCorrectionSha256':sha(root/'test-only-corrections.json'),'fourTestPins':test_pins,'criticalInputHashes':critical_hashes,'productionProof':'Previously verified other 3229 inputs unchanged; no repeated long out traversal. Coordinator guarantees stable shared out/node_modules for this lease.'})
env={**os.environ,'WILLYOU_TEST_CACHE_DIR':str(root/'software-cache-final'),'COREPACK_ENABLE_NETWORK':'0'}
argv=['pnpm','test','--maxWorkers=2','--reporter=json','--outputFile='+str(out/'vitest.json'),'--reporter=verbose']
start=time.monotonic();timed=False;last=0
with (out/'test.log').open('wb') as log:
 p=subprocess.Popen(argv,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 execution={'argv':argv,'cwd':str(source),'pid':p.pid,'processGroup':p.pid,'startedAt':now(),'outerBudgetSeconds':10800,'individualTestThresholds':'unchanged','additionalCommandsQueued':False};write('execution.json',execution);print(json.dumps({'event':'started',**execution}),flush=True)
 while p.poll() is None:
  elapsed=time.monotonic()-start
  if elapsed-last>=30:last=elapsed;print(json.dumps({'event':'running','pid':p.pid,'elapsedSeconds':round(elapsed,1),'logBytes':(out/'test.log').stat().st_size}),flush=True)
  if elapsed>=10800:
   timed=True;os.killpg(p.pid,15)
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(p.pid,9);p.wait()
   break
  time.sleep(.5)
 code=p.wait()
execution.update({'exitCode':code,'timedOut':timed,'elapsedSeconds':round(time.monotonic()-start,3),'finishedAt':now()});write('execution.json',execution)
report=json.loads((out/'vitest.json').read_text()) if (out/'vitest.json').is_file() else {}
tests=[{'file':s['name'],'fullName':t.get('fullName') or ' > '.join(t.get('ancestorTitles',[])+[t.get('title','')]),'status':t['status'],'durationMs':t.get('duration'),'failureMessages':t.get('failureMessages',[])} for s in report.get('testResults',[]) for t in s.get('assertionResults',[])]
counts={'jsonTotalTests':report.get('numTotalTests'),'observedTests':len(tests),'passed':sum(t['status']=='passed' for t in tests),'failed':sum(t['status']=='failed' for t in tests),'notExecuted':sum(t['status'] not in ('passed','failed') for t in tests),'filtered':0}
valid=bool(tests) and report.get('numTotalTests')==len(tests)
drift=[]
for r in proof['files']:
 f=source/r['path']
 if not f.is_file() or f.stat().st_size!=r['size'] or sha(f)!=r['sha256']:drift.append(r['path'])
try:os.killpg(p.pid,0);alive=True
except ProcessLookupError:alive=False
write('cleanup.json',{'at':now(),'ownProcessGroup':p.pid,'ownProcessGroupStillExists':alive,'allOwnProcessesStopped':alive is False,'heavyLeaseReleasable':alive is False,'correctedSourceDrift':drift,'additionalNativeUiOrReleaseTestsStarted':False,'productionOrPublicLedgerModified':False})
write('raw-summary.json',{'execution':execution,'counts':counts,'jsonValidAndNonempty':valid,'reportedCounts':{k:report.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTodoTests','numTotalTestSuites','numFailedTestSuites','numPendingTestSuites']},'tests':tests,'fileResults':[{'file':s.get('name'),'status':s.get('status'),'message':s.get('message')} for s in report.get('testResults',[])],'failures':[t for t in tests if t['status']=='failed'],'correctedSourceDrift':drift,'allOwnProcessesStopped':alive is False,'formalUniqueCasesAdded':0})
print(json.dumps({'event':'final-full-complete-resources-stopped','exitCode':code,'counts':counts,'jsonValidAndNonempty':valid,'reportedSuccess':report.get('success'),'correctedSourceDrift':drift,'ownProcessGroupStillExists':alive,'leaseReleasable':alive is False}),flush=True)
