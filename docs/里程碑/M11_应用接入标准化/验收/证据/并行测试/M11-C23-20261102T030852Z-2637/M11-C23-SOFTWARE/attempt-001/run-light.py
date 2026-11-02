from pathlib import Path
import datetime,hashlib,json,os,subprocess,time

root=Path('/private/tmp/willyou-m11-c23-2637')
source=root/'source';out=root/'software-evidence/attempt-001';manifest_path=root/'source-manifest.json'
expected='b5b62e1758ae526a4eea48c18070c7d8fe1ef1e615fa34a73f24c06245e0fcb0'
commands=[('typecheck',['pnpm','typecheck']),('onboarding',['node','scripts/applications/check-module-onboarding.mjs','--app','sample-kv']),('checkout-paths',['node','scripts/release/check-checkout-paths.mjs']),('release-check',['pnpm','release:check','--tag','v0.1.0'])]
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def changes(files):
 return [r['path'] for r in files if not (source/r['path']).is_file() or (source/r['path']).stat().st_size!=r.get('size',r.get('bytes')) or sha(source/r['path'])!=r['sha256']]
def alive(pgid):
 try:os.killpg(pgid,0);return True
 except ProcessLookupError:return False
 except PermissionError:return 'unknown-permission'

assert not (out/'result.json').exists(),'Refuse to overwrite delivered partial evidence'
assert sha(manifest_path)==expected
manifest=json.loads(manifest_path.read_text());before=changes(manifest['files']);assert not before,before
env={**os.environ,'WILLYOU_TEST_CACHE_DIR':str(root/'software-cache'),'COREPACK_ENABLE_NETWORK':'0'}
started=now();executions=[]
for name,argv in commands:
 start=time.monotonic();timed_out=False
 with (out/(name+'.log')).open('wb') as log:
  process=subprocess.Popen(argv,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  initial={'name':name,'argv':argv,'cwd':str(source),'pid':process.pid,'processGroup':process.pid,'startedAt':now(),'outerBudgetSeconds':180}
  write(name+'.execution.json',initial)
  print(json.dumps({'event':'started',**initial}),flush=True)
  try:code=process.wait(timeout=180)
  except subprocess.TimeoutExpired:
   timed_out=True;os.killpg(process.pid,15)
   try:code=process.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(process.pid,9);code=process.wait()
 result={**initial,'exitCode':code,'timedOut':timed_out,'elapsedSeconds':round(time.monotonic()-start,3),'finishedAt':now(),'ownProcessGroupStillExists':alive(process.pid),'log':name+'.log'}
 write(name+'.execution.json',result);executions.append(result)
 print(json.dumps({'event':'finished','name':name,'exitCode':code,'timedOut':timed_out,'elapsedSeconds':result['elapsedSeconds'],'ownProcessGroupStillExists':result['ownProcessGroupStillExists']}),flush=True)
 if code!=0:print(json.dumps({'event':'check-error','name':name,'logTail':(out/(name+'.log')).read_text(errors='replace')[-12000:]},ensure_ascii=False),flush=True)

after=changes(manifest['files']);manifest_unchanged=sha(manifest_path)==expected
processes=[{'name':r['name'],'processGroup':r['processGroup'],'stillExists':alive(r['processGroup'])} for r in executions];stopped=all(p['stillExists'] is False for p in processes)
write('cleanup.json',{'at':now(),'ownProcessGroups':processes,'allOwnProcessesStopped':stopped,'heavyNativeOrFullSuiteStarted':False,'sharedOutOrDependenciesWritten':False,'sharedResourceLease':'No heavyNative/out lease used; coordinator packaging may change out/native concurrently','sourceChanges':after,'manifestUnchanged':manifest_unchanged,'noAgentModelOrSMTPStarted':True})
write('result.json',{'schema':'willyou-release-software-partial-v1','group':'V010-SOFTWARE','phase':'lightweight','status':'partial-lightweight-complete' if not after and manifest_unchanged and stopped else 'partial-needs-input-or-cleanup-review','source':str(source),'baseCommit':manifest.get('baseCommit'),'sourceManifestSha256':expected,'sourceFileCount':len(manifest['files']),'sourceDrift':after,'manifestUnchanged':manifest_unchanged,'startedAt':started,'finishedAt':now(),'executions':executions,'checksPassed':sum(r['exitCode']==0 and not r['timedOut'] for r in executions),'checksFailed':sum(r['exitCode']!=0 or r['timedOut'] for r in executions),'formalUniqueCasesAdded':0,'cacheEnvironment':{'WILLYOU_TEST_CACHE_DIR':str(root/'software-cache'),'COREPACK_ENABLE_NETWORK':'0'},'dependencyBoundary':'Coordinator is packaging concurrently. No native/output stability claim is made; only frozen source inputs checked. Native/full/release tests have NOT run.','pending':['Coordinator supplies frozen out and heavyNative lease','Full pnpm test --maxWorkers=2 final JSON','pnpm test:release'],'cleanup':'cleanup.json'})
files=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json']
write('manifest.json',{'schema':'willyou-evidence-manifest-v1','group':'V010-SOFTWARE','phase':'lightweight','attempt':1,'files':files})
print(json.dumps({'event':'partial-sealed','checksPassed':sum(r['exitCode']==0 and not r['timedOut'] for r in executions),'checksFailed':sum(r['exitCode']!=0 or r['timedOut'] for r in executions),'sourceDrift':after,'allOwnProcessesStopped':stopped,'manifestSha256':sha(out/'manifest.json')}),flush=True)
