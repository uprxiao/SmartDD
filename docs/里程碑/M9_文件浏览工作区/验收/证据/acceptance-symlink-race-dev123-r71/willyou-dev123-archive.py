from pathlib import Path
import datetime,gzip,hashlib,json,platform,shutil,tarfile
r=Path('/Users/hx/hx/hxWork/SmartDD');s=r/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
previous=s/'验收/证据/m9-acceptance-cross-owner-dev122-r70-20261019.json'
assert sha(previous)=='91fac351e2c11b476b1aa80e0b384219691eedd646af858208c2a85bb5af75e7'
old=json.loads(previous.read_text())
for a in old['artifacts'].values():assert sha(r/a['path'])==a['sha256']
build=json.loads((b/'willyou-m9-acceptance-batch-r71-build-sources.json').read_text())
tested=json.loads((b/'willyou-m9-acceptance-batch-r71-dev123-tested-sources.json').read_text())
prior=json.loads((b/'willyou-m9-acceptance-batch-r70-dev122-tested-sources.json').read_text())
assert len(build['files'])==1162 and len(tested['files'])==1163 and tested['changedFromPrevious']==[] and tested['addedFiles']==['scripts/files/symlink-race-ui.mjs']
assert build['changedFromPrevious']==['scripts/files/text-save-failure-fixture.mjs','src/main/core/files/native-broker.ts']
for m in [build,tested]:
 assert sha(m['path'])==m['sha256']
 for p,h in m['files'].items():assert sha(r/p)==h,p
 with tarfile.open(m['path']) as tar:
  assert len(tar.getmembers())==len(m['files'])
  for e in tar.getmembers():assert hashlib.sha256(tar.extractfile(e).read()).hexdigest()==m['files'][e.name]
unchanged=sum(tested['files'][p]==h for p,h in prior['files'].items());assert unchanged==1154
assert json.loads((s/'验收/用例覆盖索引.json').read_text())==json.loads((b/'willyou-dev123-index-before.json').read_text())
code=json.loads((b/'willyou-dev123-code-audit.json').read_text());assert code['uniqueCurrentPassed']==140 and all(x['status']=='passed' for x in code['current'])
native=json.loads((b/'willyou-dev123-native-final.json').read_text());assert len(native['rows'])==13
for x in native['rows']:
 if x.get('authorizedInodeMovedOutside'):assert not x['outsideAuthorizedInodeChanged'] and x['canaryUnchanged'] and x['held']['hash']==x['expectedBase']
red=json.loads((b/'willyou-dev123-native-r1.json').read_text());assert any(x.get('outsideAuthorizedInodeChanged') for x in red['rows'])
assert len(json.loads((b/'willyou-dev123-confinement-experiment.json').read_text())['rows'])==13
runs=[]
for name,expected in [('app-normal-r1',None),('app-normal-r2',12),('app-late-r1',None),('app-late-r2',2),('app-conflict-r1',20),('app-diff-r1',16),('app-save-failure-r1',6)]:
 summary=json.loads((b/('willyou-dev123-'+name+'.log')).read_text().splitlines()[-1]);directory=Path(summary['artifacts']);app=json.loads((directory/'result.json').read_text());runs.append((name,directory,app))
 if expected is not None:
  assert app['status']=='passed' and len(app['checks'])==expected and all(x['pass'] for x in app['checks'])
  assert app['exit']['code']==0 and app['exit']['signal'] is None and all(app['rpcRestored'].values())
  for x in app['rpc']['rows']:
   if x.get('delivered'):assert x['before']==x['after']
 if name=='app-late-r2':
  assert app['spawn']['restored'] and all(x['closed'] for x in app['spawn']['rows'])
  for x in app['checks']:
   assert x['stop']['frames'][-1]['event']=='test-stop' and x['failed']['output']['state']=='failed'
   assert 'Operation not permitted' in x['failed']['output']['message']
 if name=='app-save-failure-r1':assert app['environment']['detached'] and app['sourceHashes']['asarSha256']==app['asarSha256']
hashes=json.loads((b/'willyou-dev123-bundle-hashes.json').read_text());resources=Path(hashes['app'])/'Contents/Resources'
assert sha(resources/'app.asar')==hashes['asarSha256'] and sha(resources/'native/willyou-files')==hashes['brokerSha256']==old['app']['brokerSha256']
assert json.loads((b/'willyou-dev123-watcher-r71.json').read_text())['sha256']==hashes['watcherSha256']==old['app']['watcherSha256']
assert json.loads((b/'willyou-dev123-runtime-r71.json').read_text())['verified']==82
assert json.loads((b/'willyou-dev123-process-audit.json').read_text())['allClosed']
package=(b/'willyou-dev123-package.log').read_text();assert all('"'+x+'":"passed"' in package for x in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
out=s/'验收/证据/acceptance-symlink-race-dev123-r71';report=s/'验收/证据/m9-acceptance-symlink-race-dev123-r71-20261019.json';assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
def copy(p,label):
 target=out/label;target.parent.mkdir(parents=True,exist_ok=True)
 if Path(p).suffix=='.json' and Path(p).stat().st_size>1024*1024:
  original=Path(p).read_bytes();target=target.with_name(target.name+'.gz');data=gzip.compress(original,mtime=0)
  if target.exists():assert target.read_bytes()==data
  else:target.write_bytes(data)
  artifacts[str(target.relative_to(out))]={'path':str(target.relative_to(r)),'sha256':sha(target),'encoding':'gzip','uncompressedSha256':hashlib.sha256(original).hexdigest(),'uncompressedBytes':len(original)}
 else:
  if target.exists():assert sha(target)==sha(p)
  else:shutil.copy2(p,target)
  artifacts[label]={'path':str(target.relative_to(r)),'sha256':sha(target)}
for p in sorted(b.glob('willyou-dev123-*')):
 if p.is_file() and p.suffix in ['.json','.log','.py','.mjs','.cjs','.ts','.stderr']:copy(p,p.name)
for prefix in ['willyou-m9-acceptance-batch-r71-build-sources','willyou-m9-acceptance-batch-r71-dev123-tested-sources']:
 for ext in ['json','tar.gz']:copy(b/(prefix+'.'+ext),prefix+'.'+ext)
for name,directory,app in runs:
 for p in sorted(directory.iterdir()):
  if p.is_file() and p.suffix in ['.json','.log','.png','.mm','.jsonl']:copy(p,'runs/'+directory.name+'/'+p.name)
notes='''M04 original I/A scope/steps/expected unchanged. Formal232/41955.37%,185unexecuted2blocked,184remaining with A. No release.
Product red: last userspace guard followed by parent moved outside allowed old descriptor exchange to update the moved-out authorized inode; outside new-link canary stayed unchanged, receiptunknown did not satisfy M04. Literal outside-inode B assertion retained. Kernel file-write policy experiment13green, then production save/copy invoke sandbox-exec with static profile and opaque root/recovery parameters, shellfalse, selected copy destination only. Native identity/revision/recovery retained, missing/failed launcher or policy fails closed with no unconfined retry. Current macOS26.6.1arm64 only; system launcher/custom Seatbelt policy is not a durable supported third-party API, SDK deprecated, future compatibility limited. No other-platform or system CAS claim.
Native I13: three layouts(target,parent-inside,parent-outside) x read/save after metadata6; exact same native source/existing macro prepared/before-swap6; valid control1. Parent-outside inode B/canary unchanged after fix, B/L materials retained. Other late races still unknown, no blind rollback/delete. Prepared transaction moved outside by adversary is not a new App write outside after the move. Current140 unique code pass:24newU+13newI, prior17 authority/controller/owner, ordinary native59, real-save integration27. Initial12(11pass1fail), experiment13, stale receipt assertion33/1, and fake cancellation fixture53/1 preserved. Receipt expectation updated only for kernel-blocked parent-outside failed vs oldunknown; formal no-outside-write expected unchanged. Fake cancellation corrected with synthetic pid/mocked process.kill, no real OS signal from unit.
r71 source main changed, package rebuilt; native broker/watcher source+binary unchanged.1162build,1163tested sources; only external A driver added after build. Prior1156:1154 unchanged, two changed are NativeBroker and explicit H09 relay test telemetry. Six current native smokes,82runtime assets,three bundle hashes,typecheck0. Prototype code/styles zerochange; prior P243/sharedcore16/build/Sites4 not a fresh fullpixel run.
Actual App56: normal packaged original metadata/save timing gates12; precise late parent-outside2 in own COW clone originalASAR plus existing macro stop guard augmented only by private read-only marker; conflict20,diff16,real OS save failures6. Original auth/request/results unchanged, original spawn/stdout passively delegated and restored. Native lastguard->host rename outside/link->SIGCONT gives genuine EPERMfailed. Held original inode and outsidecanary unchanged; dirtyL/exactB-base draft retained, actual pathrestore and actualCtrlS retry rawCRLF/Chinese/emoji exact. Actual tree/input/save/retry; no store/editor/DOM-value injection, fabricated replies, externalApp/clipboard/models/dailycredentials/physicalIME claim. H09 transparent relay only telemetry relocated to original authorized recoveryroot, no policy widening. Own64MiBAPFS detached, five successful normal exits0/null, failed cleanup separately recorded, six known App PIDs plus native PIDs/prefixes closed; markers removed/observers restored.
First normal A driver asserted before error UI painted; explicit visible condition added, rejection assertion not changed. First late compile lacked -I native include, corrected only compiler path. Initial node syntax typo corrected before execution, no nonexistent historical syntax artifact claimed. Failures preserved. Viewed late dark denial screenshot only, no full Codex/reference/pixel/Windows claim. M11,H20,X03/system/manual/reference/platform still open, all419 remain required.
'''
p=out/'execution-boundaries.txt';p.write_text(notes);artifacts[p.name]={'path':str(p.relative_to(r)),'sha256':sha(p)}
value={'schemaVersion':1,'id':'M9-ACCEPTANCE-SYMLINK-RACE-DEV123-R71','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localDate':'2026-10-19','status':'passed-one-case','revision':'R3.4 / R3.4-P1; M04 original scope/steps/expected unchanged','branch':tested['branch'],'head':tested['head'],'platform':platform.platform(),'architecture':platform.machine(),'fullCasesPassed':['M9-T-M04'],'productionChanges':['src/main/core/files/native-broker.ts','src/main/core/files/write-confinement.ts'],'prototypeChanges':[],'defects':[{'id':'M9-DEV123-OUTSIDE-WRITE','status':'fixed-and-retested','finding':'Old descriptor exchange could update authorized inode moved outside after final path guard.','fix':'Kernel-scoped save/copy writes, no unsafe fallback.','limits':'Current macOS only; custom system policy compatibility can change, fail closed.'}],'app':{**hashes,'path':hashes['app'],'version':'0.0.5','published':False,'runtimeAssetsVerified':82,'nativeChecksCurrent':['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher']},'previousReport':{'path':str(previous.relative_to(r)),'sha256':sha(previous),'all29ArtifactsUnchanged':True},'sourceBaseline':{'previousTestedFiles':1156,'buildFiles':1162,'testedFiles':1163,'buildSha256':build['sha256'],'finalTestedSha256':tested['sha256'],'priorSourceFilesUnchanged':unchanged,'changedFromPrior':build['changedFromPrevious'],'addedAtBuild':build['addedFiles'],'postBuildChanges':tested['changedFromPrevious'],'postBuildAddedFiles':tested['addedFiles']},'verification':{'currentCodePassedUnique':140,'newUniqueCodeTests':37,'newTestsByBoundary':{'U':24,'I':13},'currentSkipped':0,'unhandledErrors':0,'currentTypecheckExit':0,'nativeRaceRows':13,'nativeBrokerRegressionPassed':59,'saveIntegrationRegressionPassed':27,'newActualAppChecks':14,'actualAppRegressionChecks':42,'actualAppChecksTotal':56,'normalQuitRuns':[a['exit'] for n,p,a in runs if a['status']=='passed'],'knownAppPidsClosed':6,'formalPassed':232,'formalTotal':419,'formalRemaining':187,'unexecuted':185,'blocked':2,'appRemaining':184},'boundaries':[native['boundary'],notes],'artifacts':artifacts}
report.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(report.relative_to(r)),'sha256':sha(report),'artifacts':len(artifacts),'formalPassed':232,'percentage':round(232/419*100,2)},ensure_ascii=False))
