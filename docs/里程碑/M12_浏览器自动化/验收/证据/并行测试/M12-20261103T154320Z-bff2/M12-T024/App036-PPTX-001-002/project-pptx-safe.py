from pathlib import Path
import json,hashlib,copy,shutil,datetime
S=Path('/private/tmp/willyou-m12-t024-pptx-App036-safe-batch-001');assert not S.exists();S.mkdir(mode=0o700);h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();refs=[];inputIndex=[];stats=[]
def put(n,v):
 p=S/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def cp(p,n):
 p=Path(p);q=S/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'safeCopy':n})
def ref(p,purpose):
 p=Path(p);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'purpose':purpose})
for attempt in ['001','002']:
 R=Path('/private/tmp/willyou-m12-t024-pptx-App036-'+attempt);dest='attempt-'+attempt;r=json.loads((R/'raw.json').read_text());cl=json.loads((R/'cleanup.json').read_text());ready=json.loads((R/'ready.json').read_text());assert cl['allClear'] and r['appExit']['code']==0 and r['appExit']['signal'] is None and r['observedProcess']['signals']==[]
 values=set()
 for row in r['fileTrace']:
  for arg in row.get('args',[]):
   if isinstance(arg,dict):
    for k in ['id','draftId','opId','recoveryId','sessionId','lease']:
     if isinstance(arg.get(k),str):values.add(arg[k])
    rr=arg.get('ref',{})
    if isinstance(rr,dict):
     for k in ['id','lease']:
      if isinstance(rr.get(k),str):values.add(rr[k])
  out=row.get('output')
  if isinstance(out,dict):
   if row['method']=='openPptx' and isinstance(out.get('id'),str):values.add(out['id'])
   for part in ['receipt','checkpoint']:
    if isinstance(out.get(part),dict):
     for k in ['draftId','opId','recoveryId']:
      if isinstance(out[part].get(k),str):values.add(out[part][k])
 aliases={v:'authority-sha256:'+hashlib.sha256(b'T024-PPTX-safe-authority\0'+v.encode()).hexdigest() for v in values}
 def redact(v):
  if isinstance(v,dict):return {k:redact(x) for k,x in v.items() if k not in ['runtimeSnapshot','injectedEnvNames','env','environment','runtimeConfig','config','secrets','transport','webSocketDebuggerUrl']}
  if isinstance(v,list):return [redact(x) for x in v]
  if isinstance(v,str):return aliases.get(v,v)
  return v
 safe=copy.deepcopy(r);safe.pop('exactGatewayPaths',None);safe.pop('knownPorts',None);safe['resources']=[{k:v[k] for k in ['at','processes','helpers'] if k in v} for v in r['resources']];task=r['taskAfter'];safe['taskAfter']={k:task[k] for k in ['id','projectId','projectName','dirId','cwd','aiProfileId','aiProfileName','runner','nativeSessionId','title','archivedAt','ptyId','recovery','recoveryReason'] if k in task};safe['taskAfterIdentity']={'runId':task.get('runtimeSnapshot',{}).get('runId'),'runtimeSnapshotConfigEnvironmentOmitted':True};safe=redact(safe)
 for row in safe['fileTrace']:row['originalDelegationChecks']={'inputUnchanged':row.get('input')==row.get('inputAfter'),'outputUnchanged':row.get('before')==row.get('after'),'hashesReferToOriginalUnredactedJSON':True}
 safe['safeProjection']={'originalRawSHA256':h(R/'raw.json'),'authorityValueCountAliased':len(values),'authorityRule':'Domain-separated SHA256 aliases for internal ref/lease/session/draft/op/recovery identities preserve equality relationships throughout original raw. Shape ids201..204 not altered. No raw authority mapping archived. Original observer hashes refer to unredacted originals.','endpointCounts':{'tcp':len(r['knownPorts']),'unix':len(r['exactGatewayPaths'])},'imageBoundary':'Actual immediatepostKey screenshot is busy/reflow overlay evidence only; not stable finalrender or visual parity.'}
 put(dest+'/raw.safe.json',safe);ref(R/'raw.json','Original private raw whole-file SHA, authority/endpoint/config safe projection')
 for v in values:assert v not in json.dumps(safe), 'raw authority leaked'
 put(dest+'/cleanup.safe.json',{'at':cl['at'],'scope':cl['scope'],'allClear':True,'processes':cl['processes'],'tcpChecks':[{'ordinal':n+1,**{k:v.get(k) for k in ['status','error','signal','absent']}} for n,v in enumerate(cl['ports'])],'unixChecks':[{'ordinal':n+1,'socket':{k:v['socket'].get(k) for k in ['absent','error']},'parent':{k:v['parent'].get(k) for k in ['absent','error']}} for n,v in enumerate(cl['unix'])],'helpers':cl['helpers'],'originalNormalExit':cl['originalNormalExit'],'originalHarness':cl['originalHarness'],'GeneralAccessed':False});ref(R/'cleanup.json','Full exact endpoint cleanup original SHA reference only')
 for n in ['ready.json','static.json','pin.json','lease.receipt.json','contract.json','judgement.json','saved-zip-inspection.json']:
  if (R/n).is_file():cp(R/n,dest+'/actual/'+n)
 for f in ready['inputs']:
  p=Path(f['path']);assert h(p)==f['sha256'],str(p);assert p.stat().st_mode&511==f['mode'];row={'attempt':attempt,'originalPath':str(p),'sha256':f['sha256'],'mode':f['mode']};local=p.is_relative_to(R);allowed=p.suffix in ['.mjs','.py','.json','.jxa','.applescript','.md','.txt','.ts','.tsx'];excluded=any(t in p.parts for t in ['runtime-001','userdata','home','cache','node_modules']) or '.private.' in p.name
  if local and allowed and not excluded:
   target='inputs/by-sha/'+f['sha256']+p.suffix;row['safeStoredPath']=target
   if not (S/target).exists():cp(p,target)
  else:row['hashReferenceOnly']=True
  inputIndex.append(row)
 for n in ['run.mjs','static.mjs','cleanup.mjs','judge.py','freeze.py','flow.part']:
  p=R/n
  if p.is_file() and not any(v['attempt']==attempt and v['originalPath']==str(p) for v in inputIndex):
   target='inputs/by-sha/'+h(p)+p.suffix
   if not (S/target).exists():cp(p,target)
   inputIndex.append({'attempt':attempt,'originalPath':str(p),'sha256':h(p),'mode':p.stat().st_mode&511,'safeStoredPath':target})
 stat={'attempt':attempt,'status':r['status'],'checksComplete':len(r['checks']),'normalAppExit':r['appExit'],'signals':r['observedProcess']['signals'],'fileTraceRows':len(r['fileTrace']),'fileDelegatesRestored':r['fileObserverRestored'],'cleanup':{'allClear':True,'pids':len(cl['processes']),'tcp':len(cl['ports']),'unix':len(cl['unix'])},'originalRawSHA256':h(R/'raw.json'),'formalIncrement':0}
 if attempt=='001':
  assert len(r['fileTrace'])==len(r['checks'])==0
  stat.update(classification='Actual focus yield after taskfiles, before any Native PPTX row; not a product PPTX defect',failure=r['failure'],focusGuard=r['focusGuard'],wholeT024Passed=False)
 else:
  judge=json.loads((R/'judgement.json').read_text());zipi=json.loads((R/'saved-zip-inspection.json').read_text());assert judge['passed'] and len(judge['tests'])==8;assert [x['id'] for x in zipi['objects']]==['202','201','203','204'];assert all(r['fileObserverRestored'].values())
  for image in r['screenshots']:
   p=R/'runtime-001'/image['name'];assert h(p)==image['sha256'];cp(p,dest+'/screenshots/'+image['name'])
  p=R/'runtime-001/project/layer.pptx';assert h(p)==r['fixtureSavedSHA256']==zipi['sha256'];cp(p,'fixture/layer.saved.pptx')
  stat.update(classification='Original remaining physical Pages/PPTX conflict branch green, requires Root combination for full T024',actual='session40055 -> a5e7df',judge='7bdc61',cleanupTool='06657b',originalCriteria=judge['tests'],physicalKey=r['physicalKey'],beforeOrder=r['checks'][0]['beforeOrder'],afterOrder=r['checks'][0]['afterOrder'],savedOrder=r['checks'][0]['savedOrder'],browserTabsBefore=len(r['browserBefore']['tabs']),browserTabsAfter=len(r['browserAfter']['tabs']),independentZIPMatches=True,guardCheckedInputs=r['focusGuard']['checkedInputs'],guardYielded=False,actualOSNativeDOM3sBeforeGuard=True,wholeT024Passed=False,combinedReview='Pending Root linked header/systemT0/terminal/project evidence; not determined by this subset projection',screenshotScope='physical-pptx-layer-to-back.png immediatepostKey busy/reflow overlay, not stable finalrender or complete visual match')
 put(dest+'/result.safe.json',stat);stats.append(stat)
# Necessary own synthetic source fixture and exact existing generator provenance.
F=Path('/private/tmp/willyou-pptx-shortcuts-elements-A-M12T024-App036-001/light-editable.pptx');cp(F,'fixture/layer.original.pptx');src=Path('/private/tmp/willyou-m12-title-viewer-source-040/source');gen=[]
for n in ['scripts/files/pptx-element-menu-fixtures.py','scripts/files/pptx-notes-fixtures.py','scripts/files/pptx-element-menu-ui.mjs']:
 p=src/n;cp(p,'fixture/generator/'+p.name);gen.append({'path':str(p),'sha256':h(p)})
rich=Path('/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.pptx');ref(rich,'Original approved own curated PPTX base hash reference, not recopied')
put('fixture/provenance.json',{'inputFixture':{'path':str(F),'sha256':h(F),'bytes':F.stat().st_size},'generatorSourceHashes':gen,'baseSource':{'path':str(rich),'sha256':h(rich)},'initialExpectedOrder':['201','202','203','204'],'actualSavedOrder':['202','201','203','204'],'setupBoundary':'Original generator replaces slide1 with four known shapes from curated OOXML; setup is not an acceptance edit. Existing generatedfixture and actual savedcopy reused; no generator or Office/App executed by projection.'})
put('history/preNative-syntax-error.json',{'toolReference':'6a1d60','classification':'Duplicate selector SyntaxError before actual Native/App work; corrected before original actual001','brokenFullSourceSaved':False,'notReconstructed':True,'boundary':'Coordinator reported tool fact only. No fabricated original broken source, stderr artifact, error stack or replay.'})
put('inputs/index.json',{'files':inputIndex,'deduplication':'Local recoverable driver input bytes stored by SHA once; original absolute path mapping preserved. Dependencies/binaries/source manifests hash-reference only.','rawAuthorityBoundary':'fileTrace aliases protect internal authorizing ref/lease/session identities, preserve equalities and leave OOXML element ids intact. Private raw hash is source of exact values.'})
cp(Path(__file__),'project-pptx-safe.py');put('result.safe.json',{'case':'M12-T024','scope':'001 focusyield red +002 real physical ShiftCmdB PPTX conflict branch','attempts':stats,'wholeT024Passed':False,'rootCombinedReviewPending':True,'GeneralAccessed':False,'formalIncrement':0,'resourcesHeldByProjector':False})
put('provenance.json',{'schema':'M12-safe-projection-v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'safeRoot':str(S),'operation':'Pure Python copy/hash/JSONprojection only; no Node/Native/App/OS/Office/clipboard, no docs/ledger changes or new tests.','originalWholeFiles':refs,'originalsModified':False,'excluded':['App/executables','runtime userData/home/DB/auth/privateclipboard','private logs','TaskAfter runtimeSnapshot/config/env','exact operational endpoints','raw internal ref/session authority values','large dependencies'],'screenshotScope':'Only captured actual immediatepostKey busy reflow PNG preserved; not stable finalrender/visual approval.','sourceSyntaxHistory':'Actual preNative duplicate selector error had no preserved broken fullsource; only explicit coordinator tool fact retained.'})
for attempt in ['001','002']:
 r=json.loads((Path('/private/tmp/willyou-m12-t024-pptx-App036-'+attempt)/'raw.json').read_text())
 for n in ['raw.safe.json','cleanup.safe.json']:
  text=(S/('attempt-'+attempt)/n).read_text();assert not any(v in text for v in r['exactGatewayPaths'])
members=[{'path':str(p.relative_to(S)),'sha256':h(p),'bytes':p.stat().st_size,'mode':p.stat().st_mode&511} for p in sorted(S.rglob('*')) if p.is_file()];put('manifest.json',{'schema':'M12-safe-manifest-v1','safeRoot':str(S),'members':members,'wholeT024Passed':False,'formalIncrement':0,'scope':'Actual PPTX subset only; Root combines independent original evidence'})
for f in members:assert h(S/f['path'])==f['sha256']
print(json.dumps({'safeRoot':str(S),'attemptRoots':[str(S/'attempt-001'),str(S/'attempt-002')],'manifestSHA256':h(S/'manifest.json'),'provenanceSHA256':h(S/'provenance.json'),'resultSHA256':h(S/'result.safe.json'),'files':len(members),'resources':0}))
