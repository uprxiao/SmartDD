import subprocess,time,json,os,signal,hashlib,re
from pathlib import Path
from datetime import datetime,timezone
root=Path('/private/tmp/willyou-m11-s1');source=root/'source-attempt-002';evidence=root/'evidence/composition/attempt-002';source_manifest=root/'source-manifest-attempt-002.json'
def stamp():return datetime.now(timezone.utc).isoformat()
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
assert sha(source_manifest)=='9ef81cfdefa14bef170a1a98797766043c199eb823ce70369a9c1d7fa22a0624'
manifest=json.loads(source_manifest.read_text())
def source_bad():return [f['path'] for f in manifest['files'] if not (source/f['path']).exists() or (source/f['path']).stat().st_size!=f['bytes'] or sha(source/f['path'])!=f['sha256']]
assert not source_bad()
fingerprint_js=r'''import fs from 'node:fs';import{createRequire}from'node:module';import{dirname,join,resolve}from'node:path';import{createHash}from'node:crypto';const require=createRequire(import.meta.url),files=[];for(const id of['electron','better-sqlite3','node-pty']){const root=dirname(require.resolve(id+'/package.json'));files.push(join(root,'package.json'));if(id==='electron')files.push(require('electron'));else for(const n of fs.readdirSync(join(root,'build/Release')))if(n.endsWith('.node')||n==='spawn-helper')files.push(join(root,'build/Release',n));}for(const p of['pnpm-lock.yaml','out/native/willyou-process-identity','out/native/willyou-files','out/native/willyou-foxmail','out/applications/mcp-bridge.cjs','out/capability-bundles/index.json'])if(fs.existsSync(p))files.push(resolve(p));console.log(JSON.stringify(files.map(path=>({path,size:fs.statSync(path).size,mode:fs.statSync(path).mode&511,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')}))));'''
def dependencies():return json.loads(subprocess.check_output(['node','--input-type=module','-e',fingerprint_js],cwd=source,text=True))
before=dependencies();(evidence/'dependencies-before.json').write_text(json.dumps({'at':stamp(),'files':before},indent=2)+'\n')
electron=subprocess.check_output(['node','-e',"console.log(require('electron'))"],cwd=source,text=True).strip()
private_runtime=evidence/'runtime-preflight';private_bundles=evidence/'bundles-preflight'
commands=[('runtime-preflight',[electron,'scripts/applications/build-runtime.mjs',str(private_runtime)]),('bundle-preflight',[electron,'scripts/applications/build-bundles.mjs',str(private_bundles),str(private_runtime/'mcp-bridge.cjs')]),('builtin-tests',['pnpm','test','src/main/core/applications/__tests__/builtin-packages.test.ts','--maxWorkers=1','--no-file-parallelism','--no-cache','--reporter=verbose','--reporter=json','--outputFile.json='+str(evidence/'vitest.json')])]
pin_check={'confirmed':False}

results=[];all_pids=[]
for name,argv in commands:
 if results and results[-1]['exitCode']!=0:break
 if name=='builtin-tests' and not pin_check['confirmed']:break
 started=stamp();t0=time.monotonic();timeout=False
 with (evidence/(name+'.log')).open('w') as out:
  p=subprocess.Popen(argv,cwd=source,stdout=out,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'ELECTRON_RUN_AS_NODE':'1'});all_pids.append(p.pid)
  (evidence/'current-command.json').write_text(json.dumps({'name':name,'argv':argv,'pid':p.pid,'pgid':p.pid,'cwd':str(source),'outerBudgetSeconds':180,'startedAt':started},indent=2)+'\n')
  print(json.dumps({'started':name,'pid':p.pid,'at':started}),flush=True)
  try:code=p.wait(timeout=180)
  except subprocess.TimeoutExpired:
   timeout=True;os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=8)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
   code=p.returncode
 value={'name':name,'argv':argv,'startedAt':started,'finishedAt':stamp(),'seconds':round(time.monotonic()-t0,3),'exitCode':code,'outerBudgetExpired':timeout,'pid':p.pid,'log':name+'.log'}
 results.append(value);(evidence/(name+'-result.json')).write_text(json.dumps(value,indent=2)+'\n');print(json.dumps(value),flush=True)
 if name=='bundle-preflight' and code==0:
  expected=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{definitions}from'./resources/applications/definitions.mjs';console.log(JSON.stringify([...new Set(definitions.map(d=>d.runtime.hash))]));"],cwd=source,text=True))
  index=json.loads((private_bundles/'index.json').read_text());actual=[r['hash'] for r in index['runtimes'] if r['id']=='applications']
  pin_check={'confirmed':len(expected)==1 and actual==expected,'expectedOldRuntimeHash':expected,'generatedRuntimeHash':actual,'bridgeFileSha256':sha(private_runtime/'mcp-bridge.cjs'),'validation':'Actual private build-bundles legacy pin guard and generated index; no hash rewritten'}
  (evidence/'runtime-pin-preflight.json').write_text(json.dumps(pin_check,indent=2)+'\n');print(json.dumps(pin_check),flush=True)
after=dependencies();(evidence/'dependencies-after.json').write_text(json.dumps({'at':stamp(),'files':after},indent=2)+'\n');bad=source_bad();coverage={}
if (evidence/'vitest.json').exists():
 report=json.loads((evidence/'vitest.json').read_text());coverage={key:report.get(key) for key in ['numTotalTestSuites','numPassedTestSuites','numFailedTestSuites','numTotalTests','numPassedTests','numFailedTests','numPendingTests','success']}
 coverage['failures']=[{'name':' > '.join([*a.get('ancestorTitles',[]),a.get('title','')]),'messages':a.get('failureMessages',[])} for suite in report.get('testResults',[]) for a in suite.get('assertionResults',[]) if a.get('status')=='failed']
result={'schema':'m11-s1-c-result-v1','group':'M11-S1-C','source':str(source),'sourceManifestSha256':sha(source_manifest),'checks':results,'runtimePinPreflight':pin_check,'coverage':coverage,'sourceFileCount':len(manifest['files']),'sourceMismatches':bad,'dependencyBaselineUnchanged':before==after,'formalM11NewPassed':0,'status':'passed' if len(results)==3 and pin_check['confirmed'] and all(c['exitCode']==0 and not c['outerBudgetExpired'] for c in results) and not bad and before==after else 'incomplete-outer-budget' if any(c['outerBudgetExpired'] for c in results) else 'failed','finishedAt':stamp(),'notes':['No production/App build; builtin-package tests generate only their original private runtime/bundle fixtures.','No source, expectations or authority-ledger edits.']}
(evidence/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
checks=[]
for pid in all_pids:
 try:os.killpg(pid,0);state='present'
 except ProcessLookupError:state='absent'
 except PermissionError:state='unverified-permission'
 checks.append({'pgid':pid,'state':state})
cleanup={'at':stamp(),'ownedGroups':checks,'resourcesReleased':all(c['state']=='absent' for c in checks),'observationHooks':[],'sourceModified':False,'sharedDependenciesModified':before!=after}
(evidence/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n')
files=[{'path':f.name,'size':f.stat().st_size,'sha256':sha(f)} for f in sorted(evidence.iterdir()) if f.is_file() and f.name!='manifest.json']
(evidence/'manifest.json').write_text(json.dumps({'schema':'m11-test-delivery-v1','group':'M11-S1-C','attempt':'attempt-002','files':files,'formalM11NewPassed':0,'frozen':True},indent=2)+'\n')
print(json.dumps({'status':result['status'],'coverage':coverage,'sourceMismatches':bad,'dependenciesUnchanged':before==after,'resourcesReleased':cleanup['resourcesReleased'],'manifestSha256':sha(evidence/'manifest.json')},ensure_ascii=False),flush=True)
