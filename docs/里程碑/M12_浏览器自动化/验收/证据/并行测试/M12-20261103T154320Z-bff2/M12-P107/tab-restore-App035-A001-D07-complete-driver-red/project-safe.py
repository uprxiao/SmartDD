from pathlib import Path
import json,hashlib,stat,re,shutil,datetime,copy
ROOT=Path('/private/tmp/willyou-m12-t130-tab-restore-App035-A-prep-001');OUT=Path(__file__).parent/'safe-delivery-001'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def load(p):return json.loads(Path(p).read_text())
def save(n,v):
 p=OUT/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
refs={};provenance=[]
def ref(p,scope='Original private bytes unmodified; SHA-only reference'):
 p=Path(p);row={'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size,'mode':stat.S_IMODE(p.stat().st_mode),'scope':scope};refs[str(p)]=row;return row
r=load(ROOT/'raw.json');c=load(ROOT/'cleanup.json');w=load(ROOT/'root-wrapper-clear.json');ready=load(ROOT/'execution-ready.json')
assert not OUT.exists();assert len(r['checks'])==3 and [x['state']for x in r['checks']]==['forward','back','refresh-and-normal-restart'];assert r['failure']['stage']=='D15-layout';assert len(r['instances'])==2 and all(x['appCleanup']['normalExitConfirmed']and x['appExit']['code']==0 and x['appExit']['signal']is None and x['observedProcess']['signals']==[]for x in r['instances']);assert c['allClear']and w['allClear'];assert all(x['absent']for x in w['wrapperDriverAwakeRows'])
for row in ready['inputs']:
 p=Path(row['path'])if row.get('external')else ROOT/row['path'];assert sha(p)==row['sha256']and stat.S_IMODE(p.stat().st_mode)==row['mode']
secret_keys={'lease','token','runToken','capabilityToken','activeCapability','sourceRef','endpointPath'};secrets=set();transports=set(r.get('exactGatewayPaths',[]));redactions=[]
def collect(v):
 if isinstance(v,dict):
  for k,x in v.items():
   if k in secret_keys and isinstance(x,str)and x:secrets.add(x)
   collect(x)
 elif isinstance(v,list):
  for x in v:collect(x)
collect(r)
# Raw only; no DB/auth/profile files or private electron log is opened.
for text in [json.dumps(r,ensure_ascii=False),json.dumps(c,ensure_ascii=False)]:transports.update(re.findall(r'wss?://(?:127\.0\.0\.1|localhost):\d+/[^\s"<>]+',text))
def clean(v,path=''):
 if isinstance(v,dict):
  out={}
  for k,x in v.items():
   if k in secret_keys:
    out[k]={'redacted':True,'category':'own-source-authority','stableValueSHA256':hashlib.sha256(json.dumps(x,sort_keys=True,ensure_ascii=False).encode()).hexdigest()};redactions.append(path+'/'+k)
   else:out[k]=clean(x,path+'/'+k)
  return out
 if isinstance(v,list):return[clean(x,path+'/'+str(i))for i,x in enumerate(v)]
 if isinstance(v,str):
  for x in secrets|transports:
   if x and x in v:v=v.replace(x,'<private-owned-authority-or-transport>')
  return v
 return v
OUT.mkdir()
def original(p,n):
 p=Path(p);q=OUT/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);assert sha(p)==sha(q);provenance.append({'member':n,'transformation':'original bytes','source':ref(p)})
safe=clean({k:v for k,v in r.items()if k not in ['resources','exactGatewayPaths','failureDOM']})
safe['resources']=[{'at':x['at'],'processes':x['processes'],'helpers':clean(x['helpers']),'listenerTextArchived':False}for x in r['resources']];safe['privateTransportCount']=len(r['exactGatewayPaths']);safe['failureDOM']={'originalRetainedByRawSHA':True,'fullOuterHTMLArchived':False,'title':r.get('failureDOM',{}).get('title'),'focused':r.get('failureDOM',{}).get('focused'),'visibility':r.get('failureDOM',{}).get('visibility')};safe['sourceOriginal']=ref(ROOT/'raw.json');save('raw.safe.json',safe)
safe_c={k:copy.deepcopy(v)for k,v in c.items()if k not in ['unix','helpers']};safe_c['unix']=[{'ordinal':i+1,'socketAbsent':x['socket']['absent'],'parentAbsent':x['parent']['absent']}for i,x in enumerate(c['unix'])];safe_c['helperCount']=len(c['helpers']);safe_c['sourceOriginal']=ref(ROOT/'cleanup.json');save('cleanup.safe.json',clean(safe_c))
external=[]
for row in ready['inputs']:
 p=Path(row['path'])if row.get('external')else ROOT/row['path']
 if row.get('external')or row['path'].startswith('node_modules/'):external.append({**row,'realpath':str(p.resolve()),'bytes':p.stat().st_size,'payloadCopied':False})
 else:original(p,'frozen-inputs/'+row['path'])
for n in ['execution-ready.json','manifest.json','static-review.json','initial-foreground-authorization.receipt.json','lease.receipt.json']:
 if(ROOT/n).exists():original(ROOT/n,'frozen-inputs/'+n)
original(ROOT/'root-wrapper-clear.json','root-wrapper-clear.json')
judge=ROOT/'judgement.json'
if judge.exists():original(judge,'judgement.original.json')
for row in r['screenshotRecords']:
 p=ROOT/'runtime-001'/row['name'];b=p.read_bytes();assert sha(p)==row['sha256'];assert b[:8]==bytes.fromhex('89504e470d0a1a0a');assert int.from_bytes(b[16:20],'big')==row['width']and int.from_bytes(b[20:24],'big')==row['height'];original(p,'images/'+row['name'])
for n in ['raw.json','live.json','cleanup.json','primary-failure.private.log']:
 if(ROOT/n).exists():ref(ROOT/n)
save('diagnostic.safe.json',{'classification':'driver-extra-width-direction-assertion','originalFailure':r['failure'],'currentSourceEvidence':{'path':'src/renderer/features/files/workspace-panel.tsx','line':205,'actualMeaning':'ArrowLeft widens the right-side tree by10; source original tab-restore-ui only captures width and validates persistence, with no smaller-direction criterion.'},'originalExpectedNotChanged':True,'completedObservations':3,'remainingObservations':5,'fullOriginalGroupPassed':False,'originalJudgeOutputExists':judge.exists(),'oldRedRetained':True,'continuationBoundary':'Independent cont002 plans only D15-D17; old D073observations and2normal instances remain original facts, not rerun.'})
save('result.safe.json',{'case':'M12-T130','subcases':['M9-T-D07','M9-T-D15','M9-T-D16','M9-T-D17'],'layer':'A only','status':'driver-failed-partial','source':'App035/source039','actualRootReceipt':{'tool':'f77b95','session':96470,'driverPID':r['driverPid'],'AppPIDs':[x['appPid']for x in r['instances']],'toolExitCode':None,'toolExitBoundary':'Numeric driverexit not independently present in input artifact; App exits separately proven.'},'completedObservations':[{k:x.get(k)for k in ['caseId','state','instance','at']}for x in r['checks']],'failure':r['failure'],'originalPlannedObservations':8,'actuallyComplete':3,'actuallyIncomplete':5,'AppExits':r['exits'],'cleanup':{'PID':len(c['processes']),'TCP':len(c['ports']),'Unix':len(c['unix']),'helperCount':len(c['helpers']),'allClear':c['allClear']},'RootWrapper':w,'sourceBefore':r['before'],'afterFullGroup':r.get('after'),'images':r['screenshotRecords'],'tasksAndModels':{'tasksAllObservedBeforeAfter':all(x.get('tasksBefore')==[]and x.get('tasksAfter')==[]for x in r['instances']),'modelsRun':0},'formalIncrement':0,'wholeT130Passed':False,'publicLedgerModified':False,'resourcesHeld':False})
save('external-inputs-by-sha.json',{'inputs':external,'nodeModulesLink':{'target':str((ROOT/'node_modules').readlink()),'realpath':str((ROOT/'node_modules').resolve())},'boundary':'CurrentApp/tool/sharedTypeScript/ws original hashes only; no App/binary/dependency tree or retiredApp payload copied.'})
original(Path(__file__),'project-safe.py')
save('private-source-references.json',{'references':list(refs.values()),'notArchived':['fullraw/live/private stack or logs','runtime/userdata/cache/DB/Cookie/auth','sourceauthority lease values','complete debug/Unix endpoint','App/DMG/native executables'],'privateOriginalsUnmodified':True})
save('member-provenance.json',{'members':provenance,'allCopiedMembersOriginalBytes':True})
for p in OUT.rglob('*'):
 if not p.is_file():continue
 assert not p.is_symlink();b=p.read_bytes();assert p.suffix not in ['.dmg','.asar','.db','.sqlite','.node','.dylib']
 for value in secrets|transports:
  if value:assert value.encode()not in b,str(p)
 assert not re.search(rb'wss?://(?:127\.0\.0\.1|localhost):\d+/[0-9a-f-]{16,}',b),p
save('projection-audit.json',{'originalRawSHA256':sha(ROOT/'raw.json'),'projectedChecks':3,'exactSourceHashesAndModesVerified':len(ready['inputs']),'redactedAuthorityOccurrences':len(redactions),'actualNodeNativeAppOSExecutedByProjection':0,'privateSourceUnmodified':True,'allDynamicAuthorityAndEndpointLeakScanPassed':True,'formalIncrement':0,'resourcesHeld':False})
files=[{'path':str(p.relative_to(OUT)),'bytes':p.stat().st_size,'sha256':sha(p),'mode':stat.S_IMODE(p.stat().st_mode)}for p in sorted(OUT.rglob('*'))if p.is_file()]
save('manifest.json',{'schema':'M12-tab-restore-A001-partial-safe-v1','files':files,'completedOriginalObservations':3,'remainingOriginalObservations':5,'fullGroupPassed':False,'sourceREADY_SHA256':sha(ROOT/'execution-ready.json'),'formalIncrement':0,'resourcesHeld':False})
print(json.dumps({'safeRoot':str(OUT),'members':len(files),'manifestSHA256':sha(OUT/'manifest.json'),'completed':3,'remaining':5,'formalIncrement':0,'resourcesHeld':False}))
