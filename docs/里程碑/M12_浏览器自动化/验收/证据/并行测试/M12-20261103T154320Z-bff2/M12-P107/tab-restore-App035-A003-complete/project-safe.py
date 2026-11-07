from pathlib import Path
import json,hashlib,stat,shutil,copy,re,datetime
R=Path('/private/tmp/willyou-m12-t130-tab-restore-App035-A-cont-003');O=Path(__file__).parent/'safe-delivery-001'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def load(p):return json.loads(Path(p).read_text())
def save(n,v):
 p=O/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
refs={};provenance=[]
def ref(p,scope='Original immutableprivate bytes retained; SHA-only reference'):
 p=Path(p);v={'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size,'mode':stat.S_IMODE(p.stat().st_mode),'scope':scope};refs[str(p)]=v;return v
r=load(R/'raw.json');j=load(R/'judgement.json');c=load(R/'cleanup.json');reuse=load(R/'reuse-D07.json');S=Path(reuse['sourceRoot']);old=load(S/'raw.json');oc=load(S/'cleanup.json');ready=load(R/'execution-ready.json')
assert not O.exists();assert sha(S/'raw.json')==reuse['sourceRawSHA256']and sha(S/'cleanup.json')==reuse['sourceCleanupSHA256'];assert len(r['checks'])==5 and len(old['checks'])==3 and len(r['instances'])==7 and len(old['instances'])==2;assert j['passed']and len(j['checks'])==10 and all(x['pass']for x in j['checks']);assert c['allClear']and oc['allClear'];assert r['cleanupErrors']==[];assert len(c['processes'])==32 and len(c['ports'])==14 and len(c['unix'])==14;assert all(x['code']==0 and x['signal']is None and x['signals']==[]and x['normalExitConfirmed']for x in old['exits']+r['exits']);assert r['after']['A.txt']==r['before']['A.txt']and r['after']['C.txt']==r['before']['C.txt'];assert r['controlledBDelete']['before']==r['before']['B.txt'];assert r['rootMoved']is False
for x in ready['inputs']:
 p=Path(x['path'])if x.get('external')else R/x['path'];assert sha(p)==x['sha256']and stat.S_IMODE(p.stat().st_mode)==x['mode'],p
secretKeys={'lease','token','runToken','capabilityToken','activeCapability','sourceRef','endpointPath'};secrets=set();transports=set(old.get('exactGatewayPaths',[])+r.get('exactGatewayPaths',[]));redactions=[]
def collect(v):
 if isinstance(v,dict):
  for k,x in v.items():
   if k in secretKeys and isinstance(x,str)and x:secrets.add(x)
   collect(x)
 elif isinstance(v,list):
  for x in v:collect(x)
collect(old);collect(r)
def clean(v,path=''):
 if isinstance(v,dict):
  o={}
  for k,x in v.items():
   if k in secretKeys:
    o[k]='<redacted-own-authority-sha256:'+hashlib.sha256(json.dumps(x,ensure_ascii=False,sort_keys=True).encode()).hexdigest()+'>';redactions.append(path+'/'+k)
   else:o[k]=clean(x,path+'/'+k)
  return o
 if isinstance(v,list):return[clean(x,path+'/'+str(i))for i,x in enumerate(v)]
 if isinstance(v,str):
  for x in secrets|transports:
   if x and x in v:v=v.replace(x,'<private-owned-authority-or-transport>')
  return v
 return v
O.mkdir()
def original(p,n):
 p=Path(p);q=O/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);assert sha(p)==sha(q);provenance.append({'member':n,'transformation':'originalbytes','source':ref(p)})
safe=clean({k:v for k,v in r.items()if k not in ['resources','exactGatewayPaths']},'new');safe['resources']=[{'at':x['at'],'processes':x['processes'],'helperCount':len(x['helpers']),'listenersArchived':False}for x in r['resources']];safe['privateUnixEndpointCount']=len(r['exactGatewayPaths']);safe['sourceOriginal']=ref(R/'raw.json');save('raw.safe.json',safe)
oldSafe=clean({k:old[k]for k in ['case','layer','startedAt','driverPid','project','projectId','asarSha256','sourceManifestSha256','instances','checks','traces','exits','screenshots','screenshotRecords','before','dragTrace','dragObserverRemoved']},'oldD07');oldSafe['sourceOriginal']=ref(S/'raw.json');oldSafe['executedThisContinuation']=False;oldSafe['originalRunStatus']=old['status'];oldSafe['originalD15Failure']=old['failure'];save('reused-D07.safe.json',oldSafe)
def cleanCleanup(x,source):
 o=clean({k:v for k,v in x.items()if k not in ['unix','helpers']});o['unix']=[{'ordinal':i+1,'originalSocketPathSHA256':hashlib.sha256(y['path'].encode()).hexdigest(),'socketAbsent':y['socket']['absent'],'parentAbsent':y['parent']['absent']}for i,y in enumerate(x['unix'])];o['helperCount']=len(x['helpers']);o['sourceOriginal']=ref(source);return o
save('cleanup.safe.json',cleanCleanup(c,R/'cleanup.json'));save('reused-D07-cleanup.safe.json',cleanCleanup(oc,S/'cleanup.json'))
original(R/'judgement.json','judgement.original.json')
rootReceipt={'source':'Root explicitactualmessage; not rerun by projector','actualTool':'ba4274','wrapperDriverAwake':[{'pid':x,'absent':True}for x in [14677,14679,14678]],'allClear':True,'normalAppExitsSeparate':True};save('root-wrapper-receipt.safe.json',rootReceipt)
external=[]
for x in ready['inputs']:
 p=Path(x['path'])if x.get('external')else R/x['path']
 if x.get('external')or x['path'].startswith('node_modules/'):external.append({**x,'realpath':str(p.resolve()),'payloadCopied':False})
 else:original(p,'frozen-inputs/'+x['path'])
for n in ['execution-ready.json','manifest.json','static-review.json','lease.receipt.json']:
 if(R/n).exists():original(R/n,'frozen-inputs/'+n)
images=[]
for source,raw,executed in [(S,old,False),(R,r,True)]:
 for x in raw['screenshotRecords']:
  p=source/'runtime-001'/x['name'];b=p.read_bytes();assert sha(p)==x['sha256']and b[:8]==bytes.fromhex('89504e470d0a1a0a');assert int.from_bytes(b[16:20],'big')==x['width']and int.from_bytes(b[20:24],'big')==x['height'];original(p,'images/'+x['name']);images.append({**x,'executedThisContinuation':executed,'originalSource':str(p)})
assert len(images)==8
oldSafeManifest=Path('/private/tmp/willyou-m12-t130-tab-restore-App035-A001-safe-prep-001/safe-delivery-001/manifest.json');red2Manifest=Path('/private/tmp/willyou-m12-t130-tab-restore-App035-A002-safe-001/manifest.json')
save('old-red-evidence-chain.json',{'A001':ref(oldSafeManifest,'Original57member partialdriver-redsafe retained; D073actualobservations reused'),'A002':ref(red2Manifest,'Original63member startup-redsafe retained; zero newbusiness, noOSgatecause/no normalexit claim'),'unchanged':True})
# Explicit independent predicates use original private data before redaction.
held=[x for x in r['checks']if x['caseId']=='M9-T-D17'];assert len(held)==2
for x in held:
 assert len(x['held'])==2 and x['release']['order']==[y['row']['path']for y in x['held']][::-1];assert x['stableFocus']and x['actualCText']=='Original C.txt\n'
for trace in old['traces']+r['traces']:
 assert trace['originalRestored']and trace['observersRestored']and trace['globalDeleted'];assert all(trace['restored'].values())
 for row in trace['records']+trace['io']:
  if row['delivered']:assert row['before']==row['after']and row['inputHash']==row['inputAfterHash']
summary={'case':'M12-T130','subcases':['M9-T-D07','M9-T-D15','M9-T-D16','M9-T-D17'],'layer':'A only','status':'original-eight-observations-complete-by-strict-composition','source':'App035/source039','actualNew':{'tool':'705000','session':1548,'driverPID':r['driverPid'],'AppPIDs':[x['appPid']for x in r['instances']],'toolExitCode':0,'source':'Rootactualreceipt'},'composition':{'reusedD07Observations':3,'newD15D16D17Observations':5,'totalOriginalObservations':8,'oldActualApps':2,'newActualApps':7,'totalActualApps':9,'plannedOriginalEightAppsNotUsedAsBusinessCriterion':True},'originalJudgement':{'path':'judgement.original.json','checks':10,'passed':True,'sha256':sha(R/'judgement.json')},'newAppExits':r['exits'],'oldAppExits':old['exits'],'currentIndependentCleanup':{'PID':32,'TCP':14,'Unix':14,'allClear':True},'oldIndependentCleanup':{'PID':len(oc['processes']),'TCP':len(oc['ports']),'Unix':len(oc['unix']),'allClear':True,'sourceSHA256':sha(S/'cleanup.json')},'rootWrapper':rootReceipt,'before':r['before'],'afterProtectedAandC':r['after'],'controlledBDeleteAndRecreation':r['controlledBDelete'],'recreatedB':r['recreatedB'],'originalRootRestored':r['rootMoved']is False,'D17ActualSameCFocus':[{'state':x['state'],'heldOriginalSuccesses':len(x['held']),'release':x['release'],'focus':x['focus'],'stableFocus':x['stableFocus'],'actualActivePath':x['actualActivePath'],'actualCText':x['actualCText']}for x in held],'all9HandlerTriplesRestored':True,'allDeliveredOriginalInputsOutputsUnchanged':True,'zeroTasksAll9':all(x['tasksBefore']==[]and x['tasksAfter']==[]for x in old['instances']+r['instances']),'modelsRun':0,'images':images,'normalExitAndResourceAbsenceSeparated':True,'noGateOrDBFieldEditsBy003':r['sameOwnedUserData']['gateDeleted']is False and r['sameOwnedUserData']['DBFieldsRewritten']is False,'copyPerformedBy003':False,'fullParentT130Passed':False,'formalIncrement':0,'resourcesHeld':False};save('result.safe.json',summary)
save('external-inputs-by-sha.json',{'inputs':external,'nodeModules':{'target':str((R/'node_modules').readlink()),'realpath':str((R/'node_modules').resolve())},'recoveryUserDataSeed':{'root':'/private/tmp/willyou-m12-t130-tab-restore-App035-A-cont-002/seed/userdata','files':314,'privateOnly':True,'manifest':'frozen-inputs/seed-manifest.json','notArchived':'DB/cache/storage bodies'},'boundary':'No App/DMG/nativebinary/shareddeps/privateuserData payload copied. Originalseed and canonicalcurrentApp retained privately.'})
for p in [R/'raw.json',R/'live.json',S/'raw.json',R/'cleanup.json',S/'cleanup.json']:ref(p)
original(Path(__file__),'project-safe.py')
save('private-source-references.json',{'references':list(refs.values()),'notArchived':['fullraw/live/logs or DB/auth/Cookie/cache','current or originaluserdata','ownlease/capability values','completeUnix/debug endpoints','App/DMG/nativebinaries'],'sourceOriginalsUnmodified':True,'A001UserDataReadByProjection':False})
save('member-provenance.json',{'members':provenance,'originalCopiedBytesPreserved':True})
for p in O.rglob('*'):
 if not p.is_file():continue
 assert not p.is_symlink();b=p.read_bytes();assert p.suffix not in ['.sqlite','.db','.node','.asar','.dmg','.dylib']
 for value in secrets|transports:
  if value:assert value.encode()not in b,p
 assert not re.search(rb'wss?://(?:127\.0\.0\.1|localhost):\d+/[0-9a-f-]{16,}',b),p
save('projection-audit.json',{'currentImmutableInputsSHAModeVerified':len(ready['inputs']),'reusedOriginalRawAndCleanupSHAValidated':True,'oldChecks':3,'newChecks':5,'newAppNormalExits':7,'totalActualApps':9,'originalJudgeGreenChecks':10,'PNGs':8,'all9DelegatesRestoreAndDeliveredHashesIndependentlyVerified':True,'AandCFullStatUnchanged':True,'BOriginalBeforeDeleteIndependentlyMatchesBefore':True,'redactedAuthorityFields':len(redactions),'allActualAuthorityTransportLeakScanPassed':True,'NodeNativeAppOSStartedByProjector':0,'sourceOriginalsUnmodified':True,'formalIncrement':0,'resourcesHeld':False})
files=[{'path':str(p.relative_to(O)),'bytes':p.stat().st_size,'sha256':sha(p),'mode':stat.S_IMODE(p.stat().st_mode)}for p in sorted(O.rglob('*'))if p.is_file()]
save('manifest.json',{'schema':'M12-tab-restore-A003-complete-composition-safe-v1','files':files,'originalObservations':8,'actualApps':9,'originalJudgePassed':True,'formalIncrement':0,'resourcesHeld':False,'executionReadySHA256':sha(R/'execution-ready.json')})
print(json.dumps({'safeRoot':str(O),'members':len(files),'manifestSHA256':sha(O/'manifest.json'),'originalObservations':8,'originalJudge':10,'formalIncrement':0,'resourcesHeld':False}))
