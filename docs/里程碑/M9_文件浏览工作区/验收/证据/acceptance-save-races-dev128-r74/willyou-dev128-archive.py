from pathlib import Path
import datetime,gzip,hashlib,io,json,platform,plistlib,shutil,subprocess,tarfile
r=Path('/Users/hx/hx/hxWork/SmartDD');s=r/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();read=lambda p:json.loads(Path(p).read_text());now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
previous=s/'验收/证据/m9-acceptance-directory-anchor-dev127-r73-20261019.json'
assert sha(previous)=='29e84868926aa17843e14670b1e5423f7818b1ad0a7a32977d975336d434bec7';old=read(previous)
for a in old['artifacts'].values():assert sha(r/a['path'])==a['sha256']
assert read(s/'验收/用例覆盖索引.json')==read(b/'willyou-dev128-index-before.json')
code=read(b/'willyou-dev128-matrix-regression-final.json');assert code['success'] and (code['numPassedTests'],code['numFailedTests'],code['numPendingTests'])==(86,0,0)
red=read(b/'willyou-dev128-code-r1.json');assert not red['success'] and (red['numPassedTests'],red['numFailedTests'])==(1,1)
initial=read(b/'willyou-dev128-code-verified.json');assert initial['numPendingTests']==8
native=read(b/'willyou-dev128-native-matrix-final.json');assert len(native['rows'])==11
specs=[('app-crash-red-r73','failed',0,False),('app-crash-red-r73-r2','failed',1,False),('app-crash-r74-r1','passed',4,False),('app-crash-r74-r2','passed',4,True),('app-race-r74-r1','failed',2,False),('app-race-r74-r2','passed',6,True),('app-normal-r74-r1','passed',8,True),('app-capacity-r74-r1','passed',6,True)]
entries=[];known=set();nativePids=set();normalExits=[]
for label,status,count,selected in specs:
 summary=read(b/('willyou-dev128-'+label+'.log'));directory=Path(summary['artifacts']);app=read(directory/'result.json');assert app['status']==status and len(app['checks'])==count
 if app.get('sourceHashesAfter'):assert app['sourceHashes']==app['sourceHashesAfter']
 known.update(app.get('pids',[]))
 if app.get('pid'):known.add(app['pid'])
 frames=app.get('runs') or [app]
 for frame in frames:
  if frame.get('pid'):known.add(frame['pid'])
  if frame.get('rpcRestored'):assert all(frame['rpcRestored'].values())
  for row in frame.get('rpc',{}).get('rows',[]):
   if row.get('delivered'):assert row['before']==row['after']
  if frame.get('watch'):
   assert frame['watch']['restored'] and all(not x['waiting'] and x['delivered'] and x['before']==x['after'] for x in frame['watch']['rows'])
  if frame.get('native'):
   assert frame['native']['restored'] and all(x['closed'] for x in frame['native']['rows']);nativePids.update(x['pid'] for x in frame['native']['rows'])
  if selected:
   assert frame['exit']['code']==0 and frame['exit']['signal'] is None;normalExits.append(frame['exit'])
 for key in ['failureNative','native']:
  if app.get(key):
   assert app[key]['restored'] and all(x['closed'] for x in app[key]['rows']);nativePids.update(x['pid'] for x in app[key]['rows'])
 if app.get('fault'):assert not Path(app['fault']['marker']).exists()
 if selected:assert all(x['pass'] for x in app['checks'])
 entries.append({'label':label,'directory':directory,'app':app,'selected':selected})
assert len(normalExits)==11
redApp=entries[1]['app'];assert redApp['currentInspection']['phase']=='swapped'
observed=redApp['currentInspection'];assert observed['before']['journal']['state']=='prepared' and 'exchanged' not in observed['before']['journal']
assert next(x for x in observed['ui']['materials'] if x['kind']=='displaced').get('hash') is None
assert observed['before']['materials']['displaced']['text'].startswith('BASE race recovery')
capacity=entries[-1]['app'];environment=capacity['environment'];assert environment['detached'] and environment['capacityBytes']<=80*1024*1024
assert sorted(x['mode'] for x in capacity['checks'])==['disk-full','disk-full','generic','generic','permission','permission']
currentMounts=plistlib.loads(subprocess.check_output(['hdiutil','info','-plist']))
ownImages=[x for x in currentMounts.get('images',[]) if x.get('image-path')==environment['image']]
assert not ownImages
prefixes=['/private/tmp/willyou-save-race-',environment['base'],'/private/tmp/willyou-dev128-native-test-helper','willyou-m9-acceptance-batch-r74-build/mac-arm64/WillYou.app/Contents/Resources/native/willyou-files']
for row in native['rows']:
 if row.get('nativePid'):nativePids.add(row['nativePid'])
 for writer in row.get('externalWriters',{}).get('writers',[]):known.add(writer['pid'])
live=[];reused=[]
for line in subprocess.check_output(['/bin/ps','-A','-o','pid=,ppid=,stat=,command='],text=True).splitlines():
 parts=line.strip().split(None,3)
 if len(parts)!=4:continue
 pid=int(parts[0]);owned=any(prefix in parts[3] for prefix in prefixes)
 if owned:live.append({'pid':pid,'command':parts[3]})
 elif pid in known|nativePids:reused.append({'pid':pid,'reusedOrUnrelatedCommand':True})
assert not live,live
audit={'at':now(),'knownAppAndWriterPids':sorted(known),'knownNativeStopPids':sorted(nativePids),'ownedPrefixes':prefixes,'ownedMatches':live,'pidReusedWithoutActing':reused,'allOwnProcessesClosed':True,'finalSelectedNormalExits':normalExits,'failedCleanupNotNormalQuit':True,'ownImage':environment['image'],'ownImageDetached':True,'ownImagesCurrentlyMounted':[]}
(b/'willyou-dev128-process-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
prior=read(b/'willyou-m9-acceptance-batch-r73-dev127-tested-sources.json');build=read(b/'willyou-m9-acceptance-batch-r74-build-sources.json');assert len(prior['files'])==1181 and len(build['files'])==1183
assert build['changedFromPrevious']==['src/main/core/files/recovery-store.ts']
newCode=['scripts/files/save-crash-recovery-ui.mjs','scripts/files/save-race-writer-ui.mjs','scripts/files/save-race-writer.py','scripts/files/save-race-writers.mjs','scripts/files/save-race-writers.d.mts','src/main/core/files/save-race-recovery-acceptance.test.ts']
assert set(subprocess.check_output(['rg','--files','src','native','scripts'],cwd=r,text=True).splitlines())-set(prior['files'])==set(newCode)
extraDoc='docs/真实App自动验收流程.md';files={p:sha(r/p) for p in set(prior['files'])|set(newCode)|{extraDoc}}
changedPrior=sorted(p for p,h in prior['files'].items() if files[p]!=h)
assert changedPrior==['docs/里程碑/M9_文件浏览工作区/技研/开发前_08_保存与恢复.md','src/main/core/files/recovery-store.ts']
changedBuild=sorted(p for p,h in build['files'].items() if files[p]!=h)
assert changedBuild==['docs/里程碑/M9_文件浏览工作区/技研/开发前_08_保存与恢复.md','scripts/files/save-crash-recovery-ui.mjs','src/main/core/files/save-race-recovery-acceptance.test.ts']
assert sha(b/'willyou-dev128-red-recovery-store.ts')==prior['files']['src/main/core/files/recovery-store.ts']
prefix=b/'willyou-m9-acceptance-batch-r74-dev128-tested-sources';tarpath=prefix.with_suffix('.tar.gz');manifestpath=prefix.with_suffix('.json');assert not tarpath.exists() and not manifestpath.exists()
with tarpath.open('xb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as compressed:
  with tarfile.open(fileobj=compressed,mode='w|',format=tarfile.PAX_FORMAT) as tar:
   for p,h in sorted(files.items()):
    path=r/p;data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==h
    e=tarfile.TarInfo(p);e.size=len(data);e.mode=path.stat().st_mode&0o777;e.mtime=int(path.stat().st_mtime);tar.addfile(e,io.BytesIO(data))
m={'at':now(),'path':str(tarpath),'sha256':sha(tarpath),'files':files,'fileCount':len(files),'branch':build['branch'],'head':build['head'],'previousManifest':str(b/'willyou-m9-acceptance-batch-r73-dev127-tested-sources.json'),'buildManifest':str(b/'willyou-m9-acceptance-batch-r74-build-sources.json'),'changedFromPrevious':changedPrior,'newVerificationFiles':newCode,'newDocumentationFiles':[extraDoc],'changedAfterBuild':changedBuild,'addedAfterBuild':sorted(set(files)-set(build['files'])),'productionInputsUnchangedAfterBuild':True}
assert len(files)==1188;manifestpath.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
resources=b/'willyou-m9-acceptance-batch-r74-build/mac-arm64/WillYou.app/Contents/Resources'
hashes=read(b/'willyou-dev128-r74-hashes.json');assert sha(resources/'app.asar')==hashes['asarSha256'] and sha(resources/'native/willyou-files')==hashes['brokerSha256']
assert read(b/'willyou-dev128-runtime-r74.json')['verified']==82
watcher=read(b/'willyou-dev128-watcher-r74.json');assert watcher['sha256']==old['app']['watcherSha256']
smokes=[json.loads(line) for line in (b/'willyou-dev128-package.log').read_text().splitlines() if line.startswith('{"version"')][-1]
assert all(smokes[k]=='passed' for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
out=s/'验收/证据/acceptance-save-races-dev128-r74';report=s/'验收/证据/m9-acceptance-save-races-dev128-r74-20261019.json';assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
def copy(p,label):
 p=Path(p);target=out/label;target.parent.mkdir(parents=True,exist_ok=True)
 if p.suffix=='.json' and p.stat().st_size>1024*1024:
  original=p.read_bytes();target=target.with_name(target.name+'.gz');data=gzip.compress(original,mtime=0)
  if target.exists():assert target.read_bytes()==data
  else:target.write_bytes(data)
  artifacts[str(target.relative_to(out))]={'path':str(target.relative_to(r)),'sha256':sha(target),'encoding':'gzip','uncompressedSha256':hashlib.sha256(original).hexdigest()}
 else:
  if target.exists():assert sha(target)==sha(p)
  else:shutil.copy2(p,target)
  artifacts[label]={'path':str(target.relative_to(r)),'sha256':sha(target)}
for p in sorted(b.glob('willyou-dev128-*')):
 if p.is_file() and p.suffix in ['.json','.log','.py','.mjs','.cjs','.stderr','.ts']:copy(p,p.name)
for p in [manifestpath,tarpath,b/'willyou-m9-acceptance-batch-r74-build-sources.json',b/'willyou-m9-acceptance-batch-r74-build-sources.tar.gz']:copy(p,p.name)
for entry in entries:
 directory=entry['directory']
 for p in sorted(directory.iterdir()):
  if p.is_file() and p.suffix in ['.json','.jsonl','.log','.png','.mm','.plist']:copy(p,'runs/'+directory.name+'/'+p.name)
 for writerDir in sorted(directory.glob('writers-*')):
  for p in sorted(writerDir.glob('*.json')):copy(p,'runs/'+directory.name+'/'+writerDir.name+'/'+p.name)
relay=Path(environment['base'])/'willyou-files-relay';assert sha(relay)==environment['wrapperSha256'];copy(relay,'runs/'+Path(environment['base']).name+'/relay-source.py')
notes='''Y02 original scope/steps/expected. Current macOS26.6.1arm64 passes86 selected unique code tests (11 new I, existing native59/recoveryI8/dialogU4/save-windowI4), typecheck, new r74 six native smokes/82 runtime files, and24 final App array checks (fault-writers6, normal8, true native kill plus normal restart4, real OS failures6). Final selected App normal exits11; prior generic successes/partial failures are retained but not counted again.
Known base conflict refuses before native save and keeps local checkpoint. Final-check before-swap path writer preserves currentL/displacedD/draftL. At swapped, two separate Python processes released by the same gate write an fd acquired before exchange and the new pathname (in-place or atomic replacement). Both run while native is paused; this does not claim their CPU instructions are literally simultaneous. CurrentD/displacedE/draftL remain, materialized is D for in-place or L for replacement. Conflicts preserve recoveryId, no implicit second swap; hot replay and blocked new-op calls leave materials unchanged and native-save count unchanged. Autosave3200ms representative probe is dual-replace in both themes; other conflict variants use the same real conflict/dirty guard and no extra native commit, not a claimed3200ms probe for every row.
Native kill at prepared/swapped yields unknown service receipt; durable journal staysprepared without exchanged. Red native1pass1fail and old r73 actual App normal restart showed physicalB retained but UI unavailable. RecoveryStore.inspect now recognizes candidate as old target only with registered transactionIdentity/baseRevision and real base dev/ino; equal bytes on a different prepared inode are a negative control. Old-fd content changes remain visible/changed. Inspection never modifies historical state, receipt, source or recovery data or replays/rolls back. Actual protected UI close and same-userData full-process restart show independentL/current/displaced/materialized with per-case unique contents and target-record/full-hash ready checks. Hot unknown receipt is exactly cached; cold prepared journal has no persisted terminal receipt, so returns consistentunknown/opId/recoveryId rather than claiming identical diagnostic text. Changed payload is IDEMPOTENCY. Repeated inspection/closure/restarts leave recorded identities/mtime/hash unchanged.
After returned saved receipt, old fd writesE only to retained displaced inode; targetL stays intact, originalsaved receipt remains historical, UI recovery showsE withchanged. No infinite-fd-lifetime safe reclamation or system-wide CAS guarantee. Normal control saves exact bytes/history; original saved response is held unchanged while actual newer inputL2/checkpoint occurs, then old receipt preservesL2dirty and a second actualCtrl-S savesL2. Programmatic replay/denials are explicit idempotence substeps, not UI save replacements. Original auth/request/result bytes and handler identities remain, restored after tests.
Project/global512MiB/2GiB capacity tested through original recovery.reserve valid intended-candidate reservations, no disk allocation/fake journal. App physical capacity tested separately with actual ENOSPC on own64MiBAPFS plus0500parent and4096-byte native RLIMIT_FSIZE EFBIG. Original targetunchanged on refusal, local draft retained, explicit edit clears old error and actual retry exact. Own image detached and currenthdiutil image-path match empty; host disk never filled.
Failures retained: first App attempted normalquit with protecteddirty buffer and was correctly blocked; driver now uses actual explicit protectedclose beforequit and proves unresolved materials stay. First race App passed2 then observed empty/transitioning recovery panel after switching records; strengthened to per-case unique data and target-record/all-material hash readiness, retaining assertions. Initial selected code run omitted opt-in helper and skipped8; proper current helper enabled, final86zero skip. Earlier generic-data App4passed retained as prior evidence, strengthened current4restarted for fresh record binding. Read-only diagnostic probes that assumed missing JSON keys affected no App operation. These driver/setup failures are not product fixes.
Only production change RecoveryStore.inspect physical-role recovery. Native source/binary, renderer/prototype/style/dependencies/budgets unchanged.1183build and1188final snapshot including6new verificationfiles and shared-flow doc; afterbuild only2verificationfiles+save contract changed and4verificationfiles+flow doc added. Production inputs byte-identical to r74 build. Shared guide records fixture reuse and record/hash waiting. No new P/fullpixel/systemIME/clipboard/model/dailyresources/crossplatform claim. Prior41artifacts unchanged. Formal237/41956.56%,180unexecuted2blocked,179remaining A. Other cases retained, no release/merge/tag/push.
'''
p=out/'execution-boundaries.txt';p.write_text(notes);artifacts[p.name]={'path':str(p.relative_to(r)),'sha256':sha(p)}
d={'schemaVersion':1,'id':'M9-ACCEPTANCE-SAVE-RACES-DEV128-R74','at':now(),'localDate':'2026-10-19','status':'passed-scoped-macos-case','revision':'R3.4/R3.4-P1; original Y02 scope retained','branch':m['branch'],'head':m['head'],'platform':platform.platform(),'architecture':platform.machine(),'fullCasesPassed':['M9-T-Y02'],'productionChanges':['src/main/core/files/recovery-store.ts'],'prototypeChanges':[],'defects':[{'id':'DEV128-D01','description':'After actual swap and native exit, prepared journal without exchanged hides real retained base inode from recovery inspection','status':'fixed-and-reverified','red':'native1/1 plus originalr73 App normal restart missingdisplacedB','green':'new I physical recovery including equal-bytes/new-inode negative plus r74 actual normal restarts'}],'app':{'path':str(resources.parent.parent),'version':smokes['version'],**hashes,'watcherSha256':watcher['sha256'],'runtimeAssetsVerified':82,'nativeChecksCurrent':['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'],'published':False},'previousReport':{'path':str(previous.relative_to(r)),'sha256':sha(previous),'all41ArtifactsUnchanged':True},'sourceBaseline':{'previousTestedFiles':1181,'buildFiles':1183,'testedSnapshotFiles':1188,'changedFromPrevious':changedPrior,'newVerificationFiles':newCode,'newDocumentationFiles':[extraDoc],'changedAfterBuild':changedBuild,'addedAfterBuild':m['addedAfterBuild'],'productionInputsUnchangedAfterBuild':True,'testedTarSha256':m['sha256'],'buildTarSha256':build['sha256']},'verification':{'currentCodePassed':86,'newUniqueCodeTests':11,'newTestsByBoundary':{'I':11},'currentSkipped':0,'currentTypecheckExit':0,'actualAppScenarios':24,'faultWriterApp':6,'normalWriterAndReceiptApp':8,'realNativeInterruptionRestartApp':4,'realOsFailureApp':6,'finalNormalExits':normalExits,'fullProcessRestarts':4,'autosaveTimedProbe':'dual-replace3200ms, boththemes','ownImagesDetached':1,'formalPassed':237,'formalTotal':419,'formalRemaining':182,'unexecuted':180,'blocked':2,'appRemaining':179},'boundaries':[native['boundary'],notes],'artifacts':artifacts}
report.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(report.relative_to(r)),'sha256':sha(report),'artifacts':len(artifacts),'testedFiles':1188,'testedTarSha256':m['sha256'],'formalPassedAfterUpdate':237,'percentage':round(237/419*100,2)},ensure_ascii=False))
