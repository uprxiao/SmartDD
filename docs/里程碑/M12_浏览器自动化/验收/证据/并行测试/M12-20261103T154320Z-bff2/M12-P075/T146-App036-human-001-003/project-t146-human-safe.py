from pathlib import Path
import json,hashlib,shutil,copy,datetime,re
S=Path('/private/tmp/willyou-m12-t146-App036-human-safe-batch-001');assert not S.exists();S.mkdir(mode=0o700);h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();refs=[];inputs=[];summaries=[]
def put(n,v):
 p=S/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def cp(p,n):
 p=Path(p);q=S/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'safeCopy':n})
def ref(p,why):
 p=Path(p);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'purpose':why})
for attempt in ['001','002','003']:
 R=Path('/private/tmp/willyou-m12-t146-App036-human-'+attempt);d='attempt-'+attempt;ready=json.loads((R/'ready.json').read_text())
 for n in ['ready.json','static.json','pin.json','lease.receipt.json','contract.json','pre-app-failure.json']:
  if (R/n).is_file():cp(R/n,d+'/actual/'+n)
 for f in ready['inputs']:
  p=Path(f['path']);assert h(p)==f['sha256'],str(p);assert p.stat().st_mode&511==f['mode'];row={'attempt':attempt,'originalPath':str(p),'sha256':f['sha256'],'mode':f['mode']};local=p.is_relative_to(R);eligible=p.suffix in ['.mjs','.py','.json','.jxa','.applescript','.md','.ts','.tsx','.txt','.part'] and not any(x in p.parts for x in ['runtime-001','node_modules','home','userdata','cache']) and '.private.' not in p.name
  if local and eligible:
   n='inputs/by-sha/'+f['sha256']+p.suffix;row['safeStoredPath']=n
   if not (S/n).exists():cp(p,n)
  else:row['hashReferenceOnly']=True
  inputs.append(row)
 for n in ['run.mjs','static.mjs','cleanup.mjs','freeze.py','long-fixture.mjs','flow.part']:
  p=R/n
  if p.is_file() and not any(v['attempt']==attempt and v['originalPath']==str(p) for v in inputs):
   n='inputs/by-sha/'+h(p)+p.suffix
   if not (S/n).exists():cp(p,n)
   inputs.append({'attempt':attempt,'originalPath':str(p),'sha256':h(p),'mode':p.stat().st_mode&511,'safeStoredPath':n})
 if attempt=='001':
  assert not (R/'raw.json').exists();pf=json.loads((R/'pre-app-failure.json').read_text());summaries.append({'attempt':attempt,'classification':'Pre-App constructor nonce error, no App/listen or business evidence','preAppFailure':pf,'rawExists':False,'actualAppOrListenerStarted':False,'originalCurrentSourceRetained':{'path':str(R/'run.mjs'),'sha256':h(R/'run.mjs')},'exactOriginalNodeLogSaved':False,'notReconstructed':True,'tooltipPassed':False,'wholeT146Passed':False});continue
 r=json.loads((R/'raw.json').read_text());cl=json.loads((R/'cleanup.json').read_text());assert cl['allClear'] and r['appExit']['code']==0 and r['appExit']['signal'] is None and r['observedProcess']['signals']==[]
 safe=copy.deepcopy(r);safe.pop('knownPorts',None);safe.pop('exactGatewayPaths',None);safe['resources']=[{'at':v.get('at'),'processes':v.get('processes',[]),'helperCount':len(v.get('helpers',[]))} for v in r['resources']];t=r['taskAfter'];safe['taskAfter']={k:t[k] for k in ['id','projectId','projectName','dirId','cwd','aiProfileId','aiProfileName','runner','nativeSessionId','title','archivedAt','ptyId','recovery','recoveryReason'] if k in t};safe['taskAfterIdentity']={'runId':t.get('runtimeSnapshot',{}).get('runId'),'runtimeSnapshotConfigEnvironmentOmitted':True}
 port=re.match(r'http://127\.0\.0\.1:(\d+)',r['url']).group(1);alias='P'*len(port)
 def sanitize(v):
  if isinstance(v,dict):return {k:sanitize(x) for k,x in v.items() if k not in ['runtimeSnapshot','injectedEnvNames','env','environment','runtimeConfig','config','secrets','transport','webSocketDebuggerUrl']}
  if isinstance(v,list):return [sanitize(x) for x in v]
  if isinstance(v,str):return v.replace('127.0.0.1:'+port,'127.0.0.1:'+alias)
  return v
 safe=sanitize(safe);safe['safeProjection']={'originalRawSHA256':h(R/'raw.json'),'titleAttributeIsNotTooltipVisiblePass':True,'endpointCounts':{'tcp':len(r['knownPorts']),'unix':len(r['exactGatewayPaths'])},'urlPortRedaction':'Only live port digits replaced by equal-length P characters; original fullURL/title UTF16length and all original geometry/address numeric evidence retained. User-supplied original image is explicit exception showing now-closed own synthetic no-auth localhost fixture.','originalURLUTF16Length':len(r['url'].encode('utf-16-le'))//2,'originalTitleAttributeUTF16Length':len(r['titleGeometry']['title'].encode('utf-16-le'))//2};put(d+'/raw.safe.json',safe);ref(R/'raw.json','Original raw whole-file SHA; private TaskAfter runtime config and exact endpoint removed in safe copy')
 helpers=[{'ordinal':n+1,**{k:v[k] for k in ['clear','remainingRuntimeFiles'] if k in v}} for n,v in enumerate(cl['helpers'])]
 put(d+'/cleanup.safe.json',{'at':cl['at'],'scope':cl['scope'],'allClear':cl['allClear'],'processes':cl['processes'],'tcpChecks':[{'ordinal':n+1,**{k:v.get(k) for k in ['status','error','signal','absent']}} for n,v in enumerate(cl['ports'])],'unixChecks':[{'ordinal':n+1,'socket':{k:v['socket'].get(k) for k in ['absent','error']},'parent':{k:v['parent'].get(k) for k in ['absent','error']}} for n,v in enumerate(cl['unix'])],'helpers':helpers,'originalNormalExit':cl['originalNormalExit'],'originalHarness':cl['originalHarness'],'GeneralAccessed':False});ref(R/'cleanup.json','Private full exact endpoint cleanup whole-file SHA, safe outcomes')
 for image in r['screenshots']:
  name=image['name'] if isinstance(image,dict) else image;p=R/'runtime-001'/name
  if isinstance(image,dict) and 'sha256' in image:assert h(p)==image['sha256']
  cp(p,d+'/screenshots/'+name)
 stat={'attempt':attempt,'actualACompleteChecks':r['checks'],'checkCount':len(r['checks']),'status':r['status'],'titleGeometryAndAddressA':'Retained original measurements/selection/text/title; not proof of native tooltip visibility','trustedHoverEvents':len(r['hoverEvents']),'nativeTooltipImageCaptured':r['nativeTooltipImageCaptured'],'normalAppExit':r['appExit'],'signals':r['observedProcess']['signals'],'humanObserverRemoved':r['humanObserverRemoved'],'fixtureServerClosed':r['fixtureServerClosed'],'cleanup':{'allClear':True,'pids':len(cl['processes']),'tcp':len(cl['ports']),'unix':len(cl['unix']),'helpers':len(cl['helpers'])},'wholeT146Passed':False,'formalIncrement':0}
 if attempt=='002':stat.update(classification='Actual A title/address two checks; tooltip human observation not obtained (userforgot), unknown/no pass',tooltipPassed=False,userObservationPending=True,cleanupTool='4eb157')
 else:
  human=json.loads((R/'human-observation.response.json').read_text());assert human['completeTitleTooltipVisible'] is False;assert human['firstReply']=='没有出现提示框';p=R/'user-provided-no-tooltip.png';assert h(p)==human['imageSHA256'];cp(p,d+'/user-image/user-provided-no-tooltip.png');cp(R/'human-observation.response.json',d+'/actual/human-observation.response.json');stat.update(classification='Required tooltip actual observation negative; candidate issue, no proved product root cause',actualTool='93527 -> 9e09b5',cleanupTool='b5c570',actualHover=sanitize(r['actualHover']),humanReply=human['firstReply'],userImageSHA256=h(p),tooltipPassed=False,userObservationPending=False,lateForegroundBoundary='User response includes later WeChat sample; not proof of foreground at actual hover. No intent/causality inference.',nativePositiveImageClaim=False)
 summaries.append(stat);put(d+'/result.safe.json',stat)
put('attempt-001/result.safe.json',summaries[0]);put('inputs/index.json',{'files':inputs,'deduplication':'Local original driver/constructor/fixture inputs stored by SHA once; external dependencies/binaries/source manifests hash-only.','history':'Original constructor nonce preApp failure report copied exactly; missing exact original001 Node logs/full old source not fabricated/reconstructed.'})
cp(Path(__file__),'project-t146-human-safe.py');put('result.safe.json',{'case':'M12-T146','attempts':summaries,'wholeT146Passed':False,'tooltipPassed':False,'formalIncrement':0,'resourcesHeldByProjector':False,'scope':'Title/address A evidence retained; native tooltip visibility unproved in002 and explicitly negative in003. No product root cause assertion or native-positive screenshot claim.'})
put('provenance.json',{'schema':'M12-safe-projection-v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'safeRoot':str(S),'operation':'Pure Python file copy/hash/projection only; no Node/Native/App/OS/clipboard or additional diagnosis/source search; no docs/ledger edit.','originalWholeFiles':refs,'originalsModified':False,'excluded':['App/binaries','runtime userData/home/DB/auth/privateclipboard','all private logs','TaskAfter runtimeSnapshot/config/env','exact operational endpoint metadata','large dependencies'],'userImage':'Explicitly user-supplied original crop copied byte-for-byte; own now-closed syntheticlocalhost/noauth, no newcapture. This exception preserves its visible synthetic URL.','titleBoundary':'A complete title DOMproperty and trusted hover are evidence of setup/input, never a positive tooltip visibility result.','resourcesHeld':False})
for attempt in ['002','003']:
 r=json.loads((Path('/private/tmp/willyou-m12-t146-App036-human-'+attempt)/'raw.json').read_text())
 for n in ['raw.safe.json','cleanup.safe.json']:
  text=(S/('attempt-'+attempt)/n).read_text();assert not any(v in text for v in r['exactGatewayPaths'])
members=[{'path':str(p.relative_to(S)),'sha256':h(p),'bytes':p.stat().st_size,'mode':p.stat().st_mode&511} for p in sorted(S.rglob('*')) if p.is_file()];put('manifest.json',{'schema':'M12-safe-manifest-v1','safeRoot':str(S),'members':members,'wholeT146Passed':False,'tooltipPassed':False,'formalIncrement':0})
for f in members:assert h(S/f['path'])==f['sha256']
print(json.dumps({'safeRoot':str(S),'manifestSHA256':h(S/'manifest.json'),'provenanceSHA256':h(S/'provenance.json'),'resultSHA256':h(S/'result.safe.json'),'files':len(members),'resources':0}))
