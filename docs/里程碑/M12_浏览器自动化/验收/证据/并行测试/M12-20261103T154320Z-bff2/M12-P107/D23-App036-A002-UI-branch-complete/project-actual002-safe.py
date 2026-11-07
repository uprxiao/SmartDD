from pathlib import Path
import json,hashlib,shutil,datetime,copy
R=Path('/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-002');S=R/'safe-delivery-001';assert not S.exists();S.mkdir(mode=0o700);h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();refs=[]
def put(n,v):
 p=S/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def cp(p,n):
 p=Path(p);q=S/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'safeCopy':n})
def ref(p,purpose):
 p=Path(p);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'purpose':purpose})
r=json.loads((R/'raw.json').read_text());cl=json.loads((R/'cleanup.json').read_text());j=json.loads((R/'judgement.json').read_text());ready=json.loads((R/'execution-ready.json').read_text());assert r['status']=='executed-unjudged' and j['passed'] and cl['allClear'];assert len(r['checks'])==2 and len(r['instances'])==4 and len(j['checks'])==8 and all(x['pass'] for x in j['checks']);assert r['clipboardFinal']['generalStarted'] is False and 'clipboardControl' not in r
# Full original raw is privately preserved and whole-file hashed. Operational endpoints removed; opaque Native authority tokens hash-projected with fieldstructure retained.
def redact_authority(v):
 if isinstance(v,dict):return {k:('redacted-sha256:'+hashlib.sha256(str(x).encode()).hexdigest() if k in ['lease','runToken','activeCapability','sourceRef','capabilityToken'] else redact_authority(x)) for k,x in v.items()}
 if isinstance(v,list):return [redact_authority(x) for x in v]
 return v
safe=redact_authority(copy.deepcopy(r));safe.pop('exactGatewayPaths',None);safe.pop('knownPorts',None);safe['resources']=[{k:v[k] for k in ['at','processes','helpers'] if k in v} for v in r['resources']];safe['safeProjection']={'originalRawSHA256':h(R/'raw.json'),'endpointCounts':{'tcp':len(r['knownPorts']),'unix':len(r['exactGatewayPaths'])},'omitted':'Exact operational sockets/ports/listener dumps. No clipboard backup/data was read or included. Original raw unchanged.'};put('raw.safe.json',safe);ref(R/'raw.json','Private original raw whole-file hash, safe projection excludes actual endpoints only')
put('cleanup.safe.json',{'at':cl['at'],'scope':cl['scope'],'allClear':cl['allClear'],'processes':cl['processes'],'tcpChecks':[{'ordinal':n+1,**{k:v.get(k) for k in ['status','error','signal','absent']}} for n,v in enumerate(cl['ports'])],'unixChecks':[{'ordinal':n+1,'socket':{k:v['socket'].get(k) for k in ['absent','error']},'parent':{k:v['parent'].get(k) for k in ['absent','error']}} for n,v in enumerate(cl['unix'])],'helpers':cl['helpers'],'originalNormalExit':cl['originalNormalExit'],'originalHarness':cl['originalHarness'],'systemGeneralWasAttempted':cl['systemGeneralWasAttempted'],'clipboardRestoration':cl['clipboardRestoration'],'privateRecoveryMaterialRetained':cl['privateRecoveryMaterialRetained'],'boundary':'17PID/8TCP/8Unix actual cleanup clear; this002 never started General or copied. Old001 private recovery remains separate and was not accessed.'});ref(R/'cleanup.json','Private exact endpoint cleanup original; safe projection')
for n in ['judgement.json','execution-ready.json','manifest.json','lease.receipt.json','static-review.json','execution-started.json']:
 cp(R/n,'actual/'+n)
for i in r['instances']:
 cp(R/('initial-foreground-attempt-'+str(i['appPid'])+'.json'),'actual/initial-foreground-attempt-'+str(i['appPid'])+'.json')
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
for x in r['checks']:
 assert x['theme'] in ['light','dark'] and x['uiReadWritePassed'];assert x['checkpoint']['state']['active']['sourcePath']==x['roots']['A'];assert x['checkpoint']['state']['treeSource'].endswith(':'+x['roots']['B']);assert x['oldA']['lease']!=x['newA']['lease'];assert x['restored']['state']['active']['sourcePath']==x['roots']['A'];assert x['clipboard']['status']=='not-executed-helper-pending' and x['externalOpen']=='not executed'
 for name in ['A/b.md','B/a.md','B/b.md']:assert x['after'][name]==x['before'][name]
 assert x['after']['A/a.md']['sha256']==hashlib.sha256(x['edited'].encode()).hexdigest()
for i in r['instances']:
 assert i['appExit']['code']==0 and i['appExit']['signal'] is None and i['observedProcess']['signals']==[] and i['appCleanup']['normalExitConfirmed'];assert len(i['restored'])==7 and all(i['restored'].values());assert i['initialFocus']['actualStableMs']>=3000 and len(i['focusGuards'])==1 and not i['focusGuard'].get('yieldedAt')
put('result.safe.json',{'case':'M9-T-D23','parent':'M12-T130','classification':'Original independent ordinary UI branch complete; clipboard and external opening not executed, wholeD23 false','originalJudgePassed':True,'originalCriteria':j['checks'],'actualCompletedChecks':2,'themes':['light','dark'],'AppProcesses':4,'normalRestarts':2,'wholeD23Passed':False,'formalIncrement':0,'clipboard':{'generalStarted':False,'copiesExecuted':0,'final':r['clipboardFinal'],'old001BackupTouchedByProjection':False},'AppExits':r['exits'],'processCleanup':{'allClear':cl['allClear'],'pidCount':len(cl['processes']),'tcpCount':len(cl['ports']),'unixCount':len(cl['unix'])},'screenshotsCaptured':r['screenshotRecords'],'externalOpen':'Not executed','projectionResourcesHeld':False,'coordinatorActualReference':{'actual':'session52840 -> 6fe31d','cleanup':'4b0327','judge':'cb49f2','source':'Root supplied actual receipt; no new OS check performed by projector'}})
prior=Path('/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/safe-delivery-001/manifest.json');ref(prior,'Prior actual001 red safe manifest; immutable independent failure/recovery evidence, not reclassified by002');put('previous-attempt-reference.json',{'path':str(prior),'sha256':h(prior),'boundary':'Original001 failure and retained private backup stay separate. No backup contents/metadata/hash accessed, no clipboard retry/diagnosis.'})
cp(Path(__file__),'project-actual002-safe.py')
put('provenance.json',{'schema':'M12-safe-projection-v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'privateRoot':str(R),'safeRoot':str(S),'operation':'Pure Python file projection/hash only; no Node/Native/App/OS/clipboard operation or diagnosis framework/public writes.','originalWholeFiles':refs,'originalsModified':False,'excluded':['All privateclipboardbackup files and their contents/type/data/hash','Runtime userData/home/DB/all runtime logs','All *.private.log including failure stack','App/native binaries','Large shared dependencies','Exact operational endpoints/listeners'],'clipboardNoReadBoundary':'Only existing structured safe helper replies in raw were consumed; private backup was not opened, hashed, copied, inspected or deleted.','resourceBoundary':'Actual root terminal per coordinator; file-only projector holds0 resources.'})
# Exact operation endpoints never appear in this safe projection. Frozen source templates are permitted.
for p in S.rglob('*'):
 if p.is_file() and p.suffix in ['.json','.mjs','.py','.md','.txt','.diff']:
  text=p.read_text(errors='replace');assert not any(v in text for v in r['exactGatewayPaths']),str(p)
members=[{'path':str(p.relative_to(S)),'sha256':h(p),'bytes':p.stat().st_size,'mode':p.stat().st_mode&511} for p in sorted(S.rglob('*')) if p.is_file()];put('manifest.json',{'schema':'M12-safe-manifest-v1','safeRoot':str(S),'members':members,'wholeD23Passed':False,'formalIncrement':0,'scope':'D23 actual002 ordinary UI branch complete8/8; noGeneral/copy/external, wholeD23false; old001 red and private recovery unchanged'})
for f in members:assert h(S/f['path'])==f['sha256']
print(json.dumps({'safeRoot':str(S),'manifestSHA256':h(S/'manifest.json'),'provenanceSHA256':h(S/'provenance.json'),'resultSHA256':h(S/'result.safe.json'),'members':len(members),'privateClipboardBackupAccessed':False,'resources':0}))
