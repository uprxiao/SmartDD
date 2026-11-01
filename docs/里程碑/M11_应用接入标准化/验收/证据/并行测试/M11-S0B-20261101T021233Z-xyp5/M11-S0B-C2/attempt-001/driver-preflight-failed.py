import subprocess,time,json,os,signal,re,hashlib
from pathlib import Path
from datetime import datetime,timezone
root=Path('/private/tmp/willyou-m11-s0b-xyp5tfp9');source=root/'source-attempt-004';evidence=root/'evidence/composition-split2/attempt-001';source_manifest=root/'source-manifest-attempt-004.json'
def stamp():return datetime.now(timezone.utc).isoformat()
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(source_manifest)=='231212e297bdcb9ef995500b1a6689fd1a5ce5039e577b989cd7160556cb817f'
manifest=json.loads(source_manifest.read_text());group=json.loads((root/'task-test-partitions.json').read_text())['groups'][1]
assert group['id']=='M11-S0B-C2' and group['count']==127 and len(set(group['expectedNames']))==127
(evidence/'selected-group.json').write_text(json.dumps(group,ensure_ascii=False,indent=2)+'\n')
fingerprint_js=r'''import fs from 'node:fs';import{createRequire}from'node:module';import{dirname,join,resolve}from'node:path';import{createHash}from'node:crypto';const require=createRequire(import.meta.url),files=[];for(const id of['electron','better-sqlite3','node-pty']){const root=dirname(require.resolve(id+'/package.json'));files.push(join(root,'package.json'));if(id==='electron')files.push(require('electron'));else for(const n of fs.readdirSync(join(root,'build/Release')))if(n.endsWith('.node')||n==='spawn-helper')files.push(join(root,'build/Release',n));}for(const p of['pnpm-lock.yaml','out/native/willyou-process-identity','out/native/willyou-files','out/native/willyou-foxmail','out/applications/mcp-bridge.cjs','out/capability-bundles/index.json'])if(fs.existsSync(p))files.push(resolve(p));console.log(JSON.stringify(files.map(path=>({path,size:fs.statSync(path).size,mode:fs.statSync(path).mode&511,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')}))));'''
def dependencies():return json.loads(subprocess.check_output(['node','--input-type=module','-e',fingerprint_js],cwd=source,text=True))
before=dependencies();(evidence/'dependencies-before.json').write_text(json.dumps({'at':stamp(),'baseline':'post-packaging native verification; new baseline, not compared with previous attempts','files':before},ensure_ascii=False,indent=2)+'\n')
argv=['pnpm','test','src/main/core/applications/__tests__/task-capability-launcher.test.ts','-t',group['pattern'],'--no-cache','--maxWorkers=1','--no-file-parallelism','--reporter=verbose','--reporter=json','--outputFile.json='+str(evidence/'vitest.json')]
started=stamp();t0=time.monotonic();timeout=False;tree=[]
with (evidence/'test.log').open('w') as out:
 p=subprocess.Popen(argv,cwd=source,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
 (evidence/'command.json').write_text(json.dumps({'pid':p.pid,'pgid':p.pid,'runnerPid':os.getpid(),'cwd':str(source),'argv':argv,'startedAt':started,'outerBudgetSeconds':1800,'individualTimeoutsUnchanged':True},ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'group':group['id'],'pid':p.pid,'selected':127,'filteredExpected':128,'startedAt':started}),flush=True)
 try:code=p.wait(timeout=1800)
 except subprocess.TimeoutExpired:
  timeout=True;seen=set();queue=[p.pid]
  while queue and len(seen)<256:
   current=queue.pop(0)
   if current in seen:continue
   seen.add(current);q=subprocess.run(['pgrep','-P',str(current)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True);queue.extend(int(x) for x in q.stdout.split() if x.isdigit())
  tree=sorted(seen);(evidence/'pre-timeout-tree.json').write_text(json.dumps({'at':stamp(),'rootPid':p.pid,'knownDescendants':tree},indent=2)+'\n');os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=8)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  code=p.returncode
seconds=round(time.monotonic()-t0,3);after=dependencies();(evidence/'dependencies-after.json').write_text(json.dumps({'at':stamp(),'files':after},ensure_ascii=False,indent=2)+'\n')
bad=[name for name,digest in manifest['files'].items() if not (source/name).exists() or sha(source/name)!=digest]
coverage={'jsonPresent':(evidence/'vitest.json').exists(),'expectedCount':127,'filteredExpected':128}
if coverage['jsonPresent']:
 report=json.loads((evidence/'vitest.json').read_text());rows=[]
 for suite in report.get('testResults',[]):rows.extend(suite.get('assertionResults',[]))
 for a in rows:a['canonicalName']=' > '.join([*a.get('ancestorTitles',[]),a.get('title','')])
 expected=set(group['expectedNames']);executed=[a for a in rows if a.get('status') in ('passed','failed')];actual={a['canonicalName'] for a in executed};filtered=[a for a in rows if a.get('status') not in ('passed','failed')]
 coverage.update({'numTotalTests':report.get('numTotalTests'),'numPassedTests':report.get('numPassedTests'),'numFailedTests':report.get('numFailedTests'),'numPendingTests':report.get('numPendingTests'),'executedCount':len(executed),'executedUniqueCount':len(actual),'passedCount':sum(a.get('status')=='passed' for a in executed),'failedCount':sum(a.get('status')=='failed' for a in executed),'filteredCount':len(filtered),'missing':sorted(expected-actual),'unexpected':sorted(actual-expected),'failed':[{'name':a['canonicalName'],'messages':a.get('failureMessages',[])} for a in executed if a.get('status')=='failed'})
 (evidence/'executed-tests.json').write_text(json.dumps([{'name':a['canonicalName'],'status':a.get('status'),'duration':a.get('duration')} for a in executed],ensure_ascii=False,indent=2)+'\n')
 coverage['all127ExecutedAndPassed']=len(executed)==127 and len(actual)==127 and not coverage['missing'] and not coverage['unexpected'] and coverage['failedCount']==0 and len(filtered)==128
result={'schema':'m11-s0b-c2-result-v1','group':group['id'],'source':str(source),'sourceManifestSha256':sha(source_manifest),'partitionSha256':sha(root/'task-test-partitions.json'),'startedAt':started,'finishedAt':stamp(),'seconds':seconds,'exitCode':code,'outerBudgetExpired':timeout,'execution':'require_escalated for isolated local fixtures/socket only','coverage':coverage,'sourceFileCount':len(manifest['files']),'sourceMismatches':bad,'newDependencyBaselineUnchanged':before==after,'formalM11NewPassed':0,'status':'passed' if code==0 and not timeout and coverage.get('all127ExecutedAndPassed') and not bad and before==after else 'incomplete-outer-budget' if timeout else 'failed'}
(evidence/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
known=tree or[p.pid];checks=[]
for pid in known:
 try:os.kill(pid,0);state='present'
 except ProcessLookupError:state='absent'
 except PermissionError:state='unverified-permission'
 checks.append({'pid':pid,'state':state})
try:os.killpg(p.pid,0);group_state='present'
except ProcessLookupError:group_state='absent'
except PermissionError:group_state='unverified-permission'
cleanup={'at':stamp(),'rootPid':p.pid,'pgid':p.pid,'groupState':group_state,'knownProcessChecks':checks,'observationHooks':[],'sourceModified':False,'sharedDependenciesModified':before!=after,'resourcesReleased':group_state=='absent' and all(c['state']=='absent' for c in checks),'scope':'Only own command group; test fixture teardown assertions and captured timeout tree, when applicable.'}
(evidence/'cleanup.json').write_text(json.dumps(cleanup,ensure_ascii=False,indent=2)+'\n')
files=[{'path':f.name,'size':f.stat().st_size,'sha256':sha(f)} for f in sorted(evidence.iterdir()) if f.is_file() and f.name!='manifest.json']
(evidence/'manifest.json').write_text(json.dumps({'schema':'m11-test-delivery-v1','group':group['id'],'attempt':'attempt-001','files':files,'formalM11NewPassed':0},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':result['status'],'seconds':seconds,'exitCode':code,'coverage':coverage,'resourcesReleased':cleanup['resourcesReleased'],'sourceMismatches':bad,'dependenciesUnchanged':before==after,'manifestSha256':sha(evidence/'manifest.json')},ensure_ascii=False),flush=True)
