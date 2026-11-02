from pathlib import Path
import json,hashlib,datetime,subprocess,time,os,re
root=Path('/private/tmp/willyou-m11-c23-2637');source=root/'software-source-attempt-002';out=root/'software-evidence/attempt-004'
pattern='F03 survives SIGKILL|PW rejects an unsupported|M11 T25 best-effort MCP|exposes explicit business endpoints|gates the M11|keeps default H checks|stopping an unverifiable native guard|ordinary native work with unverifiable CLI|ordinary original native continuation with unverifiable CLI'
files=['src/main/core/projects/transfer-crash.test.ts','src/main/core/applications/__tests__/agent-adapters.test.ts','src/main/core/applications/__tests__/application-controller.test.ts','src/main/core/applications/__tests__/task-capability-launcher.test.ts']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
assert not (out/'execution.json').exists(),'Do not rerun a started targeted attempt'
delta=json.loads((root/'test-only-corrections.json').read_text());checks={r['path']:r['afterSha256'] for r in delta['changes']}
assert set(checks)==set(files)
actual={n:sha(source/n) for n in files};assert actual==checks
write('inputs-before.json',{'at':now(),'source':str(source),'fourTestHashes':actual,'testCorrectionSha256':sha(root/'test-only-corrections.json'),'productionInputReceipt':'../attempt-003-preparation/result.json','boundary':'Reuses validated production/3229 input proof; no repeated long out traversal before precise tests.'})
env={**os.environ,'WILLYOU_TEST_CACHE_DIR':str(root/'software-cache-final'),'COREPACK_ENABLE_NETWORK':'0'}
argv=['pnpm','test',*files,'--maxWorkers=1','--testNamePattern',pattern,'--reporter=json','--outputFile='+str(out/'vitest.json'),'--reporter=verbose']
start=time.monotonic();timed=False;last=0
with (out/'test.log').open('wb') as log:
 p=subprocess.Popen(argv,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 execution={'argv':argv,'cwd':str(source),'pid':p.pid,'processGroup':p.pid,'startedAt':now(),'outerBudgetSeconds':1200,'individualTestThresholds':'unchanged'};write('execution.json',execution);print(json.dumps({'event':'started',**execution}),flush=True)
 while p.poll() is None:
  elapsed=time.monotonic()-start
  if elapsed-last>=30:last=elapsed;print(json.dumps({'event':'running','pid':p.pid,'elapsedSeconds':round(elapsed,1),'logBytes':(out/'test.log').stat().st_size}),flush=True)
  if elapsed>=1200:
   timed=True;os.killpg(p.pid,15)
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(p.pid,9);p.wait()
   break
  time.sleep(.5)
 code=p.wait()
execution.update({'exitCode':code,'timedOut':timed,'elapsedSeconds':round(time.monotonic()-start,3),'finishedAt':now()});write('execution.json',execution)
report=json.loads((out/'vitest.json').read_text()) if (out/'vitest.json').is_file() else {}
tests=[]
for suite in report.get('testResults',[]):
 for t in suite.get('assertionResults',[]):
  name=t.get('fullName') or ' '.join(t.get('ancestorTitles',[])+[t.get('title','')]);tests.append({'file':suite['name'],'name':name,'selected':bool(re.search(pattern,name)),'status':t['status'],'durationMs':t.get('duration'),'failureMessages':t.get('failureMessages',[])})
selected=[t for t in tests if t['selected']];outside=[t for t in tests if not t['selected']]
counts={'reportedTotal':report.get('numTotalTests'),'observed':len(tests),'selected':len(selected),'selectedPassed':sum(t['status']=='passed' for t in selected),'selectedFailed':sum(t['status']=='failed' for t in selected),'selectedNotExecuted':sum(t['status'] not in ('passed','failed') for t in selected),'filtered':len(outside),'outsideExecuted':sum(t['status'] in ('passed','failed') for t in outside)}
selection_ok=bool(selected) and counts['reportedTotal']==len(tests) and {Path(s['name']).resolve() for s in report.get('testResults',[])}=={(source/f).resolve() for f in files} and counts['selectedNotExecuted']==0 and counts['outsideExecuted']==0
after={n:sha(source/n) for n in files};drift=[n for n in actual if actual[n]!=after[n]]
try:os.killpg(p.pid,0);alive=True
except ProcessLookupError:alive=False
write('cleanup.json',{'at':now(),'ownProcessGroup':p.pid,'ownProcessGroupStillExists':alive,'allOwnProcessesStopped':alive is False,'heavyLeaseReleasable':alive is False,'sourceTestDrift':drift,'fullSuiteOrReleaseTestsAppended':False,'productionOrPublicLedgerModified':False})
write('raw-summary.json',{'execution':execution,'counts':counts,'selectionVerified':selection_ok,'tests':tests,'failures':[t for t in tests if t['status']=='failed'],'inputHashesAfter':after,'sourceTestDrift':drift,'allOwnProcessesStopped':alive is False,'formalUniqueCasesAdded':0})
print(json.dumps({'event':'targeted-complete-resources-stopped','exitCode':code,'counts':counts,'selectionVerified':selection_ok,'sourceDrift':drift,'ownProcessGroupStillExists':alive,'leaseReleasable':alive is False}),flush=True)
