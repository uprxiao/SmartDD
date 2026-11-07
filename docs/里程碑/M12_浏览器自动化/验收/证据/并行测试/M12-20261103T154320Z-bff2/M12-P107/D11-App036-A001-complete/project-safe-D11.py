#!/usr/bin/python3
"""Pure-file D11 safe projection; no subprocess, Node, App, Native or OS probe."""
from pathlib import Path
import copy,datetime,hashlib,json,re,shutil,stat
ROOT=Path('/private/tmp/willyou-m12-t130-D11-App036-A-prep-001')
OUT=Path('/private/tmp/willyou-m12-t130-D11-App036-A001-safe-001')
PUBLIC=Path('/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P107/task-tabs-App035-A003-D18-complete-D11-crash-red')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def load(p):return json.loads(Path(p).read_text())
refs={};provenance=[]
def ref(p,boundary='Whole original file SHA; private source unchanged'):
 p=Path(p);key=str(p)
 if key not in refs:refs[key]=dict(path=key,sha256=sha(p),bytes=p.stat().st_size,mode=stat.S_IMODE(p.stat().st_mode),boundary=boundary)
 return refs[key]
def save(name,value):
 p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def original(p,name):
 p=Path(p);assert p.is_file() and not p.is_symlink();out=OUT/name;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,out);assert sha(out)==sha(p);provenance.append(dict(member=name,transformation='Original whole bytes',source=ref(p)))
def pick(value,keys):return {k:copy.deepcopy(value[k]) for k in keys if k in value}
raw=load(ROOT/'raw.json');judge=load(ROOT/'judgement.json');cleanup=load(ROOT/'cleanup.json');review=load(ROOT/'root-review.json');inputs=load(ROOT/'manifest.json')
assert raw['status']=='executed-unjudged' and len(raw['checks'])==1 and raw['checks'][0]['caseId']=='M9-T-D11'
assert judge['passed'] is True and len(judge['checks'])==8 and all(x['pass'] for x in judge['checks'])
assert cleanup['allClear'] and raw['appExit']['code']==0 and raw['appExit']['signal'] is None and raw['observedProcess']['signals']==[] and raw['cleanupErrors']==[]
assert not OUT.exists();OUT.mkdir(mode=0o700)
endpoints=set(raw.get('exactGatewayPaths',[]));redactions=[]
def redact(value,path=''):
 if isinstance(value,list):return [redact(x,path+'[]') for x in value]
 if isinstance(value,dict):return {k:redact(v,path+'.'+k) for k,v in value.items() if k not in {'env','environment','runtimeSnapshot','secretValues','tokenMap','auth','credentials'}}
 if isinstance(value,str):
  for endpoint in endpoints:
   if endpoint in value:value=value.replace(endpoint,'<private-owned-gateway>');redactions.append(dict(path=path,kind='owned-gateway'))
  value,n=re.subn(r'wss?://(?:127\.0\.0\.1|localhost):\d+/[^\s"<>]+','<private-owned-debug-endpoint>',value)
  if n:redactions.append(dict(path=path,kind='debug-endpoint',count=n))
 return value
safe=pick(raw,['case','layer','status','startedAt','finishedAt','driverPid','project','projectId','labels','sourceManifestSha256','asarSha256','checks','taskBindings','restorations','exits','screenshots','screenshotRecords','cleanupErrors','formalIncrement','boundary','before','after','start','final','rendererRecovery','dev092Before','rendererFault','knownAContents','rendererErrors','caseResults','trace','appExit','observedProcess','finalA','knownPids','knownPorts','knownPageIds'])
safe['taskByLabel']={}
for label,t in raw['taskByLabel'].items():
 row=pick(t,['ptyId','profileId','health','readiness','runId','receiverPid']);row['task']=pick(t.get('task',{}),['id','title','projectId','ptyId','runner','archivedAt','recovery','recoveryReason']);row['actualPlanArchived']=False;safe['taskByLabel'][label]=row
safe['instances']=[]
for instance in raw['instances']:
 row=pick(instance,['index','actions','initialFocus','startedAt','appPid','projectId','tasksBefore','observerInstallResult','initialRpcTrace','reloadCount','windowTitle','initialForeground','focusGuard','focusGuards','controlReadiness','finalRpcTrace','appCleanup','appExit','observedProcess','rendererErrors'])
 row['tasksAfter']=[pick(t,['id','projectId','ptyId','title','recovery','recoveryReason']) for t in instance.get('tasksAfter',[])];safe['instances'].append(row)
safe['taskCleanup']=[{**pick(t,['label','taskId','ptyId','receiverPid','before','killReturned']),'after':pick(t.get('after',{}),['id','projectId','ptyId','recovery','recoveryReason'])} for t in raw['taskCleanup']]
safe=redact(safe,'raw');safe['sourceOriginal']=ref(ROOT/'raw.json');safe['projectionBoundary']='Synthetic document/save/checkpoint/draft and identity evidence only; no full runtimeSnapshot/env/auth, userData/DB/cache or resolved transport endpoints. Controlled own renderer crash is separate from normal App exit.';safe['redactions']=redactions
save('raw.safe.json',safe)
c=pick(cleanup,['at','scope','processes','ports','helpers','allClear','originalNormalExit','originalHarness','systemGeneralWasAttempted','clipboardRestoration']);c['unix']=[{'socketAbsent':x['socket']['absent'],'parentAbsent':x['parent']['absent'],'category':'exact-owned-gateway'} for x in cleanup['unix']];c['sourceOriginal']=ref(ROOT/'cleanup.json');save('cleanup.safe.json',redact(c,'cleanup'))
for name in ['judgement.json','root-review.json','static-review.json','execution-started.json','initial-foreground-attempt-21216.json']:
 original(ROOT/name,name)
# Preserve all41 actual local frozen inputs;154 dependency/binary/external inputs stay exact SHA/mode references.
for row in inputs['inputs']:
 if row.get('external') or Path(row['path']).is_absolute():continue
 p=ROOT/row['path'];assert sha(p)==row['sha256'] and stat.S_IMODE(p.stat().st_mode)==row['mode'];original(p,'frozen-inputs/'+row['path'])
for name in ['manifest.json','execution-ready.json','execution-ready.before-root-static-binding.json']:
 original(ROOT/name,'frozen-inputs/'+name)
original(Path(__file__),'project-safe-D11.py')
for shot in raw['screenshotRecords']:
 p=ROOT/'runtime-001'/shot['name'];assert sha(p)==shot['sha256'] and p.stat().st_size==shot['bytes'];original(p,'screenshots/'+shot['name'])
for name in ['A.txt','B.txt','C.txt']:
 p=ROOT/'runtime-001/project'/name;assert sha(p)==raw['after'][name]['sha256'];original(p,'synthetic-final-project/'+name)
for p in [ROOT/'live.json',ROOT/'runtime-001/electron.private.log',*sorted((ROOT/'runtime-001').glob('task-binding-*.private.jsonl'))]:ref(p,'Private raw/transport/binding descriptor log not archived; exact whole-file reference only')
old_refs=[]
for name in ['manifest.json','result.safe.json','judgement.json']:
 p=PUBLIC/name
 if p.exists():old_refs.append(ref(p,'Already public original cont003 failed D11/valid other-case scope; do not overwrite or relabel'))
assert (PUBLIC/'manifest.json').exists()
save('prior-cont003-reference.json',dict(privateRoot='/private/tmp/willyou-m12-t130-task-tabs-App035-A-cont-003',publicArchive=str(PUBLIC),references=old_refs,originalFailurePreserved=True,completedD08D10D18NotReplayed=True))
save('root-image-review.supplement.json',dict(source='Root explicit current task message; actual view_image review, no fabricated TAP/tool stdout',image='screenshots/D11-new-instance-draft-retained.png',sha256=raw['screenshotRecords'][0]['sha256'],observed=['current T1','A.txt present with dirty marker','NEW instance independent draft visible','unresolved draft strip remains'],boundary='Only this business screenshot observation; not a full visual-comparison pass'))
save('result.safe.json',dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),case='M12-T130/originalM9-D11',App='installedApp036/source040',status='originalD11-one-A-check-eight-criteria-passed-Root-review',actual=review['actual'],static=review['static'],cleanupTool=review['cleanup'],judgeTool=review['judge'],checks=judge['checks'],rendererFault=pick(raw['rendererFault'],['crash','origin','currentOrigin','boundary','before','after']),identityBeforeAfter=review['originalTargetIdentityBeforeAfter'],newRef=raw['checks'][0]['newCheckpoint']['ref'],newDraft=raw['checks'][0]['newCheckpoint']['checkpoint'],newDraftText=raw['checks'][0]['newDraftText'],newDraftRetained=raw['checks'][0]['newTabRetained'],normalAppExit=raw['appExit'],AppSignals=raw['observedProcess']['signals'],independentAllClear=cleanup['allClear'],cleanupCounts=dict(PID=len(cleanup['processes']),TCP=len(cleanup['ports']),Unix=len(cleanup['unix'])),RootCleanupInvocationBoundary=review['rootCleanupInvocationError'],scope='Only original D11 A, own renderer crash FI with same main/WC/window/target and unchanged2task/PTYS/run/receivers; held genuine saved native OLD reply, independent NEW ref/draft retained. No model/auth, fullT130 claim or replay of completed other cases.',formalIncrement=0,publicLedgerModified=False,resourcesHeld=[]))
save('input-and-private-references.json',dict(frozenManifest=ref(ROOT/'manifest.json'),localCopiedInputCount=sum(not x.get('external') and not Path(x['path']).is_absolute() for x in inputs['inputs']),externalInputs=[x for x in inputs['inputs'] if x.get('external') or Path(x['path']).is_absolute()],nodeModulesLinks=load(ROOT/'execution-ready.json').get('links',[]),wholeFileReferences=list(refs.values()),notArchived=['App/binaries','home/userData/DB/auth','full environment/runtime/transport','node_modules/cache'],boundary='Actual shared dependencies remain by original exact SHA/mode/link; local driver/observer/UI/fixture sources fully recoverable. No new testing during projection.'))
save('member-provenance.json',dict(members=provenance,sourceOriginalsUnmodified=True))
for p in OUT.rglob('*'):
 if not p.is_file():continue
 data=p.read_bytes();assert not p.is_symlink() and p.suffix not in {'.db','.sqlite','.asar','.dmg','.node','.dylib'}
 for endpoint in endpoints:assert endpoint.encode() not in data,'Resolved gateway leaked'
files=[dict(path=str(p.relative_to(OUT)),sha256=sha(p),bytes=p.stat().st_size,mode=stat.S_IMODE(p.stat().st_mode)) for p in sorted(OUT.rglob('*')) if p.is_file()]
save('manifest.json',dict(schema='M12-safe-delivery-v1',at=datetime.datetime.now(datetime.timezone.utc).isoformat(),group='M12-T130-D11-App036-A001',files=files,passedOriginalCriteria=8,formalIncrement=0,resourcesHeld=[],publicLedgerModified=False))
print(json.dumps(dict(safeRoot=str(OUT),manifestSHA256=sha(OUT/'manifest.json'),members=len(files),provenanceSHA256=sha(OUT/'member-provenance.json'),formalIncrement=0,resourcesHeld=[]),ensure_ascii=False))
