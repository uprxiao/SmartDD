from pathlib import Path
import json,hashlib,shutil,datetime,copy
R=Path('/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001');S=R/'safe-delivery-001';assert not S.exists();S.mkdir(mode=0o700);h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();refs=[]
def put(n,v):
 p=S/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def cp(p,n):
 p=Path(p);q=S/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'safeCopy':n})
def ref(p,purpose):
 p=Path(p);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'purpose':purpose})
r=json.loads((R/'raw.json').read_text());cl=json.loads((R/'cleanup.json').read_text());j=json.loads((R/'judgement.json').read_text());ready=json.loads((R/'execution-ready.json').read_text());assert r['status']=='failed-or-partial' and not j['passed'] and cl['allClear'];assert len(r['checks'])==0 and len(r['instances'])==2 and len(j['checks'])==8
# Full original raw is privately preserved and whole-file hashed. Only operational endpoint fields removed.
safe=copy.deepcopy(r);safe.pop('exactGatewayPaths',None);safe.pop('knownPorts',None);safe['resources']=[{k:v[k] for k in ['at','processes','helpers'] if k in v} for v in r['resources']];safe['safeProjection']={'originalRawSHA256':h(R/'raw.json'),'endpointCounts':{'tcp':len(r['knownPorts']),'unix':len(r['exactGatewayPaths'])},'omitted':'Exact operational sockets/ports/listener dumps. No clipboard backup/data was read or included. Original raw unchanged.'};put('raw.safe.json',safe);ref(R/'raw.json','Private original raw whole-file hash, safe projection excludes actual endpoints only')
put('cleanup.safe.json',{'at':cl['at'],'scope':cl['scope'],'allClear':cl['allClear'],'processes':cl['processes'],'tcpChecks':[{'ordinal':n+1,**{k:v.get(k) for k in ['status','error','signal','absent']}} for n,v in enumerate(cl['ports'])],'unixChecks':[{'ordinal':n+1,'socket':{k:v['socket'].get(k) for k in ['absent','error']},'parent':{k:v['parent'].get(k) for k in ['absent','error']}} for n,v in enumerate(cl['unix'])],'helpers':cl['helpers'],'originalNormalExit':cl['originalNormalExit'],'originalHarness':cl['originalHarness'],'systemGeneralWasAttempted':cl['systemGeneralWasAttempted'],'clipboardRestoration':cl['clipboardRestoration'],'privateRecoveryMaterialRetained':cl['privateRecoveryMaterialRetained'],'boundary':'10PID/4TCP/4Unix process/endpoint cleanup allClear does not imply clipboard restored. Original clipboard recovery backup remains private.'});ref(R/'cleanup.json','Private exact endpoint cleanup original; safe projection')
for n in ['judgement.json','execution-ready.json','manifest.json','lease.receipt.json','static-review.json','execution-started.json','initial-foreground-attempt-46726.json','initial-foreground-attempt-46944.json']:
 cp(R/n,'actual/'+n)
# Reconstructable local prepared inputs only; dependencies/binaries/source references hash-only.
external=[];deps=[];copied=set()
for f in ready['inputs']:
 n=f['path']
 if f.get('external'):external.append(f);continue
 if n.startswith('node_modules/'):deps.append(f);continue
 if n.startswith(('runtime-','clipboard-control-')) or n.endswith('.private.log') or 'clipboard-original' in n:continue
 p=R/n
 if p.suffix not in ['.mjs','.py','.json','.jxa','.applescript','.md','.diff','.ts','.tsx','.txt','.swift']:continue
 assert h(p)==f['sha256'],n;assert p.stat().st_mode&511==f['mode'];cp(p,'inputs/local/'+n);copied.add(n)
for n in ['clipboard-interface-review.json','clipboard-client-review.json','clipboard-hook.contract.json','contract.json','original-contract.json','driver-file-access-map.json','pin.json','README.md','clipboard-hook.mjs','clipboard-client.mjs','clipboard-client.diff']:
 if n not in copied and (R/n).is_file():cp(R/n,'inputs/current/'+n)
put('inputs/dependencies-and-externals.hashes.json',{'external':external,'dependencies':deps,'links':ready.get('links',[]),'boundary':'No App/binary/shareddependency/runtime/privatebackup copied. References are preexisting frozen input hashes, not new system clipboard content hashes.'})
for x in r['screenshotRecords']:
 name=x['name'];assert '/' not in name and name.endswith('.png');p=R/'runtime-001'/name
 if not p.is_file():
  hits=[R/'runtime-001'/'light'/name,R/'runtime-001'/'dark'/name];p=next(q for q in hits if q.is_file())
 assert h(p)==x['sha256'];cp(p,'screenshots/'+name)
put('result.safe.json',{'case':'M9-T-D23','parent':'M12-T130','classification':'Actual partial/incomplete; original eight-criterion judge red, no complete case','originalJudgePassed':False,'originalCriteria':j['checks'],'actualCompletedChecks':0,'wholeD23Passed':False,'formalIncrement':0,'actualStage':'Light normal restart restored active A/a.md + independent selected tree B and acquired fresh A lease; original copy step was armed but new clipboard contents could not be claimed. No edit/save or dark execution.','clipboard':{'generalStarted':True,'captureBackupComplete':r['clipboardFinal']['capture']['originalBackupComplete'],'pathCopyClaimed':False,'restored':False,'refusal':r['clipboardFinal']['restorationDeferred'],'actualHelperExit':r['clipboardFinal']['helperExit'],'helperNormalExit':r['clipboardFinal']['helperNormalExit'],'allRecordedAppWritersAbsent':r['clipboardFinal']['allRecordedWritersAbsent'],'backupRetainedPrivately':True,'valuesTypesDataOrOriginalContentHashIncluded':False,'causeBoundary':'No ownership after copy observation => original CAS/ownedSnapshot restoration refused. Error text is not proof of user copying or a specific clipboard format/cause; no overwrite/recovery attempted here.'},'AppExits':r['exits'],'processCleanup':{'allClear':cl['allClear'],'pidCount':len(cl['processes']),'tcpCount':len(cl['ports']),'unixCount':len(cl['unix'])},'screenshotsCaptured':r['screenshotRecords'],'externalOpen':'Not executed','projectionResourcesHeld':False})
cp(Path(__file__),'project-actual001-safe.py')
put('provenance.json',{'schema':'M12-safe-projection-v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'privateRoot':str(R),'safeRoot':str(S),'operation':'Pure Python file projection/hash only; no Node/Native/App/OS/clipboard operation or diagnosis framework/public writes.','originalWholeFiles':refs,'originalsModified':False,'excluded':['All privateclipboardbackup files and their contents/type/data/hash','Runtime userData/home/DB/all runtime logs','All *.private.log including failure stack','App/native binaries','Large shared dependencies','Exact operational endpoints/listeners'],'clipboardNoReadBoundary':'Only existing structured safe helper replies in raw were consumed; private backup was not opened, hashed, copied, inspected or deleted.','resourceBoundary':'Actual root terminal per coordinator; file-only projector holds0 resources.'})
# Exact operation endpoints never appear in this safe projection. Frozen source templates are permitted.
for p in S.rglob('*'):
 if p.is_file() and p.suffix in ['.json','.mjs','.py','.md','.txt','.diff']:
  text=p.read_text(errors='replace');assert not any(v in text for v in r['exactGatewayPaths']),str(p)
members=[{'path':str(p.relative_to(S)),'sha256':h(p),'bytes':p.stat().st_size,'mode':p.stat().st_mode&511} for p in sorted(S.rglob('*')) if p.is_file()];put('manifest.json',{'schema':'M12-safe-manifest-v1','safeRoot':str(S),'members':members,'wholeD23Passed':False,'formalIncrement':0,'scope':'D23 actual001 incomplete; process cleanup clear, clipboard restoration refused/private recovery material retained'})
for f in members:assert h(S/f['path'])==f['sha256']
print(json.dumps({'safeRoot':str(S),'manifestSHA256':h(S/'manifest.json'),'provenanceSHA256':h(S/'provenance.json'),'resultSHA256':h(S/'result.safe.json'),'members':len(members),'privateClipboardBackupAccessed':False,'resources':0}))
