import subprocess,time,json,os,signal,hashlib
from pathlib import Path
from datetime import datetime,timezone
root=Path('/private/tmp/willyou-m11-s1a');source=root/'source-attempt-001';evidence=root/'evidence/composition/attempt-001';source_manifest=root/'source-manifest-attempt-001.json'
def stamp():return datetime.now(timezone.utc).isoformat()
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
assert sha(source_manifest)=='954678b2cb036b2808439c1159a10d3c31249f9dd57c3f82c910e9aa4a1ebf77'
manifest=json.loads(source_manifest.read_text())
def source_bad():return [f['path'] for f in manifest['files'] if not (source/f['path']).exists() or (source/f['path']).stat().st_size!=f['bytes'] or sha(source/f['path'])!=f['sha256']]
assert not source_bad()
fingerprint_js=r'''import fs from 'node:fs';import{createRequire}from'node:module';import{dirname,join,resolve}from'node:path';import{createHash}from'node:crypto';const require=createRequire(import.meta.url),files=[];for(const id of['electron','better-sqlite3','node-pty']){const root=dirname(require.resolve(id+'/package.json'));files.push(join(root,'package.json'));if(id==='electron')files.push(require('electron'));else for(const n of fs.readdirSync(join(root,'build/Release')))if(n.endsWith('.node')||n==='spawn-helper')files.push(join(root,'build/Release',n));}for(const p of['pnpm-lock.yaml','out/native/willyou-process-identity','out/native/willyou-files','out/native/willyou-foxmail','out/applications/mcp-bridge.cjs','out/capability-bundles/index.json'])if(fs.existsSync(p))files.push(resolve(p));console.log(JSON.stringify(files.map(path=>({path,size:fs.statSync(path).size,mode:fs.statSync(path).mode&511,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')}))));'''
def dependencies():return json.loads(subprocess.check_output(['node','--input-type=module','-e',fingerprint_js],cwd=source,text=True))
before=dependencies();(evidence/'dependencies-before.json').write_text(json.dumps({'at':stamp(),'files':before},indent=2)+'\n')
preflight=subprocess.run(['node',str(evidence/'local-listen-preflight.cjs')],cwd=source,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=10)
(evidence/'local-listen-preflight.log').write_text(preflight.stdout+preflight.stderr);probe=json.loads(preflight.stdout.strip());(evidence/'local-listen-preflight.json').write_text(json.dumps({'at':stamp(),'exitCode':preflight.returncode,**probe},indent=2)+'\n');print(json.dumps({'preflight':probe,'exitCode':preflight.returncode}),flush=True)
files=['config-view-registry.test.ts','connection-service.test.ts','selection-service.test.ts','application-impact.test.ts','business-data.test.ts','mail-read-data.test.ts','mail-send-data.test.ts','zentao-data.test.ts']
argv=['pnpm','test',*['src/main/core/applications/__tests__/'+name for name in files],'--maxWorkers=1','--no-file-parallelism','--no-cache','--reporter=verbose','--reporter=json','--outputFile.json='+str(evidence/'vitest.json')]
started=stamp();t0=time.monotonic();timeout=False;pid=None;code=None;known=[]
if preflight.returncode==0 and probe.get('unix',{}).get('ok') and probe.get('tcp',{}).get('ok'):
 with (evidence/'test.log').open('w') as out:
  p=subprocess.Popen(argv,cwd=source,stdout=out,stderr=subprocess.STDOUT,start_new_session=True);pid=p.pid
  (evidence/'command.json').write_text(json.dumps({'argv':argv,'pid':pid,'pgid':pid,'runnerPid':os.getpid(),'startedAt':started,'outerBudgetSeconds':600,'individualThresholdsUnchanged':True,'execution':'require_escalated for private local fixtures only'},indent=2)+'\n');print(json.dumps({'startedAt':started,'pid':pid,'files':8}),flush=True)
  try:code=p.wait(timeout=600)
  except subprocess.TimeoutExpired:
   timeout=True;queue=[pid];seen=set()
   while queue and len(seen)<256:
    current=queue.pop(0)
    if current in seen:continue
    seen.add(current);q=subprocess.run(['pgrep','-P',str(current)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True);queue.extend(int(x) for x in q.stdout.split() if x.isdigit())
   known=sorted(seen);(evidence/'pre-timeout-process-tree.json').write_text(json.dumps({'at':stamp(),'rootPid':pid,'knownDescendants':known},indent=2)+'\n');os.killpg(pid,signal.SIGTERM)
   try:p.wait(timeout=8)
   except subprocess.TimeoutExpired:os.killpg(pid,signal.SIGKILL);p.wait()
   code=p.returncode
seconds=round(time.monotonic()-t0,3);after=dependencies();(evidence/'dependencies-after.json').write_text(json.dumps({'at':stamp(),'files':after},indent=2)+'\n');bad=source_bad();coverage={}
if (evidence/'vitest.json').exists():
 report=json.loads((evidence/'vitest.json').read_text());coverage={k:report.get(k) for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','success']};coverage['fileResults']=[{'file':s.get('name'),'status':s.get('status'),'message':s.get('message'),'passed':sum(a.get('status')=='passed' for a in s.get('assertionResults',[])),'failed':sum(a.get('status')=='failed' for a in s.get('assertionResults',[])),'notExecuted':sum(a.get('status') not in ('passed','failed') for a in s.get('assertionResults',[]))} for s in report.get('testResults',[])];coverage['failures']=[{'name':' > '.join([*a.get('ancestorTitles',[]),a.get('title','')]),'messages':a.get('failureMessages',[])} for s in report.get('testResults',[]) for a in s.get('assertionResults',[]) if a.get('status')=='failed']
result={'schema':'m11-s1a-c-result-v1','group':'M11-S1A-C','source':str(source),'sourceManifestSha256':sha(source_manifest),'startedAt':started,'finishedAt':stamp(),'seconds':seconds,'exitCode':code,'outerBudgetExpired':timeout,'localListenPreflight':probe,'coverage':coverage,'sourceFileCount':len(manifest['files']),'sourceMismatches':bad,'dependencyBaselineUnchanged':before==after,'formalM11NewPassed':0,'status':'passed' if code==0 and not timeout and len(coverage.get('fileResults',[]))==8 and coverage.get('success') and not bad and before==after else 'incomplete-outer-budget' if timeout else 'failed'}
(evidence/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');checks=[]
for item in known or([pid] if pid else[]):
 try:os.kill(item,0);state='present'
 except ProcessLookupError:state='absent'
 except PermissionError:state='unverified-permission'
 checks.append({'pid':item,'state':state})
try:
 if pid:os.killpg(pid,0);group_state='present'
 else:group_state='not-started'
except ProcessLookupError:group_state='absent'
except PermissionError:group_state='unverified-permission'
cleanup={'at':stamp(),'rootPid':pid,'groupState':group_state,'knownProcesses':checks,'probeRootRemoved':probe.get('createdRootRemoved'),'resourcesReleased':group_state in ['absent','not-started'] and all(x['state']=='absent' for x in checks),'observationHooks':[],'sourceModified':False,'sharedDependenciesModified':before!=after}
(evidence/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n');entries=[{'path':f.name,'size':f.stat().st_size,'sha256':sha(f)} for f in sorted(evidence.iterdir()) if f.is_file() and f.name!='manifest.json'];(evidence/'manifest.json').write_text(json.dumps({'schema':'m11-test-delivery-v1','group':'M11-S1A-C','attempt':'attempt-001','files':entries,'formalM11NewPassed':0,'frozen':True},indent=2)+'\n')
print(json.dumps({'status':result['status'],'seconds':seconds,'exitCode':code,'coverage':coverage,'sourceMismatches':bad,'dependenciesUnchanged':before==after,'resourcesReleased':cleanup['resourcesReleased'],'manifestSha256':sha(evidence/'manifest.json')},ensure_ascii=False),flush=True)
