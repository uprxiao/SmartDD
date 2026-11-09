from pathlib import Path
import json,hashlib,shutil,copy,datetime,re
S=Path('/private/tmp/willyou-m12-system-shortcuts-App036-safe-batch-001');assert not S.exists();S.mkdir(mode=0o700);h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();refs=[];inputIndex=[];rawStats=[]
def put(n,v):
 p=S/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def cp(p,n):
 p=Path(p);q=S/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'safeCopy':n})
def ref(p,purpose):
 p=Path(p);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'purpose':purpose})
for attempt in ['001','002']:
 R=Path('/private/tmp')/('willyou-m12-system-shortcuts-App036-'+attempt);dest='attempt-'+attempt;r=json.loads((R/'raw.json').read_text());cl=json.loads((R/'cleanup.json').read_text());ready=json.loads((R/'ready.json').read_text());assert cl['allClear'] and r['appExit']['code']==0 and r['appExit']['signal'] is None and r['observedProcess']['signals']==[]
 safe=copy.deepcopy(r);task=r['taskAfter'];safe['taskAfter']={k:task[k] for k in ['id','projectId','projectName','dirId','cwd','aiProfileId','aiProfileName','runner','nativeSessionId','title','archivedAt','createdAt','updatedAt','lastLaunchedAt','ptyId','recovery','recoveryReason'] if k in task};safe['taskAfterIdentity']={'runId':task.get('runtimeSnapshot',{}).get('runId'),'runtimeSnapshotOmitted':True,'configAndEnvironmentOmitted':True};safe.pop('knownPorts',None);safe.pop('exactGatewayPaths',None);safe['resources']=[{k:v[k] for k in ['at','processes','helpers'] if k in v} for v in r['resources']]
 site=r['site'];host=site.removeprefix('http://')
 def scrub(v):
  if isinstance(v,dict):return {k:scrub(x) for k,x in v.items() if k not in ['runtimeSnapshot','injectedEnvNames','env','environment','runtimeConfig','secrets','token','transport','webSocketDebuggerUrl']}
  if isinstance(v,list):return [scrub(x) for x in v]
  if isinstance(v,str):return v.replace(site,'synthetic-site://owned').replace(host,'owned-fixture-host')
  return v
 safe=scrub(safe);safe['safeProjection']={'originalRawSHA256':h(R/'raw.json'),'removed':'TaskAfter runtimeSnapshot/config/env/firstMessage, operational socket/port/listener metadata. Synthetic page /a,/b navigation identities kept through a stable synthetic-site://owned alias.','knownEndpointCounts':{'tcp':len(r['knownPorts']),'unix':len(r['exactGatewayPaths'])},'originalPhysicalEventCount':len(r['physicalEvents']['events']),'noActualScreenshotClaim':True};put(dest+'/raw.safe.json',safe);ref(R/'raw.json','Original raw unchanged, whole-file SHA only; scrubbed safe evidence copy')
 put(dest+'/cleanup.safe.json',{'at':cl['at'],'scope':cl['scope'],'allClear':True,'processes':cl['processes'],'tcpChecks':[{'ordinal':n+1,**{k:v.get(k) for k in ['status','error','signal','absent']}} for n,v in enumerate(cl['ports'])],'unixChecks':[{'ordinal':n+1,'socket':{k:v['socket'].get(k) for k in ['absent','error']},'parent':{k:v['parent'].get(k) for k in ['absent','error']}} for n,v in enumerate(cl['unix'])],'helpers':cl['helpers'],'originalNormalExit':cl['originalNormalExit'],'originalHarness':cl['originalHarness'],'systemGeneralWasAttempted':cl['systemGeneralWasAttempted'],'boundary':'Process/resource cleanup separate from human-key business; no clipboard operation claimed.'});ref(R/'cleanup.json','Exact raw process/endpoint cleanup original private, hash-only')
 for n in ['ready.json','static.json','pin.json','lease.receipt.json','contract.json','execution-started.json']:
  p=R/n
  if p.exists():cp(p,dest+'/actual/'+n)
 if (R/'judgement.json').exists():cp(R/'judgement.json',dest+'/actual/judgement.json')
 # Deduplicate immutable local source bytes across both attempts; external trees/binaries hash only.
 for f in ready['inputs']:
  p=Path(f['path']);assert h(p)==f['sha256'],str(p);assert p.stat().st_mode&511==f['mode'];local=p.is_relative_to(R);allowed=p.suffix in ['.mjs','.py','.ts','.tsx','.json','.jxa','.applescript','.md','.txt'];excluded=any(x in p.parts for x in ['node_modules','runtime-001','userdata','home','cache','clipboard-control-001']) or '.private.' in p.name
  row={'attempt':attempt,'originalPath':str(p),'sha256':f['sha256'],'mode':f['mode']}
  if local and allowed and not excluded:
   name='inputs/by-sha/'+f['sha256']+p.suffix;row['safeStoredPath']=name
   if not (S/name).exists():cp(p,name)
  else:row['hashReferenceOnly']=True
  inputIndex.append(row)
 for n in ['run.mjs','static.mjs','cleanup.mjs','judge.py','freeze.py','initial-foreground-authorization.receipt.json','activate-initial-exact-pid.applescript']:
  p=R/n
  if p.exists() and not any(v['attempt']==attempt and v['originalPath']==str(p) for v in inputIndex):
   name='inputs/by-sha/'+h(p)+p.suffix
   if not (S/name).exists():cp(p,name)
   inputIndex.append({'attempt':attempt,'originalPath':str(p),'sha256':h(p),'mode':p.stat().st_mode&511,'safeStoredPath':name,'additionalActualRecoverableInput':True})
 physical=len(r['physicalEvents']['events']);matched=len(r['checks']);stat={'attempt':attempt,'status':r['status'],'actualPhysicalEventsRecorded':physical,'matchedOriginalBusinessObservations':matched,'startedAt':r['startedAt'],'finishedAt':r['finishedAt'],'elapsedSeconds':(datetime.datetime.fromisoformat(r['finishedAt'].replace('Z','+00:00'))-datetime.datetime.fromisoformat(r['startedAt'].replace('Z','+00:00'))).total_seconds(),'normalAppExit':r['appExit'],'signals':r['observedProcess']['signals'],'cleanup':{'allClear':True,'pids':len(cl['processes']),'tcp':len(cl['ports']),'unix':len(cl['unix'])},'screenshotsCapturedByOriginalBatch':0,'formalIncrement':0}
 if attempt=='001':stat.update(classification='No-key/deferred original red, not a product shortcut failure',failure=r['failure'],feedbackBoundary='Coordinator relayed user report that prompt appeared late; preserved as user feedback, not a proven timeout cause or product defect.',casePassClaim=False);assert physical==matched==0
 else:
  judge=json.loads((R/'judgement.json').read_text());assert judge['passed'] and len(judge['tests'])==10 and matched==10
  stat.update(classification='Actual human first batch green; original10/10 judge preserved',judgePassed=True,originalCriteria=judge['tests'],caseDecisions={'T009':'Full original A+S accepted by Root raw/source review','T133':'Full original S accepted by Root unchanged pre-M12 menu/window baseline review','T024':'Partial only: headerA and physical historicalT0/terminal/project complete; PPTX branch pending at this actualbatch endpoint'},eventCountBoundary='Raw records12 events, including two extra page-origin CmdR in phase10; original10 business observations reference10 distinct events. Do not truncate raw events or relabel12 as10.',testedShortcutSynthesis='Independent original judge verifies driver synthesized none of tested R/W/T/F/B shortcuts.',actualTool='session12933 -> e81163',independentCleanup='261ad6')
 put(dest+'/result.safe.json',stat);rawStats.append(stat)
# Source baseline evidence from frozen source040 only, never moving production.
source=Path('/private/tmp/willyou-m12-title-viewer-source-040/source');srcs=[]
for name in ['src/main/app/menu.ts','src/main/app/window.ts']:
 p=source/name
 if p.is_file():cp(p,'baseline/'+p.name);srcs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size})
put('baseline/source-boundary.json',{'sourceFiles':srcs,'baselineManifest':{'path':'/private/tmp/willyou-m12-title-viewer-source-040/source-inputs.json','sha256':h(source.parent/'source-inputs.json')},'RootReview':'Coordinator reports menu.ts unchanged pre-M12 baseline (4a15a950 prefix); window.ts preserves macOSclose-hide and runningPTY semantics. Here only frozen source bytes/hash are recorded, not a new runtime test.','scopeBoundary':'App main close hide and PTY continuity remain distinct from final normal App process exit. T024 PPTX not included here.'})
put('inputs/index.json',{'files':inputIndex,'deduplication':'All copied local input code stored by actual whole-file SHA once across two attempts; paths in originalready preserved for reconstruction. Large dependencies/binaries hash references only.','staleReadyScopeMetadata':'Original ready.schema/scope inherits earlier subset/preparation text (e.g.noSystemkeys/T0); bytes retained unchanged. Actual dedicated human driver/raw/contract/judge and Root scope acceptance define what executed; not an edit of historical metadata.'})
cp(Path(__file__),'project-system-safe.py')
put('result.safe.json',{'group':'Actual human system shortcuts App036','attempts':rawStats,'wholeT024Passed':False,'formalIncrementByProjector':0,'resourceUseByProjector':0,'ledgerBoundary':'Root alone archives/accounts current original121; do not count matched key observations as cases.','physicalBoundary':'Only recorded actual before-input human events and original business effects; setup pointer/text inputs separately preserved; no tested shortcut synthesis.'})
put('provenance.json',{'schema':'M12-safe-projection-v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'safeRoot':str(S),'operation':'Pure Python filesystem copy/hash/JSONprojection only. No Node/Native/App/OS/systemkeys/clipboard calls or docs/ledger changes.','originalWholeFiles':refs,'originalsModified':False,'exclusions':['App/binaries','userData/home/DB/auth','private logs','original TaskAfter runtimeSnapshot/config/env','exact socket/port/listener metadata','clipboard','large dependency trees'],'resourcesHeld':False,'currentOtherRootNativeScope':'Parent independently owns separate PPTX actual; no observation or read of that running group.'})
# No actual broker socket names or synthetic service port metadata in projected raw/cleanup.
for attempt in ['001','002']:
 r=json.loads((Path('/private/tmp')/('willyou-m12-system-shortcuts-App036-'+attempt)/'raw.json').read_text())
 for n in ['raw.safe.json','cleanup.safe.json']:
  text=(S/('attempt-'+attempt)/n).read_text();assert not any(v in text for v in r['exactGatewayPaths']);assert r['site'] not in text
members=[{'path':str(p.relative_to(S)),'sha256':h(p),'bytes':p.stat().st_size,'mode':p.stat().st_mode&511} for p in sorted(S.rglob('*')) if p.is_file()];put('manifest.json',{'schema':'M12-safe-manifest-v1','safeRoot':str(S),'members':members,'scope':'Original001no-keyred + actual00210matched human business observations; T009A+S/T133S acceptedRoot, T024partial only','wholeT024Passed':False,'formalIncrement':0})
for f in members:assert h(S/f['path'])==f['sha256']
print(json.dumps({'safeRoot':str(S),'attemptRoots':[str(S/'attempt-001'),str(S/'attempt-002')],'manifestSHA256':h(S/'manifest.json'),'provenanceSHA256':h(S/'provenance.json'),'resultSHA256':h(S/'result.safe.json'),'files':len(members),'resources':0}))
