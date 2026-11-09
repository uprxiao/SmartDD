#!/usr/bin/python3
"""File-only privacy projection and lossless safe-record deduplication for F18."""
from pathlib import Path
import copy, datetime, hashlib, json, re, shutil, stat

ROOT=Path(__file__).parent
OUT=ROOT/'safe-delivery-001'
GEN=Path('/private/tmp/willyou-m12-t130-F18-App035-A-cont-002')
def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1048576),b''):h.update(block)
    return h.hexdigest()
def load(path):return json.loads(Path(path).read_text())
def encoded(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def save(name,value):
    p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
refs={};provenance=[]
def ref(path,scope='Whole immutable private source file hash; original bytes unchanged'):
    p=Path(path);key=str(p)
    if key not in refs:refs[key]={'path':key,'sha256':sha(p),'bytes':p.stat().st_size,'mode':stat.S_IMODE(p.stat().st_mode),'scope':scope}
    return refs[key]
def original(path,name):
    p=Path(path);q=OUT/name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
    assert sha(p)==sha(q)
    provenance.append({'member':name,'transformation':'original bytes','source':ref(p)})

assert not OUT.exists(),'Never overwrite an existing frozen delivery'
raw=load(ROOT/'raw.json');judge=load(ROOT/'judgement.json');cleanup=load(ROOT/'cleanup.json')
review=load(ROOT/'root-independent-wrapper-and-fourcase-review.json')
oracle=load(ROOT/'fixtures/fixtures.json');ready=load(ROOT/'execution-ready.json')
keys=['light-xlsx','light-xlsm','dark-xlsx','dark-xlsm']
assert [x['key']for x in raw['checks']]==keys and len(raw['checks'])==4
assert len(judge['checks'])==9 and all(x['pass']for x in judge['checks']) and judge['passed']
assert len(raw['rpc']['rows'])==68 and len(raw['workerTrace']['rows'])==4
assert all(x['exitCode']==1 and len(x['terminates'])==1 for x in raw['workerTrace']['rows'])
assert raw['appExit']=={'pid':95813,'code':0,'signal':None} and raw['observedProcess']['signals']==[]
assert raw['cleanupErrors']==[] and cleanup['allClear'] and review['allClear']
assert all(x['absent']for x in cleanup['processes']+cleanup['ports'])
assert all(x['socket']['absent']and x['parent']['absent']for x in cleanup['unix'])
assert all(x['absent']for x in review['wrapperDriverAwake'])
assert raw['before']==raw['after'] and len(raw['before'])==2
assert raw['tasksBefore']==[] and raw['tasksAfter']==[]
for row in ready['inputs']:
    p=Path(row['path'])if row.get('external')else ROOT/row['path']
    assert sha(p)==row['sha256']and stat.S_IMODE(p.stat().st_mode)==row['mode'],str(p)

# Only self-owned source leases and self-owned transport strings are inspected.
# No DB, credential files, daily instance, process memory or network are read.
secret_keys={'lease','activeCapability','sourceRef','token','runToken','capabilityToken','endpointPath'}
excluded_values=set();redactions=[]
def collect(value):
    if isinstance(value,dict):
        for key,v in value.items():
            if key in secret_keys and isinstance(v,str):excluded_values.add(v)
            collect(v)
    elif isinstance(value,list):
        for v in value:collect(v)
collect(raw)
transports=set(raw.get('exactGatewayPaths',[]))
log=ROOT/'runtime-001/electron.private.log'
if log.exists():transports.update(re.findall(r'wss?://[^\s\"<>]+',log.read_text()))
def clean(value,path=''):
    if isinstance(value,dict):
        result={}
        for key,v in value.items():
            if key in secret_keys:
                result[key]={'redacted':True,'category':'owned-source-authority-or-transport'}
                redactions.append({'path':path+'/'+key,'category':'owned-source-authority-or-transport'})
            else:result[key]=clean(v,path+'/'+key)
        return result
    if isinstance(value,list):return[clean(v,path+'/'+str(i))for i,v in enumerate(value)]
    if isinstance(value,str):
        for item in excluded_values|transports:
            if item and item in value:value=value.replace(item,'<private-owned-authority-or-transport>')
        return value
    return value

OUT.mkdir()
records=[];record_index={};snapshots=[];snapshot_index={}
def rpc_id(row):
    safe=clean(row,'rpc');body=encoded(safe);key=hashlib.sha256(body).hexdigest()
    if key not in record_index:
        record_index[key]='rpc-'+str(len(records)+1).zfill(4)
        records.append({'id':record_index[key],'safeRecordSHA256':key,'record':safe})
    else:assert encoded(next(x['record']for x in records if x['id']==record_index[key]))==body
    return record_index[key]
def snapshot_id(value,source_pointer):
    ids=[rpc_id(row)for row in value['rpc']['rows']]
    safe={'rpcRecordIds':ids,'worker':clean(value['worker'],'worker')}
    key=hashlib.sha256(encoded(safe)).hexdigest()
    if key not in snapshot_index:
        snapshot_index[key]='snapshot-'+str(len(snapshots)+1).zfill(3)
        snapshots.append({'id':snapshot_index[key],'safeSnapshotSHA256':key,'sourcePointers':[source_pointer],**safe})
    else:
        next(x for x in snapshots if x['id']==snapshot_index[key])['sourcePointers'].append(source_pointer)
    # Exact sanitized value can be reconstructed; no row is omitted or inferred.
    reconstructed={'rpc':{'rows':[next(x['record']for x in records if x['id']==rid)for rid in ids]},'worker':safe['worker']}
    assert reconstructed=={'rpc':clean(value['rpc'],'rpc'),'worker':clean(value['worker'],'worker')}
    return snapshot_index[key]

top_omitted={'checks','latestObserverSnapshot','rpc','workerTrace','resources','exactGatewayPaths'}
safe_raw=clean({k:v for k,v in raw.items()if k not in top_omitted},'raw')
safe_raw['checks']=[]
for i,c in enumerate(raw['checks']):
    snapshot_names={'observerSnapshot','observedBeforeMacro','observedBeforeClose'}
    item=clean({k:v for k,v in c.items()if k not in snapshot_names},'case/'+c['key'])
    for name in snapshot_names:
        if name in c:item[name+'Ref']=snapshot_id(c[name],'/checks/'+str(i)+'/'+name)
    safe_raw['checks'].append(item)
safe_raw['latestObserverSnapshotRef']=snapshot_id(raw['latestObserverSnapshot'],'/latestObserverSnapshot')
safe_raw['globalRpcRecordIds']=[rpc_id(x)for x in raw['rpc']['rows']]
safe_raw['workerTrace']=clean(raw['workerTrace'],'workerTrace')
safe_raw['resources']=[{'at':x['at'],'processes':x['processes'],'helpers':clean(x['helpers']),
                         'listenerTextArchived':False,'originalListenerRecordRetainedByRawSHA':True}for x in raw['resources']]
safe_raw['transportCount']=len(raw.get('exactGatewayPaths',[]))
safe_raw['sourceOriginal']=ref(ROOT/'raw.json')
safe_raw['projectionBoundary']='Complete four original observations/models plus losslessly indexed safe snapshots. Original68RPC record order and every per-case snapshot row retained; only owned source authority/complete transport removed. Not full private raw, not a new business run.'
save('raw.safe.json',safe_raw)
save('rpc-records.safe.json',{'records':records,'globalActualRpcCount':68,'safeRecordVersions':len(records),
     'meaning':'Deduplicated whole safe RPC records; original existing input/output hashes retained. Any distinct in-flight/captured variant remains its own record.'})
save('snapshots.safe.json',{'snapshots':snapshots,'reconstruction':'For each snapshot, expand ordered rpcRecordIds using rpc-records.safe.json, keep the complete worker value; SHA covers normalized safe rpc IDs+worker. Source JSON pointers identify original immutable raw.'})
safe_cleanup={k:copy.deepcopy(v)for k,v in cleanup.items()if k not in['unix','helpers']}
safe_cleanup['sourceOriginal']=ref(ROOT/'cleanup.json')
safe_cleanup['unix']=[{'ordinal':i+1,'socketAbsent':x['socket']['absent'],'parentAbsent':x['parent']['absent']}
                      for i,x in enumerate(cleanup['unix'])]
safe_cleanup['helpers']=[]
save('cleanup.safe.json',safe_cleanup)

# Copy original private-owned nonsecret input bytes, not runtime trees or Apps.
input_refs=[]
for row in ready['inputs']:
    p=Path(row['path'])if row.get('external')else ROOT/row['path']
    if row.get('external')or row['path'].startswith('node_modules/'):
        input_refs.append({**row,'resolvedPath':str(p.resolve()),'scope':'External currentApp/tool binary or shared frozen TypeScript/ws; SHA/mode only, no bytes copied'})
    else:original(p,'frozen-inputs/'+row['path'])
for name in ['execution-ready.json','manifest.json','static-review.json','final-ready-binding.json',
             'initial-foreground-authorization.receipt.json','lease.receipt.json']:
    original(ROOT/name,'frozen-inputs/'+name)
for name in ['judgement.json','root-independent-wrapper-and-fourcase-review.json','root-two-image-review.json','execution-started.json']:
    original(ROOT/name,name)
for name in raw['screenshots']:
    p=ROOT/'runtime-001'/name;row=next(x for x in raw['screenshotRecords']if x['name']==name)
    assert sha(p)==row['sha256'];b=p.read_bytes();assert b[:8]==bytes.fromhex('89504e470d0a1a0a')
    assert int.from_bytes(b[16:20],'big')==row['width']and int.from_bytes(b[20:24],'big')==row['height']
    original(p,'images/'+name)

# Keep the new input generator and its pure Python closure recoverable too.
# These are public synthetic input materials, not real credential/runtime data.
generation_manifest=load(GEN/'manifest.json')
for row in generation_manifest['files']:
    p=GEN/row['path'];assert sha(p)==row['sha256']and stat.S_IMODE(p.stat().st_mode)==row['mode']
    original(p,'fixture-generation-inputs/'+row['path'])
original(GEN/'manifest.json','fixture-generation-inputs/manifest.original.json')
original(GEN/'generation-result.json','fixture-generation-inputs/generation-result.json')
original(GEN/'fixtures-v2/manifest.json','fixture-generation-inputs/actual-fixture-manifest.json')
original(Path(__file__),'project-safe.py')
for p in [ROOT/'raw.json',ROOT/'live.json',ROOT/'cleanup.json',log]:
    if p.is_file():ref(p)
save('external-inputs-by-sha.json',{'inputs':input_refs,'dependencySymlink':{'path':'node_modules',
    'target':str((ROOT/'node_modules').readlink()),'realpath':str((ROOT/'node_modules').resolve())},
    'boundary':'No App/native/binary/shareddependency payload copied. Existing frozen Node dependencies retain exact151 source file hashes and actual link chain; not a dependency on retired App bytes.'})
save('private-source-references.json',{'references':list(refs.values()),'wholeFileHashesOnly':True,
    'notArchived':['App/DMG/native executables','DB/auth/Cookie/WAL/SHM','full private raw/live/electron log or environment',
                   'complete transport endpoints','own source lease values','runtime/cache trees'],
    'publicFixtureBoundary':'Archived XLSX8882B is explicit v2, not old8802B. Archived XLSM13796B is the exact original ApachePOI fixture with realVBA; it was never executed or opened in external Office.'})
save('member-provenance.json',{'members':provenance,'allCopiedMembersOriginalBytes':True,'privateOriginalsUnmodified':True})
save('result.safe.json',{
    'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'case':'M12-T130','subcases':['M9-T-F18'],'layer':'A only',
    'status':'original-four-current-App-A-observations-complete','keys':keys,'actual':{'tool':'50184e','session':86713,
    'driverPID':raw['driverPid'],'AppPID':raw['appPid'],'toolExitCode':0,'seconds':19.2,'source':'Rootactualreceipt'},
    'sourceManifestSHA256':raw['sourceManifestSha256'],'asarSHA256':raw['asarSha256'],
    'sourceVersion':'App035/source039','originalJudgement':{'path':'judgement.json','checks':9,'passed':True,'sha256':sha(ROOT/'judgement.json')},
    'sourceFiles':oracle['files'],'originalMacroNotExecuted':True,'oldXlsx8802BRecovered':False,
    'actualNewXlsx8882B':True,'fullModelAndSnapshots':'raw.safe.json + rpc-records.safe.json + snapshots.safe.json',
    'actualRPC':68,'actualWorkers':[{'threadId':x['threadId'],'explicitTerminateCount':len(x['terminates']),
                                  'threadExitCode':x['exitCode'],'exitedAt':x['exitedAt']}for x in raw['workerTrace']['rows']],
    'workerBoundary':'All4 actual Worker threads were explicitly terminated and emitted thread exit1. This is not an OS process failure or an all-zero-thread-exit claim.',
    'AppNormalExit':raw['appExit'],'AppObservedSignals':raw['observedProcess']['signals'],
    'observerRestored':{'constructor':raw['observerRestored']['constructorRestored'],'globalDeleted':raw['observerRestored']['globalDeleted'],
                         'RPC':raw['observerRestored']['rpc']},
    'sourceStatHashModeBeforeAfterMatched':raw['before']==raw['after'],'tasksBefore':0,'tasksAfter':0,'modelsRun':0,
    'independentCleanup':{'PID':len(cleanup['processes']),'TCP':len(cleanup['ports']),'Unix':len(cleanup['unix']),'allClear':cleanup['allClear']},
    'wrapperAwakeDriver':review['wrapperDriverAwake'],'actualInitialStableMs':review['initialStableMs'],
    'images':raw['screenshotRecords'],'RootVisualReview':'root-two-image-review.json',
    'visualBoundary':'Rootoriginal-resolution review retained. Complete merge/UIText/model checked; visible CJK merge label may clip to column width. Actual Calibri compatibility-width warning remains; no glyph-font or pixel-parity claim.',
    'oldInputGapCorrection':'Original absent byte/SHA gap and explicit correction retained in frozen-inputs/original and fixture-generation-inputs. HistoricalSHA was not a new business requirement.',
    'formalIncrement':0,'wholeT130Passed':False,'publicLedgerModified':False,'resourcesHeld':False})
for p in OUT.rglob('*'):
    if not p.is_file():continue
    b=p.read_bytes();assert not p.is_symlink()
    assert p.suffix not in ['.dmg','.asar','.db','.sqlite','.node','.dylib'],p
    for value in excluded_values|transports:
        if value:assert value.encode()not in b,'Owned authority/transport leaked: '+str(p)
    assert not re.search(rb'wss?://(?:127\.0\.0\.1|localhost):\d+/[0-9a-f-]{16,}',b),p
save('projection-audit.json',{'method':'Purefile explicit safe projection, source-authority redaction before whole-record SHA dedup; every distinct record version and original percase snapshot reconstructable',
     'redactionCategories':['owned-source-lease/capability fields','complete Unix/debug transport strings'],
     'redactedOccurrences':len(redactions),'globalRPCCount':68,'safeRecordVersions':len(records),'safeSnapshots':len(snapshots),
     'exactPerSnapshotReconstructionValidated':True,'allMemberAuthorityTransportLeakScanPassed':True,
     'privateSourceRawSHA256':sha(ROOT/'raw.json'),'noAuthDBOrDailyDataRead':True,'noNativeNodeAppUIExecuted':True,
     'sourceOriginalsUnmodified':True,'formalIncrement':0,'resourcesHeld':False})
files=[{'path':str(p.relative_to(OUT)),'bytes':p.stat().st_size,'sha256':sha(p),'mode':stat.S_IMODE(p.stat().st_mode)}
       for p in sorted(OUT.rglob('*'))if p.is_file()]
save('manifest.json',{'schema':'M12-F18-current-A-safe-v1','files':files,'case':'M12-T130/F18','source':'App035/source039',
     'original4AComplete':True,'original9JudgePassed':True,'formalIncrement':0,'resourcesHeld':False,
     'sourceExecutionReadySHA256':sha(ROOT/'execution-ready.json')})
print(json.dumps({'safeRoot':str(OUT),'members':len(files),'manifestSHA256':sha(OUT/'manifest.json'),
                  'actualRPC':68,'safeRPCRecordVersions':len(records),'safeSnapshots':len(snapshots),
                  'formalIncrement':0,'resourcesHeld':False}))
