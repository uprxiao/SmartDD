from pathlib import Path
import datetime,hashlib,json,os,subprocess,time
root=Path('/private/tmp/willyou-m11-c23-2637');source=root/'source';out=root/'software-evidence/attempt-002'
manifest_path=root/'source-manifest.json';expected='b5b62e1758ae526a4eea48c18070c7d8fe1ef1e615fa34a73f24c06245e0fcb0'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def alive(pgid):
 try:os.killpg(pgid,0);return True
 except ProcessLookupError:return False
 except PermissionError:return 'unknown-permission'
assert sha(manifest_path)==expected
assert not (out/'full-suite.execution.json').exists(),'Do not repeat an executed suite'
critical=[manifest_path,source/'package.json',source/'pnpm-lock.yaml',source/'vitest.config.ts',source/'scripts/run-tests.mjs']
for name in ['out/capability-bundles/index.json','out/capability-bundles-compatibility-v1/index.json','out/applications/mcp-bridge.cjs','out/main/index.js','out/preload/index.js']:
 if (source/name).is_file():critical.append(source/name)
before={str(p):sha(p) for p in critical};write('inputs-before.json',{'at':now(),'sourceManifestSha256':expected,'criticalInputHashes':before,'boundary':'Coordinator supplied a complete stable out copy and shared dependency lease. Only critical resource indexes/runtime/compiled entries are independently fingerprinted here; full tracked source is checked at the end. No repeated full out traversal before the suite.'})
env={**os.environ,'WILLYOU_TEST_CACHE_DIR':str(root/'software-cache'),'COREPACK_ENABLE_NETWORK':'0'}
commands=[('full-suite',['pnpm','test','--maxWorkers=2','--reporter=json','--outputFile='+str(out/'vitest.json'),'--reporter=default'],7200),('release-tests',['pnpm','test:release'],1800)]
executions=[]
for name,argv,budget in commands:
 start=time.monotonic();timed=False
 with (out/(name+'.log')).open('wb') as log:
  p=subprocess.Popen(argv,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  item={'name':name,'argv':argv,'cwd':str(source),'pid':p.pid,'processGroup':p.pid,'startedAt':now(),'outerBudgetSeconds':budget,'individualTestThresholds':'unchanged','log':name+'.log'}
  write(name+'.execution.json',item);print(json.dumps({'event':'started',**item}),flush=True)
  last=0
  while p.poll() is None:
   elapsed=time.monotonic()-start
   if elapsed-last>=30:
    last=elapsed;print(json.dumps({'event':'running','name':name,'pid':p.pid,'elapsedSeconds':round(elapsed,1),'logBytes':(out/(name+'.log')).stat().st_size}),flush=True)
   if elapsed>=budget:
    timed=True;os.killpg(p.pid,15)
    try:p.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(p.pid,9);p.wait()
    break
   time.sleep(.5)
  code=p.wait()
 item.update({'exitCode':code,'timedOut':timed,'elapsedSeconds':round(time.monotonic()-start,3),'finishedAt':now(),'ownProcessGroupStillExists':alive(p.pid)})
 write(name+'.execution.json',item);executions.append(item);print(json.dumps({'event':'finished',**item}),flush=True)
manifest=json.loads(manifest_path.read_text());drift=[]
for f in manifest['files']:
 p=source/f['path']
 if not p.is_file() or p.stat().st_size!=f.get('size',f.get('bytes')) or sha(p)!=f['sha256']:drift.append(f['path'])
after={str(p):sha(p) if p.is_file() else None for p in critical};critical_changes=[n for n in before if before[n]!=after[n]]
processes=[{'name':r['name'],'processGroup':r['processGroup'],'stillExists':alive(r['processGroup'])} for r in executions];stopped=all(p['stillExists'] is False for p in processes)
write('inputs-after.json',{'at':now(),'sourceManifestSha256':sha(manifest_path),'sourceFileCount':len(manifest['files']),'sourceDrift':drift,'criticalInputHashes':after,'criticalInputChanges':critical_changes})
write('cleanup.json',{'at':now(),'ownProcessGroups':processes,'allOwnProcessesStopped':stopped,'heavyLeaseReleasable':stopped,'sourceDrift':drift,'criticalInputChanges':critical_changes,'productionOrPublicLedgerEdited':False,'ownAppStarted':False,'boundary':'Only the assigned software commands were started; no coordinator App or unknown/daily process was signaled.'})
write('command-executions.json',executions)
print(json.dumps({'event':'commands-complete-resources-stopped','allOwnProcessesStopped':stopped,'leaseReleasable':stopped,'sourceDrift':drift,'criticalInputChanges':critical_changes,'exitCodes':{r['name']:r['exitCode'] for r in executions},'finalVitestJsonExists':(out/'vitest.json').is_file()}),flush=True)
