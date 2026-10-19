from pathlib import Path
import datetime,gzip,hashlib,io,json,platform,re,shutil,subprocess,tarfile

r=Path('/Users/hx/hx/hxWork/SmartDD');s=r/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
read=lambda p:json.loads(Path(p).read_text())
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
previous=s/'验收/证据/m9-acceptance-case-volume-dev125-r72-20261019.json'
assert sha(previous)=='3e5ad2f3787656641a3f8d07ace79aa6eba11c1facd7a6662c50e5db866ccdb1'
old=read(previous)
for a in old['artifacts'].values():assert sha(r/a['path'])==a['sha256']
assert read(s/'验收/用例覆盖索引.json')==read(b/'willyou-dev126-index-before.json')
code=read(b/'willyou-dev126-code-verified-final.json');reg=read(b/'willyou-dev126-native-regression-final.json')
for d,n in [(code,4),(reg,59)]:assert d['success'] and (d['numPassedTests'],d['numFailedTests'],d['numPendingTests'])==(n,0,0)
native=read(b/'willyou-dev126-native-verified-final.json');assert len(native['rows'])==4
for row in native['rows']:
 assert row['reloadedReceipt']==row['receipt']==row['replay']
 if row['phase']=='swapped':assert row['receipt']['kind']=='overwritten-after-commit' and row['receipt']['state']=='conflict'
apps=[]
for name,count,normal in [('app-fault-r1',6,False),('app-normal-r1',4,True),('symlink-regression-r1',12,None)]:
 summary=read(b/('willyou-dev126-'+name+'.log'));directory=Path(summary['artifacts']);app=read(directory/'result.json')
 assert app['status']=='passed' and len(app['checks'])==count and all(x['pass'] for x in app['checks'])
 assert app['exit']['code']==0 and app['exit']['signal'] is None and all(app['rpcRestored'].values())
 assert app['sourceHashes']==app['sourceHashesAfter']
 for row in app['rpc']['rows']:
  if row.get('delivered'):assert row['before']==row['after']
 if normal is not None:
  assert app['normal']==normal and app['watch']['restored']
  assert all(not x['waiting'] and x['delivered'] and x['before']==x['after'] for x in app['watch']['rows'])
 if app.get('native'):assert app['native']['restored'] and all(x['closed'] for x in app['native']['rows'])
 if app.get('fault'):assert not Path(app['fault']['marker']).exists()
 apps.append((directory,app))
known={app['pid'] for _,app in apps}
known.update(x['pid'] for _,app in apps for x in app.get('native',{}).get('rows',[]))
known.update(x['writer']['pid'] for _,app in apps for x in app['checks'] if x.get('writer'))
known.update(x['externalWriter']['pid'] for x in native['rows'] if x.get('externalWriter'))
processes=subprocess.check_output(['/bin/ps','-A','-o','pid=,ppid=,stat=,command='],text=True)
prefixes=[str(p) for p,_ in apps]+['/private/tmp/willyou-save-window-native-','/private/tmp/willyou-save-window-build-','/private/tmp/willyou-git-filter-probe-']
matches=[]
for line in processes.splitlines():
 parts=line.strip().split(None,3)
 if len(parts)==4 and (int(parts[0]) in known or any(prefix in parts[3] for prefix in prefixes)):matches.append(line)
assert not matches,matches
audit={'at':now(),'knownPids':sorted(known),'prefixes':prefixes,'matches':matches,'allClosed':True,'normalQuits':[app['exit'] for _,app in apps],'faultMarkerRemoved':True,'nativeTraceAllClosed':True,'rpcWatchObserversRestored':True,'noUserResourcesTouched':True}
(b/'willyou-dev126-process-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
build=read(b/'willyou-m9-acceptance-batch-r73-build-sources.json');prior=read(b/'willyou-m9-acceptance-batch-r72-dev125-tested-sources.json')
assert len(build['files'])==1178
expectedChanges={'native/files/broker.mm','src/main/core/files/native-broker.test.ts','src/main/core/files/recovery-store.ts','src/shared/files.ts'}
assert set(build['changedFromPrevious'])==expectedChanges and len(build['addedFiles'])==3 and not build['removedFromPrevious']
for path,h in build['files'].items():assert sha(r/path)==h,path
contract='docs/里程碑/M9_文件浏览工作区/技研/开发前_08_保存与恢复.md'
contractText=(r/contract).read_text().split('## DEV126 提交与回读的保证范围',1)[1]
for required in ['应用内提交','已持有旧fd','回读前','整文件替换','回读完成之后','不提供操作系统级跨进程CAS','无限fd寿命']:assert required in contractText,required
assert not re.search(r'(绝不|永不).{0,20}丢失.{0,10}外部修改',contractText)
files=dict(build['files']);files[contract]=sha(r/contract)
prefix=b/'willyou-m9-acceptance-batch-r73-dev126-tested-sources';tarpath=prefix.with_suffix('.tar.gz');manifestpath=prefix.with_suffix('.json')
assert not tarpath.exists() and not manifestpath.exists()
with tarpath.open('xb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as compressed:
  with tarfile.open(fileobj=compressed,mode='w|',format=tarfile.PAX_FORMAT) as tar:
   for path,h in sorted(files.items()):
    p=r/path;data=p.read_bytes();assert hashlib.sha256(data).hexdigest()==h,path
    e=tarfile.TarInfo(path);e.size=len(data);e.mode=p.stat().st_mode&0o777;e.mtime=int(p.stat().st_mtime);tar.addfile(e,io.BytesIO(data))
manifest={'createdAt':now(),'branch':build['branch'],'head':build['head'],'path':str(tarpath),'sha256':sha(tarpath),'files':files,'fileCount':len(files),'buildManifest':str(b/'willyou-m9-acceptance-batch-r73-build-sources.json'),'buildManifestSha256':sha(b/'willyou-m9-acceptance-batch-r73-build-sources.json'),'changedFromBuild':[],'addedAfterBuild':[contract],'productionInputsUnchangedAfterBuild':True,'previousManifest':str(b/'willyou-m9-acceptance-batch-r72-dev125-tested-sources.json'),'changedFromPrevious':sorted(expectedChanges),'addedFromPrevious':sorted(set(files)-set(prior['files']))}
manifestpath.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
resources=Path(apps[1][1]['sourceApp'])/'Contents/Resources';hashes=read(b/'willyou-dev126-bundle-hashes.json')
assert sha(resources/'app.asar')==hashes['asarSha256'] and sha(resources/'native/willyou-files')==hashes['brokerSha256']
assert hashes['runtimeAssetsVerified']==read(b/'willyou-dev126-runtime-r73.json')['verified']==82
assert hashes['watcherSha256']==read(b/'willyou-dev126-watcher-r73.json')['sha256']
smokes=[json.loads(line) for line in (b/'willyou-dev126-package.log').read_text().splitlines() if line.startswith('{"version"')][-1]
assert all(smokes[k]=='passed' for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
out=s/'验收/证据/acceptance-save-windows-dev126-r73';report=s/'验收/证据/m9-acceptance-save-windows-dev126-r73-20261019.json'
assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
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
for p in sorted(b.glob('willyou-dev126-*')):
 if p.is_file() and p.suffix in ['.json','.log','.py','.mjs','.cjs','.stderr','.ts']:copy(p,p.name)
for p in [manifestpath,tarpath,b/'willyou-m9-acceptance-batch-r73-build-sources.json',b/'willyou-m9-acceptance-batch-r73-build-sources.tar.gz']:copy(p,p.name)
for directory,app in apps:
 for p in sorted(directory.iterdir()):
  if p.is_file() and p.suffix in ['.json','.log','.png','.mm']:copy(p,'runs/'+directory.name+'/'+p.name)
notes='''L15/Y03 only. The I4 plus normal A4/private native-stop A6 all pass on current macOS 26.6.1 arm64. Additional normal M04 A12 regression passes, totaling22 current App array checks. 59 native regressions plus4 new I tests=63 unique code tests, no new U or full-suite claim. Typecheck exit0, new r73 package six real native smokes and82 runtime resources verified. Source1178 build inputs and1179 final sources differ only by the documented contract addition;3 production files changed from previous, plus one Git test fixture and3 verification files. Prototype/style source unchanged; no current full-pixel or system/IME/platform claim.
Red I3/1 genuinely found missing overwritten-after-commit receipt classification. Native now reports that optional kind only for the actual swapped-candidate post-read hash mismatch; shared receipt and strict recovery journal schema retain it. Reloaded native recovery receipts and same-op replay are equal, with old no-kind receipts still accepted by the new reader; no downgrade-compatibility claim. The original conflict/unknown/material policy remains, no automatic rollback/delete. Before-swap competing writer produces currentL/displacedD/localDraftL; swapped pre-read writer produces currentD/displacedB/draftL and explicit kind. Real UI keeps local source, protected recovery, dirty footer and pauses autosave beyond3200ms, original changed watch deliveries later resume unchanged. Programmatic replay is explicitly the idempotence substep, not a replacement for UI saves.
After post-read write at recorded phase, saved revision is previous L though physical path is already D; releasing original watch refreshes clean buffer to D. The normal unmodified native/ASAR A4 separately tests writes after returned save, both clean auto-refresh and new-local-edit conflict; explicit UI continueEditing/Ctrl-S saves exact local bytes. No promise of system-wide CAS, unconditional external-edit preservation or indefinite old-FD lifetime collection. Whole candidate is prepared/synced before atomic same-volume exchange; arbitrary external writers themselves are not made atomic by the App.
Fault A is a private COW clone of r73: original ASAR/auth/requests/results, native source compiled with existing TEST macro, only stop guard also reads own marker. At native before-swap/swapped/recorded phases a separate Python process directly opens/truncates/writes/fsyncs the owned target. Original watch events are held/released unmodified to distinguish receipt from later refresh. No store/editor/DOM-value or authorization injection, fake replies, daily project/credentials, clipboard, model, external application or historical Codex access.
Retain failures: initial typecheck source-import alias then async drafts Promise adapter fixed in verification test only. Native regression58/1 was a nondeterministic Git fixture: changed file size lets even the old r72 binary return modified without calling clean conversion. Own old-binary probe preserves index/no helper execution for both sizes. Final test uses same-sized changed content and unprotected benign own helper control with fsmonitor disabled to force/assert the filter path; original protected rejection/index checks remain, native Git production unchanged. Final native59 and I4 passed, no rejected expectation removed. Red original test source retained; older intermediate tests are not additional unique passes.
Three App normal exits0/null, original RPC/watch/native observation restored and all known private App/native/writer PIDs/prefixes absent. Fault marker removed. Cleanup is distinct from business recovery assertions; synthetic recovery materials remain verifiable in JSON hashes but no userData/DB/whole App archived. Previous DEV125 artifacts unchanged. L15 and Y03 complete; Y01/Y02 remain unexecuted as full cases, M05 X remains missing Windows/Linux/other Mac architecture. Formal235/41956.09%,182unexecuted2blocked,181remaining A. No scope/steps/expected/budget alteration, release, branch merge, tag or push.
'''
p=out/'execution-boundaries.txt';p.write_text(notes);artifacts[p.name]={'path':str(p.relative_to(r)),'sha256':sha(p)}
appMetadata={**hashes,'path':str(resources.parent.parent),'version':smokes['version'],'published':False,'nativeChecksCurrent':['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher']}
value={'schemaVersion':1,'id':'M9-ACCEPTANCE-SAVE-WINDOWS-DEV126-R73','at':now(),'localDate':'2026-10-19','status':'passed-scoped-macos-cases','revision':'R3.4 / R3.4-P1; L15/Y03 original scope retained','branch':build['branch'],'head':build['head'],'platform':platform.platform(),'architecture':platform.machine(),'fullCasesPassed':['M9-T-L15','M9-T-Y03'],'notCompletedByThisBatch':['M9-T-Y01','M9-T-Y02','M9-T-M05'],'productionChanges':['native/files/broker.mm','src/main/core/files/recovery-store.ts','src/shared/files.ts'],'testFixtureChange':'src/main/core/files/native-broker.test.ts: same-size content plus benign own-helper control; original denial retained','prototypeChanges':[],'defects':[{'id':'DEV126-D01','description':'Missing overwritten-after-commit receipt kind after post-exchange pre-read external path write','status':'fixed-and-reverified','red':'I3pass1fail','green':'I4pass and private fault A6 plus normal A4'}],'app':appMetadata,'previousReport':{'path':str(previous.relative_to(r)),'sha256':sha(previous),'all65ArtifactsUnchanged':True},'sourceBaseline':{'previousTestedFiles':1175,'buildFiles':1178,'testedFiles':1179,'buildTarSha256':build['sha256'],'testedTarSha256':manifest['sha256'],'productionInputsUnchangedAfterBuild':True,'addedAfterBuild':[contract],'changedFromPrevious':sorted(expectedChanges),'addedFromPrevious':manifest['addedFromPrevious']},'verification':{'currentCodePassed':63,'currentNativeRegressions':59,'newUniqueCodeTests':4,'newTestsByBoundary':{'I':4},'currentSkipped':0,'currentTypecheckExit':0,'nativeRows':4,'actualAppScenarios':22,'preciseFaultApp':6,'normalPostReadApp':4,'normalPathRegressionApp':12,'normalQuits':[app['exit'] for _,app in apps],'formalPassed':235,'formalTotal':419,'formalRemaining':184,'unexecuted':182,'blocked':2,'appRemaining':181},'boundaries':[native['boundary']]+[app['boundary'] for _,app in apps]+[notes],'artifacts':artifacts}
report.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'report':str(report.relative_to(r)),'sha256':sha(report),'artifacts':len(artifacts),'testedFiles':1179,'testedTarSha256':manifest['sha256'],'formalPassedAfterCaseUpdate':235,'percentage':round(235/419*100,2)},ensure_ascii=False))
