from pathlib import Path
import json,hashlib,shutil,copy,datetime
S=Path('/private/tmp/willyou-m12-t146-App037-A-safe-batch-001');assert not S.exists();S.mkdir(mode=0o700)
h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();refs=[];idx=[];results=[]
def put(n,v):
 p=S/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def cp(p,n):
 p=Path(p);q=S/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'safeCopy':n})
def ref(p,why):
 p=Path(p);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'purpose':why})
for a in ['A001','A002','A003']:
 R=Path('/private/tmp/willyou-m12-t146-App037-'+a);ready=json.loads((R/'ready.json').read_text())
 for n in ['ready.json','static.json','pin.json','lease.receipt.json','contract.json','initial-foreground-authorization.receipt.json','adjudication.json']:
  if (R/n).is_file():cp(R/n,a+'/actual/'+n)
 for f in ready['inputs']:
  p=Path(f['path']);assert h(p)==f['sha256'],str(p);assert p.stat().st_mode&511==f['mode'];row={'attempt':a,'originalPath':str(p),'sha256':f['sha256'],'mode':f['mode']}
  allowed=p.is_relative_to(R) and p.suffix in ['.mjs','.py','.json','.jxa','.applescript','.md','.txt','.ts','.tsx'] and not any(x in p.parts for x in ['runtime-001','cache','node_modules','home','userdata']) and '.private.' not in p.name
  if allowed:
   n='inputs/by-sha/'+h(p)+p.suffix;row['safeStoredPath']=n
   if not (S/n).exists():cp(p,n)
  else:row['hashReferenceOnly']=True
  idx.append(row)
 for n in ['run.mjs','cleanup.mjs','judge.py','long-fixture.mjs']:
  p=R/n
  if p.is_file() and not any(v['attempt']==a and v['originalPath']==str(p) for v in idx):
   n='inputs/by-sha/'+h(p)+p.suffix
   if not (S/n).exists():cp(p,n)
   idx.append({'attempt':a,'originalPath':str(p),'sha256':h(p),'mode':p.stat().st_mode&511,'safeStoredPath':n})
 if a=='A001':
  pre=json.loads((R/'pre-app-failure.json').read_text());assert not pre['appLaunched'] and not pre['listenerStarted'] and not (R/'raw.json').exists();assert h(R/'driver.stdout.private.log')==pre['originalLogSHA256'];cp(R/'pre-app-failure.json',a+'/actual/pre-app-failure.json');cp(R/'driver.stdout.private.log',a+'/actual/pre-app-error.original.log')
  stat={'attempt':a,'classification':'Local listen EPERM before App/listener; precondition red, no App criterion executed','preAppFailure':pre,'actualAppLaunched':False,'actualListenerStarted':False,'businessChecks':0,'preAppLogBoundary':'Explicit pre-App Node error only; not full Electron/private App log.','formalIncrement':0};put(a+'/result.safe.json',stat);results.append(stat);continue
 r=json.loads((R/'raw.json').read_text());cl=json.loads((R/'cleanup.json').read_text());assert cl['allClear'] and r['appExit']['code']==0 and r['appExit']['signal'] is None and r['observedProcess']['signals']==[]
 safe=copy.deepcopy(r);safe.pop('knownPorts',None);safe.pop('exactGatewayPaths',None);safe['resources']=[{'at':v.get('at'),'processes':v.get('processes',[]),'helperCount':len(v.get('helpers',[]))} for v in r['resources']];t=r['taskAfter'];safe['taskAfter']={k:t[k] for k in ['id','projectId','projectName','dirId','cwd','aiProfileId','aiProfileName','runner','nativeSessionId','title','archivedAt','ptyId','recovery','recoveryReason'] if k in t};safe['taskAfterIdentity']={'runId':t.get('runtimeSnapshot',{}).get('runId'),'runtimeSnapshotConfigEnvironmentOmitted':True}
 def scrub(v):
  if isinstance(v,dict):return {k:scrub(x) for k,x in v.items() if k not in ['runtimeSnapshot','injectedEnvNames','env','environment','runtimeConfig','config','secrets','transport','webSocketDebuggerUrl']}
  if isinstance(v,list):return [scrub(x) for x in v]
  return v
 safe=scrub(safe);safe['safeProjection']={'originalRawSHA256':h(R/'raw.json'),'endpointCounts':{'tcp':len(r['knownPorts']),'unix':len(r['exactGatewayPaths'])},'kept':'Own synthetic closedlocalhost URL/port, complete title/address lengths, readonly Nativeownership arrays and geometry unchanged; no auth/daily identity.','tooltipTechnology':'Actual packaged App controlled DOM popup with real owner-scoped Nativepage park/restore; not positive OS-native title-tooltip.'};put(a+'/raw.safe.json',safe);ref(R/'raw.json','Original raw whole-file SHA; safe runtimeConfig/operationalEndpoint projection')
 put(a+'/cleanup.safe.json',{'at':cl['at'],'scope':cl['scope'],'allClear':True,'processes':cl['processes'],'tcpChecks':[{'ordinal':i+1,**{k:v.get(k) for k in ['status','error','signal','absent']}} for i,v in enumerate(cl['ports'])],'unixChecks':[{'ordinal':i+1,'socket':{k:v['socket'].get(k) for k in ['absent','error']},'parent':{k:v['parent'].get(k) for k in ['absent','error']}} for i,v in enumerate(cl['unix'])],'helpers':[{'ordinal':i+1,**{k:v[k] for k in ['clear','remainingRuntimeFiles'] if k in v}} for i,v in enumerate(cl['helpers'])],'originalNormalExit':cl['originalNormalExit'],'originalHarness':cl['originalHarness'],'GeneralAccessed':False});ref(R/'cleanup.json','Full exact endpoint cleanup private original SHA only')
 if (R/'driver.stdout.private.log').is_file():ref(R/'driver.stdout.private.log','Private driver stdout SHA only; not copied for App attempts')
 for image in r['screenshots']:
  n=image['name'] if isinstance(image,dict) else image;p=R/'runtime-001'/n
  if isinstance(image,dict) and 'sha256' in image:assert h(p)==image['sha256']
  cp(p,a+'/screenshots/'+n)
 stat={'attempt':a,'status':r['status'],'startedAt':r['startedAt'],'finishedAt':r['finishedAt'],'checks':r['checks'],'normalAppExit':r['appExit'],'signals':r['observedProcess']['signals'],'observerRemoved':r['humanObserverRemoved'],'fixtureClosed':r['fixtureServerClosed'],'cleanup':{'allClear':True,'pids':len(cl['processes']),'tcp':len(cl['ports']),'unix':len(cl['unix']),'helpers':len(cl['helpers'])},'screenshotRecords':r['screenshots'],'nativeOSTooltipPassClaimed':False,'formalIncrement':0}
 if a=='A002':
  assert not r['actions'] and not r['checks'];stat.update(classification='Helper old privateRoot assertion before firstactivation, no real UI business; original red retained',failure=r['failure'])
 else:
  adj=json.loads((R/'adjudication.json').read_text());assert adj['passed'] and len(adj['checks'])==9 and adj['rawSHA256']==h(R/'raw.json');assert not r['focusGuard'].get('yieldedAt');stat.update(classification='Actual App037 controlled fulltitle DOM popup + Nativepage park/restore green; Root9/9',adjudication=adj,originalAThreeCriteriaPassed=True,NativeOwnershipArraysRetained=['beforeHover','duringTooltip','afterTooltip','duringMenu','afterMenu'],URLUTF16Length=len(r['url'].encode('utf-16-le'))//2,guardCheckedInputs=r['focusGuard']['checkedInputs'],screenshotReview='Root independently viewed actual tooltip and menu PNGs. Original screenshotbytes retained; no full visual-parity or nativeOS tooltip claim.')
 put(a+'/result.safe.json',stat);results.append(stat)
 for n in ['raw.safe.json','cleanup.safe.json']:assert not any(x in (S/a/n).read_text() for x in r['exactGatewayPaths'])
put('inputs/index.json',{'files':idx,'deduplication':'Exact local input code/generator/labelgraph through originalready stored by wholeSHA once; external source/package/dependency hash-only.','staticBoundary':'A001 standalone static.json available; A002/A003 have no separate static.json. Currentreadies/graphs plus actualadjudication retained, no static receipt fabricated.','authScope':'Existing initial exactPID user authorization scope and lease only, no auth/login values.'})
cp(Path(__file__),'project-App037-safe.py');put('result.safe.json',{'case':'M12-T146','attempts':results,'originalAThreeCriteriaGreenInA003':True,'RootIndependentAdjudication':'9/9 original A behavioural checks passed','nativeOSTooltipPassClaimed':False,'wholeCaseAccounting':'Root reviews/accounts original contract; projector makes no publicledger changes.','formalIncrement':0,'resourcesHeldByProjector':False,'prior036Negative':'/private/tmp/willyou-m12-t146-App036-human-safe-batch-001','softwareProjectionUnmodified':'/private/tmp/willyou-m12-t146-tooltip-software-App037-build-safe-001'})
put('provenance.json',{'schema':'M12-safe-projection-v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'safeRoot':str(S),'operation':'Pure Python FS/hash/projection only; no Node/OS/App/Native/compiler/clipboard/source search or publicdocuments changes.','originalWholeFiles':refs,'originalsModified':False,'excluded':['App/binaries/cache','DB/userData/home/auth/clipboard','Private full Electronlogs','TaskAfter runtimeSnapshot/config/env','Sensitive exact operational endpoints'],'allowedSynthetic':'Own closedlocalhost URL/ports and nativeownership/geometry retained, original3screenshots unchanged.','scope':'ActualcontrolledDOM popup/nativepageparking A003, never OS native tooltip success.'})
members=[{'path':str(p.relative_to(S)),'sha256':h(p),'bytes':p.stat().st_size,'mode':p.stat().st_mode&511} for p in sorted(S.rglob('*')) if p.is_file()];put('manifest.json',{'schema':'M12-safe-manifest-v1','safeRoot':str(S),'members':members,'nativeOSTooltipPassClaimed':False,'formalIncrement':0})
for f in members:assert h(S/f['path'])==f['sha256']
print(json.dumps({'safeRoot':str(S),'manifestSHA256':h(S/'manifest.json'),'provenanceSHA256':h(S/'provenance.json'),'resultSHA256':h(S/'result.safe.json'),'files':len(members),'resources':0}))
