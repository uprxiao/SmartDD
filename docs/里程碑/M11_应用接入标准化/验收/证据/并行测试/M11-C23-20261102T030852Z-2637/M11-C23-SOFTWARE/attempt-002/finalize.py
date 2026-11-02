from pathlib import Path
import json,hashlib,re,datetime,shutil,collections
root=Path('/private/tmp/willyou-m11-c23-2637');out=root/'software-evidence/attempt-002'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
assert not (out/'manifest.json').exists(),'Do not overwrite sealed original full-suite evidence'
cleanup=json.loads((out/'cleanup.json').read_text());assert cleanup['allOwnProcessesStopped']
executions=json.loads((out/'command-executions.json').read_text());assert len(executions)==2 and all('exitCode' in r for r in executions)
path=out/'vitest.json';report=json.loads(path.read_text()) if path.is_file() else {}
tests=[];file_results=[]
for suite in report.get('testResults',[]):
 file_results.append({'file':suite.get('name'),'status':suite.get('status'),'message':suite.get('message'),'assertionsReported':len(suite.get('assertionResults',[]))})
 for t in suite.get('assertionResults',[]):
  tests.append({'file':suite.get('name'),'fullName':t.get('fullName') or ' > '.join(t.get('ancestorTitles',[])+[t.get('title','')]),'status':t.get('status'),'durationMs':t.get('duration'),'failureMessages':t.get('failureMessages',[])})
statuses=dict(collections.Counter(t['status'] for t in tests));failed=[t for t in tests if t['status']=='failed']
for t in failed:
 messages='\n'.join(t['failureMessages'])
 t['failureShape']=messages.splitlines()[0] if messages else None
 t['classification']='requires-coordinator-product/fixture/environment-review'
 if 'transfer-crash.test.ts' in t['file'] and ('node-pty' in messages or 'pty.node' in messages):t['classification']='fixture-native-dependency-resolution'
 if 'application-controller.test.ts' in t['file']:t['classification']='RPC-contract-test-expectation-review; coordinator-reported-new-endpoints'
 if 'agent-adapters.test.ts' in t['file'] or 'task-capability-launcher.test.ts' in t['file']:t['classification']='R15-version-precondition-review; verify exact frozen-case data before accepting coordinator test-only correction'
write('per-test-results.json',{'observedAssertions':len(tests),'statuses':statuses,'files':file_results,'tests':tests})
write('failures.json',{'count':len(failed),'failedFileCount':len({t['file'] for t in failed}),'tests':failed,'boundary':'Raw original failures retained in final vitest.json. Proposed categories do not amend expectations or mark a failure passed.'})
release_log=(out/'release-tests.log').read_text(errors='replace')
def tap(key):
 m=re.search(r'^# '+key+r'\s+(\d+)\s*$',release_log,re.MULTILINE)
 return int(m.group(1)) if m else None
tap_counts={k:tap(k) for k in ['tests','pass','fail','cancelled','skipped','todo']}
supplement=[]
for filename,argv in [('onboarding-main-check.log',['node','scripts/applications/check-module-onboarding.mjs','--app','sample-kv']),('checkout-paths-main-check.log',['node','scripts/release/check-checkout-paths.mjs'])]:
 p=root/filename
 if p.is_file():
  copy=out/('coordinator-'+filename);shutil.copyfile(p,copy)
  supplement.append({'argv':argv,'actualCwd':'/Users/liubu/Documents/ChatGPT/SmartDD-m10','producer':'coordinator','log':copy.name,'sha256':sha(copy),'exitCodeReportedByCoordinator':0,'scope':'Read-only checks requiring the actual repository Git index; not run inside this Git-less frozen source. Supplements attempt001 environment failures without erasing them.'})
after=json.loads((out/'inputs-after.json').read_text());reported={k:report.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTodoTests','numTotalTestSuites','numPassedTestSuites','numFailedTestSuites','numPendingTestSuites','startTime']}
result={'schema':'willyou-release-software-original-run-v1','group':'V010-SOFTWARE','attempt':2,'phase':'full-original-run','status':'original-run-completed-with-failures' if any(r['exitCode']!=0 for r in executions) else 'original-run-completed','source':'/private/tmp/willyou-m11-c23-2637/source','sourceManifestSha256':'b5b62e1758ae526a4eea48c18070c7d8fe1ef1e615fa34a73f24c06245e0fcb0','executions':executions,'finalVitestJsonPresent':path.is_file(),'finalVitestJsonSha256':sha(path) if path.is_file() else None,'vitestReported':reported,'observedAssertionCount':len(tests),'observedStatuses':statuses,'assertionCountMatchesFinalJson':report.get('numTotalTests')==len(tests),'failedTests':len(failed),'failedFiles':len({t['file'] for t in failed}),'failures':'failures.json','perTestResults':'per-test-results.json','releaseTestTapCounts':tap_counts,'supplementalActualRepositoryChecks':supplement,'inputAfterReceipt':'inputs-after.json','sourceDrift':after['sourceDrift'],'criticalInputChanges':after['criticalInputChanges'],'cleanup':'cleanup.json','heavyLeaseReleasedByExecutor':True,'formalUniqueCasesAdded':0,'coordinatorSuppliedArtifactHashes':{'asar':'0fcf6850d1778aad6a9a9c6add19ab85f978745eb4e3933cf6e1a62ca5f6c08f','dmg':'f1a0df3247128b5d5e984d9ac34d76c882d2fb66c0200c0a6fa7e8df78da784b'},'boundary':'Artifact hashes and Git-check exit codes are coordinator evidence. No packaged App/native UI acceptance is inferred from this software suite. No original suite rerun or expectation changes occurred here.','finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
write('result.json',result)
files=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json']
write('manifest.json',{'schema':'willyou-evidence-manifest-v1','group':'V010-SOFTWARE','attempt':2,'files':files})
print(json.dumps({'status':result['status'],'reported':reported,'observedStatuses':statuses,'failedFileCount':result['failedFiles'],'releaseTestTapCounts':tap_counts,'sourceDrift':after['sourceDrift'],'criticalInputChanges':after['criticalInputChanges'],'manifestSha256':sha(out/'manifest.json')},ensure_ascii=False))
