import hashlib,json,os,re,signal,subprocess,time
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path

B=Path('/private/tmp/willyou-m11-s3');S=B/'source-attempt-003';E=B/'evidence/composition/attempt-002';M=B/'source-manifest-attempt-003.json';PIN='7d83eda6a4177d0893fb5a232133c18d3bae2d8270255085ad72d7f6882ee3b0'
MAIL='src/main/core/applications/__tests__/mail-send-data.test.ts'
def now():return datetime.now(timezone.utc).isoformat()
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def dump(p,d):Path(p).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
assert sha(M)==PIN
rows=json.loads(M.read_text())['files']
def bad_source():return [x['path'] for x in rows if not(S/x['path']).exists() or (S/x['path']).stat().st_size!=x['bytes'] or sha(S/x['path'])!=x['sha256']]
dependency_paths=[Path(x['path']) for x in json.loads(Path('/private/tmp/willyou-m11-s1a/evidence/composition-remainder-preparation/attempt-001/inputs-before.json').read_text())['sharedDependencies']]
dependency_paths.extend(S/x for x in ['out/native/willyou-process-identity','out/native/willyou-files','out/native/willyou-foxmail','out/applications/mcp-bridge.cjs','out/capability-bundles/index.json'] if (S/x).exists())
def dependencies():return [{'path':str(p),'size':p.stat().st_size,'mode':p.stat().st_mode&511,'sha256':sha(p)} for p in dependency_paths]
def state(pid,group=False):
 try:(os.killpg if group else os.kill)(pid,0);return 'present'
 except ProcessLookupError:return 'absent'
 except PermissionError:return 'unverified-permission'
def tree(pid):
 queue=[pid];seen=set();out=[]
 while queue and len(seen)<256:
  current=queue.pop(0)
  if current in seen:continue
  seen.add(current);p=subprocess.run(['ps','-o','pid=,ppid=,pgid=,stat=,comm=','-p',str(current)],capture_output=True,text=True)
  if p.returncode==0:out.append({'pid':current,'ps':p.stdout.strip()})
  p=subprocess.run(['pgrep','-P',str(current)],capture_output=True,text=True);queue.extend(int(x) for x in p.stdout.split() if x.isdigit())
 return out
def seal(p,ident):
 entries=[{'path':x.name,'size':x.stat().st_size,'sha256':sha(x)} for x in sorted(p.iterdir()) if x.is_file() and x.name!='manifest.json'];dump(p/'manifest.json',{'schema':'m11-test-delivery-v1','group':ident,'attempt':'attempt-002','files':entries,'formalM11NewPassed':0,'frozen':True});return sha(p/'manifest.json')
started=now();baseline=dependencies();assert not bad_source();dump(E/'inputs-before.json',{'at':now(),'source':str(S),'sourceManifestSha256':PIN,'sourceFiles':len(rows),'sourceMismatches':[],'dependencies':baseline,'outReadOnlyShared':str((S/'out').resolve()),'nodeModulesReadOnlyShared':str((S/'node_modules').resolve())})
cache=E/'cache';cache.mkdir();config=E/'vitest.config.mjs';config.write_text('import sourceConfig from '+json.dumps(str(S/'vitest.config.ts'))+';\nexport default {...sourceConfig,cacheDir:'+json.dumps(str(cache/'vite'))+'};\n')
dump(E/'configuration-boundary.json',{'frozenConfiguration':str(S/'vitest.config.ts'),'frozenConfigurationSha256':sha(S/'vitest.config.ts'),'privateConfiguration':str(config),'privateConfigurationSha256':sha(config),'onlyConfigValueOverride':{'cacheDir':str(cache/'vite')},'cliConfigurationLoader':'runner','configurationLoaderReason':'Avoid transient configuration bundling into readonly shared node_modules/.vite-temp','testLogicAndIndividualTimeoutsUnchanged':True,'noCache':True})
probe=E/'local-listen-preflight.cjs';probe.write_bytes(Path('/private/tmp/willyou-m11-s1a/evidence/composition/attempt-001/local-listen-preflight.cjs').read_bytes());p=subprocess.run(['node',str(probe)],cwd=S,text=True,capture_output=True,timeout=10);(E/'local-listen-preflight.log').write_text(p.stdout+p.stderr);probe_data=json.loads(p.stdout.strip());dump(E/'local-listen-preflight.json',{'at':now(),'exitCode':p.returncode,**probe_data});assert p.returncode==0
common=['--config',str(config),'--configLoader=runner','--maxWorkers=1','--no-file-parallelism','--no-cache'];electron=subprocess.check_output(['node','-p','require("electron")'],cwd=S,text=True).strip();commands=[];tests=[]
def execute(ident,argv,env=None,outer=180):
 p=E/ident;p.mkdir();clock=time.monotonic();expired=False;known=set();observations=[];at=now()
 with (p/'command.log').open('w') as log:
  launch_env=os.environ.copy();launch_env.update(env or {});launch_env['COREPACK_ENABLE_NETWORK']='0';child=subprocess.Popen(argv,cwd=S,env=launch_env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);pid=child.pid;dump(p/'command.json',{'argv':argv,'cwd':str(S),'startedAt':at,'pid':pid,'pgid':pid,'runnerPid':os.getpid(),'environmentOverrides':{'COREPACK_ENABLE_NETWORK':'0','ELECTRON_RUN_AS_NODE':launch_env.get('ELECTRON_RUN_AS_NODE'),'WILLYOU_TEST_FAILURE_DETAILS':launch_env.get('WILLYOU_TEST_FAILURE_DETAILS')},'outerSeconds':outer,'individualTimeoutsUnchanged':True,'permission':'require_escalated for private local fixture listeners only'});print(json.dumps({'event':'started','id':ident,'pid':pid,'at':at}),flush=True)
  try:code=child.wait(timeout=min(1,outer))
  except subprocess.TimeoutExpired:
   observed=tree(pid);known.update(x['pid'] for x in observed);observations.append({'at':now(),'processes':observed})
   try:code=child.wait(timeout=max(.01,outer-(time.monotonic()-clock)))
   except subprocess.TimeoutExpired:
    expired=True;observed=tree(pid);known.update(x['pid'] for x in observed);observations.append({'at':now(),'reason':'outer-budget','processes':observed});os.killpg(pid,signal.SIGTERM)
    try:code=child.wait(timeout=8)
    except subprocess.TimeoutExpired:os.killpg(pid,signal.SIGKILL);code=child.wait()
 known.add(pid);action=None
 if state(pid,True)=='present':
  action='SIGTERM exact owned group after root exit';os.killpg(pid,signal.SIGTERM);deadline=time.monotonic()+5
  while state(pid,True)=='present' and time.monotonic()<deadline:time.sleep(.1)
  if state(pid,True)=='present':action+=' then SIGKILL';os.killpg(pid,signal.SIGKILL)
 checks=[{'pid':x,'state':state(x)} for x in sorted(known)];released=state(pid,True)=='absent' and all(x['state']=='absent' for x in checks);dump(p/'process-observations.json',{'scope':'exact own root descendants only','rootPid':pid,'observations':observations});dump(p/'cleanup.json',{'at':now(),'rootPid':pid,'groupState':state(pid,True),'knownProcesses':checks,'cleanupAction':action,'resourcesReleased':released,'observationHooks':[]});r={'id':ident,'startedAt':at,'finishedAt':now(),'seconds':round(time.monotonic()-clock,3),'exitCode':code,'outerBudgetExpired':expired,'resourcesReleased':released};commands.append(r);return p,r
def collect(ident,file,pattern=None):
 argv=[electron,str(S/'node_modules/vitest/vitest.mjs'),'list',file,*common,'--json='+str(E/ident/'collection.json'),'--includeTaskLocation']
 if pattern:argv.extend(['-t',pattern])
 env=os.environ.copy();env['ELECTRON_RUN_AS_NODE']='1';p,r=execute(ident,argv,env);data=json.loads((p/'collection.json').read_text()) if (p/'collection.json').exists() else [];r.update({'kind':'collection-only','collectedInstances':len(data),'uniqueNames':len({x['name'] for x in data}),'testCallbacksExecuted':False,'status':'passed' if r['exitCode']==0 and not r['outerBudgetExpired'] and r['resourcesReleased'] and data else 'failed'});dump(p/'result.json',r);r['manifestSha256']=seal(p,'M11-S3-'+ident.upper());print(json.dumps({'event':'collected',**r}),flush=True);return data if r['status']=='passed' else []
def test(ident,file,collection,pattern=None):
 argv=[electron,str(S/'node_modules/vitest/vitest.mjs'),'run',file,*common,'--reporter=verbose','--reporter=json','--reporter='+str(E/'failure-detail-reporter.mjs'),'--outputFile.json='+str(E/ident/'vitest.json')]
 if pattern:argv.extend(['-t',pattern])
 env=os.environ.copy();env['ELECTRON_RUN_AS_NODE']='1';env['COREPACK_ENABLE_NETWORK']='0';env['WILLYOU_TEST_FAILURE_DETAILS']=str(E/ident/'failure-details.jsonl');p,r=execute(ident,argv,env);report=json.loads((p/'vitest.json').read_text()) if (p/'vitest.json').exists() else {};executed=[];filtered=[]
 for suite in report.get('testResults',[]):
  for a in suite.get('assertionResults',[]):
   x={'name':' > '.join([*a.get('ancestorTitles',[]),a.get('title','')]),'status':a.get('status'),'duration':a.get('duration'),'failureMessages':a.get('failureMessages',[])};(executed if a.get('status') in ('passed','failed') else filtered).append(x)
 expected=Counter(x['name'] for x in collection);actual=Counter(x['name'] for x in executed);missing=list((expected-actual).elements());unexpected=list((actual-expected).elements());bad=[];same=True;failed=[x for x in executed if x['status']=='failed'];passed=sum(x['status']=='passed' for x in executed);good=r['exitCode']==0 and not r['outerBudgetExpired'] and report.get('success') and not missing and not unexpected and not failed and not bad and same and r['resourcesReleased'];r.update({'kind':'test','sourceManifestSha256':PIN,'expectedCount':len(collection),'executedCount':len(executed),'passedCount':passed,'failedCount':len(failed),'filteredCount':len(filtered),'missingNames':missing,'unexpectedNames':unexpected,'executed':executed,'filteredNotCountedAsPassed':filtered,'inputVerification':'Full source/dependency validation only at sequence start and end; no per-group rescan','reportSuccess':report.get('success'),'suiteResults':[{'file':x.get('name'),'status':x.get('status'),'message':x.get('message')} for x in report.get('testResults',[])],'status':'passed' if good else 'incomplete-outer-budget' if r['outerBudgetExpired'] else 'failed','formalM11NewPassed':0});dump(p/'result.json',r);r['manifestSha256']=seal(p,'M11-S3-'+ident.upper());tests.append(r);print(json.dumps({'event':'test-finished',**{k:v for k,v in r.items() if k not in ['executed','filteredNotCountedAsPassed','suiteResults']}}),flush=True);return good

print(json.dumps({'event':'batch-ready','sourceFiles':len(rows),'sourceMismatches':[],'preflight':probe_data,'at':now()}),flush=True)
control=E/'STOP_AFTER_CURRENT'
dump(E/'control-policy.json',{'stopAfterCurrent':str(control),'behavior':'Checked before starting each next test group. Current group completes with original timeout and cleanup, then no later group starts.','environment':{'COREPACK_ENABLE_NETWORK':'0','ELECTRON_RUN_AS_NODE':'1'},'packageManager':'Direct existing Electron to existing Vitest; no Corepack invocation/download. Existing package cache remains unchanged.'})
collection=collect('mail-collection',MAIL)
stopped=False;groups=[];stopped_before=None
if collection:
 old=E.parent/'attempt-001';mapping=json.loads((old/'recovery-selection.json').read_text());old_names=Counter(x['name'] for x in mapping['tests']);new_names=Counter(x['name'] for x in collection);assert old_names==new_names
 greens=[x['name'] for x in mapping['tests'] if x['state']=='complete-passed'];carry=greens[:11];assert len(carry)==11 and carry[-1].endswith('confirms an existing codex intent in UI and executes only through its original run once')
 fragments=['uses a matched claude-code explicit fixed-revision instruction without a redundant UI confirmation','uses a matched codex explicit fixed-revision instruction without a redundant UI confirmation','authorizes an already frozen intent when the subsequent exact native user instruction arrives','migrates only the provable original prepare identity and leaves frozen sends unchanged on replay']
 u_green=[x['name'] for x in collection if any(x['name'].endswith(fragment) for fragment in fragments)];assert len(u_green)==4 and len(set(u_green))==4 and not(set(u_green)&set(carry))
 excluded=set(carry+u_green);remaining=[x for x in collection if x['name'] not in excluded];assert len(remaining)==96
 def js_escape(text):return re.sub(r'([.*+?^${}()|\[\]\\])',lambda m:'\\'+m.group(1),text)
 def selector(names):return r'(?:^| > | )(?:'+'|'.join(r'(?: > | )'.join(js_escape(p) for p in n.split(' > ')) for n in dict.fromkeys(names))+')$'
 original_groups=json.loads((old/'partitions.json').read_text())['groups']
 for original_group in original_groups:
  selected=[x for x in remaining if x['name'] in original_group['names']];assert selected
  groups.append({'id':original_group['id'],'title':original_group['title'],'count':len(selected),'names':[x['name'] for x in selected],'tests':selected,'pattern':selector([x['name'] for x in selected]),'outerSeconds':180,'individualThresholdsUnchanged':True})
 expected=Counter(x['name'] for x in remaining);assigned=Counter(x['name'] for g in groups for x in g['tests']);assert expected==assigned
 overlap=[name for name in expected if sum(name in g['names'] for g in groups)>1];assert not overlap
 validation_js="const fs=require('node:fs'),d=JSON.parse(fs.readFileSync(0,'utf8'));const checks=d.groups.map(g=>{const r=new RegExp(g.pattern),expected=[...g.names].sort(),normal=d.all.filter(n=>r.test(n)).sort(),space=d.all.filter(n=>r.test(n.replaceAll(' > ',' '))).sort();return{id:g.id,expected:expected.length,normal:normal.length,space:space.length,valid:JSON.stringify(expected)===JSON.stringify(normal)&&JSON.stringify(expected)===JSON.stringify(space)}});console.log(JSON.stringify({valid:checks.every(x=>x.valid),checks}));"
 v=subprocess.run(['node','-e',validation_js],input=json.dumps({'all':[x['name'] for x in collection],'groups':groups}),text=True,capture_output=True,timeout=10);validation=json.loads(v.stdout);assert v.returncode==0 and validation['valid']
 dump(E/'regex-validation.json',validation);dump(E/'exclusion-set.json',{'schema':'m11-s3-repair-exclusion-v1','oldAuthority':str(old/'recovery-selection.json'),'oldAuthoritySha256':sha(old/'recovery-selection.json'),'newSourceManifestSha256':PIN,'oldTotal':111,'newCollectionTotal':len(collection),'carriedUiHistoryNames':carry,'independentlyRecheckedNames':u_green,'independentDeliverySha256':'74374cf3c0f772502472e35a5ee85ab61c4ffaa3d48784bb04b8cb134fb079c3','excludedTotal':len(excluded),'remainingTotal':len(remaining),'nativeFormerGreensNotCarried':greens[11:],'formalM11NewPassed':0})
 dump(E/'partitions.json',{'schema':'m11-s3-mail-repair-split-v1','sourceManifestSha256':PIN,'collectedInstances':len(collection),'remainingInstances':len(remaining),'assignedInstances':sum(g['count'] for g in groups),'overlappingNames':overlap,'groups':groups,'basis':'Original thematic groups over authoritative actual names; exclude only11 verified UI/history greens and4 independent repaired-source greens. All14 remaining original complete greens are re-executed.'});print(json.dumps({'event':'groups-ready','instances':len(collection),'excluded':15,'remaining':96,'groups':[{'id':g['id'],'count':g['count']} for g in groups],'regexValid':True,'stopAfterCurrent':str(control)}),flush=True)
 for g in groups:
  if control.exists():
   stopped=True;stopped_before=g['id'];dump(E/'stop-receipt.json',{'at':now(),'stoppedBefore':g['id'],'sentinel':str(control),'reason':control.read_text(errors='replace')[:4096],'currentTestProcessRunning':False});break
  good=test(g['id'],MAIL,g['tests'],g['pattern'])
  if not tests[-1]['resourcesReleased']:break
else:dump(E/'collection-gate.json',{'status':'not-executed','reason':'Actual full-file collection failed; no test group started.'})
after_bad=bad_source();after_deps=dependencies();dump(E/'inputs-after.json',{'at':now(),'sourceManifestSha256':PIN,'sourceFiles':len(rows),'sourceMismatches':after_bad,'dependencies':after_deps,'dependenciesUnchanged':after_deps==baseline,'sharedOutRebuilt':False})
summaries=[{k:v for k,v in x.items() if k not in ['executed','filteredNotCountedAsPassed','suiteResults']} for x in commands];result={'schema':'m11-s3-composition-result-v1','startedAt':started,'finishedAt':now(),'status':'stopped-after-current' if stopped else 'passed' if len(tests)==4 and all(x['status']=='passed' for x in tests) and not after_bad and after_deps==baseline else 'needs-follow-up','source':str(S),'sourceManifestSha256':PIN,'sourceFiles':len(rows),'sourceMismatches':after_bad,'dependenciesUnchanged':after_deps==baseline,'commands':summaries,'testsExecuted':sum(x['executedCount'] for x in tests),'testsPassed':sum(x['passedCount'] for x in tests),'testsFailed':sum(x['failedCount'] for x in tests),'stoppedAfterCurrent':stopped,'stoppedBefore':stopped_before,'unstartedGroups':[{'id':g['id'],'count':g['count'],'names':g['names']} for g in groups if g['id'] not in {x['id'] for x in tests}],'formalM11NewPassed':0,'formalM11Total':38,'boundary':'Only96 remaining original mail-send instances on repaired source003;11 verified UI/history and4 independently verified repairs excluded. Synthetic fixtures only, no real model/service/GUI/shared build. Formal M11 unchanged.'};dump(E/'result.json',result);released=all(x['resourcesReleased'] for x in commands);dump(E/'cleanup.json',{'at':now(),'commands':[{'id':x['id'],'resourcesReleased':x['resourcesReleased']} for x in commands],'resourcesReleased':released,'preflightRootRemoved':probe_data['createdRootRemoved'],'observationHooks':[],'privateCacheRetained':str(cache),'sharedOutModifiedByDriver':False});pin=seal(E,'M11-S3-COMPOSITION');print(json.dumps({'event':'batch-finished','status':result['status'],'testsExecuted':result['testsExecuted'],'testsPassed':result['testsPassed'],'testsFailed':result['testsFailed'],'sourceMismatches':after_bad,'dependenciesUnchanged':result['dependenciesUnchanged'],'resourcesReleased':released,'manifestSha256':pin}),flush=True)
