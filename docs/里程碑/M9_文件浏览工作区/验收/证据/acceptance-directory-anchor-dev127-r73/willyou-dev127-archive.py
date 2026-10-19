from pathlib import Path
import datetime,gzip,hashlib,io,json,platform,shutil,subprocess,tarfile
r=Path('/Users/hx/hx/hxWork/SmartDD');s=r/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();read=lambda p:json.loads(Path(p).read_text());now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
previous=s/'验收/证据/m9-acceptance-save-windows-dev126-r73-20261019.json';assert sha(previous)=='8e674fabf787dd907c152893e2ded33ebbe78204337feb913e15bb283f359575';old=read(previous)
for a in old['artifacts'].values():assert sha(r/a['path'])==a['sha256']
assert read(s/'验收/用例覆盖索引.json')==read(b/'willyou-dev127-index-before.json')
code=read(b/'willyou-dev127-code-final.json');assert code['success'] and (code['numPassedTests'],code['numFailedTests'],code['numPendingTests'])==(9,0,0)
native=read(b/'willyou-dev127-native-final.json');assert len(native['rows'])==5 and all(x['pass'] for x in native['rows'])
apps=[]
for label,status,count in [('chain-r1','passed',4),('root-r1','failed',1),('root-r2','passed',2)]:
 summary=read(b/('willyou-dev127-app-'+label+'.log'));directory=Path(summary['artifacts']);app=read(directory/'result.json');assert app['status']==status and len(app['checks'])==count
 assert app['sourceHashes']==app['sourceHashesAfter'] and all(app['rpcRestored'].values()) and app['watch']['restored']
 for row in app['rpc']['rows']:
  if row.get('delivered'):assert row['before']==row['after']
 assert all(not x['waiting'] and x['delivered'] and x['before']==x['after'] for x in app['watch']['rows'])
 if app.get('native'):assert app['native']['restored'] and all(x['closed'] for x in app['native']['rows'])
 if app.get('fault'):assert not Path(app['fault']['marker']).exists()
 if status=='passed':assert app['exit']['code']==0 and app['exit']['signal'] is None and all(x['pass'] for x in app['checks'])
 apps.append((directory,app))
for row in apps[-1][1]['checks']:
 assert row['invalidation']['at']>=row['replacedAt'] and row['renewed']['at']>=row['restoredAt'] and row['saved']['at']>=row['restoredAt']
 assert row['saved']['args'][0]['ref']==row['renewed']['output']['ref'] and '[UNTRUSTED]' in row['oldRefError']
assert apps[1][1]['state']['footer']=='已保存' and not apps[1][1]['state']['alerts']
initial=(b/'willyou-dev127-chain-r1-source.mjs').read_text();current=(r/'scripts/files/directory-anchor-ui.mjs').read_text();a="\n  if(mode==='root'){\n";z="\n  }else if(c.phase==='before-read'){\n";strip=lambda t:t[:t.index(a)]+t[t.index(z):];assert strip(initial)==strip(current)
known={app['pid'] for _,app in apps};known.update(row['pid'] for _,app in apps for row in app.get('native',{}).get('rows',[]))
matches=[]
for line in subprocess.check_output(['/bin/ps','-A','-o','pid=,ppid=,stat=,command='],text=True).splitlines():
 parts=line.strip().split(None,3)
 if len(parts)==4 and (int(parts[0]) in known or '/private/tmp/willyou-directory-anchor-' in parts[3]):matches.append(line)
assert not matches,matches
audit={'at':now(),'knownPids':sorted(known),'ownedPrefix':'/private/tmp/willyou-directory-anchor-','matches':matches,'allClosed':True,'normalQuits':[app['exit'] for _,app in apps if app['status']=='passed'],'failedRunIsCleanupOnly':True,'faultMarkerRemoved':True,'rpcWatchNativeObserversRestored':True,'chainCodeUnchangedAcrossRootOnlyDriverCorrections':True}
(b/'willyou-dev127-process-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
prior=read(b/'willyou-m9-acceptance-batch-r73-dev126-tested-sources.json');files=dict(prior['files']);assert len(files)==1179
for p,h in files.items():assert sha(r/p)==h,p
added=['scripts/files/directory-anchor-ui.mjs','src/main/core/files/directory-anchor-acceptance.test.ts']
assert set(subprocess.check_output(['rg','--files','src','native','scripts'],cwd=r,text=True).splitlines())-set(files)==set(added)
files.update({p:sha(r/p) for p in added});prefix=b/'willyou-m9-acceptance-batch-r73-dev127-tested-sources';tarpath=prefix.with_suffix('.tar.gz');manifestpath=prefix.with_suffix('.json');assert not tarpath.exists() and not manifestpath.exists()
with tarpath.open('xb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as compressed:
  with tarfile.open(fileobj=compressed,mode='w|',format=tarfile.PAX_FORMAT) as tar:
   for p,h in sorted(files.items()):
    path=r/p;data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==h
    e=tarfile.TarInfo(p);e.size=len(data);e.mode=path.stat().st_mode&0o777;e.mtime=int(path.stat().st_mtime);tar.addfile(e,io.BytesIO(data))
m={'at':now(),'path':str(tarpath),'sha256':sha(tarpath),'branch':prior['branch'],'head':prior['head'],'files':files,'fileCount':1181,'previousManifest':str(b/'willyou-m9-acceptance-batch-r73-dev126-tested-sources.json'),'previousManifestSha256':sha(b/'willyou-m9-acceptance-batch-r73-dev126-tested-sources.json'),'priorSourceFilesUnchanged':1179,'changedFromPrevious':[],'addedFiles':added,'productionAndPrototypeChanges':[],'buildReused':'r73','chainRunExactSource':str(b/'willyou-dev127-chain-r1-source.mjs'),'chainRunSourceSha256':sha(b/'willyou-dev127-chain-r1-source.mjs'),'rootRunFinalSourceSha256':sha(r/added[0]),'chainBodyAndOtherCodeUnchangedByRootOnlyDriverFixes':True};manifestpath.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
assert read(b/'willyou-dev127-runtime-r73.json')['verified']==82
appMeta=old['app'];resources=Path(appMeta['path'])/'Contents/Resources';assert sha(resources/'app.asar')==appMeta['asarSha256'] and sha(resources/'native/willyou-files')==appMeta['brokerSha256'];assert read(b/'willyou-dev127-watcher-r73.json')['sha256']==appMeta['watcherSha256']
out=s/'验收/证据/acceptance-directory-anchor-dev127-r73';report=s/'验收/证据/m9-acceptance-directory-anchor-dev127-r73-20261019.json';assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
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
for p in sorted(b.glob('willyou-dev127-*')):
 if p.is_file() and p.suffix in ['.json','.log','.py','.mjs','.cjs','.stderr']:copy(p,p.name)
for p in [manifestpath,tarpath]:copy(p,p.name)
for directory,app in apps:
 for p in sorted(directory.iterdir()):
  if p.is_file() and p.suffix in ['.json','.log','.png','.mm']:copy(p,'runs/'+directory.name+'/'+p.name)
notes='''Y01 original a/b/file chain retained, I5 and actual A6 passed on macOS26.6.1arm64. Two exact existing native TEST stops prepared/before-swap run current production invocation policy. Rename a to held-a inside the trusted root, replace a with outside symlink. Prepared verifies/rejects before exchange, originalB intact; before-swap commits completeL only through the held b directory, displacedB/materializedL/independentdraftL remain, post-commit path check returns explicit unknown and UI recovery/dirty rather than silent saved. Outside directory recursive names/mode/inode/mtime/content fingerprints remain identical, including sentinel; no newly created outside object. This inside-root held-dir case does not weaken DEV123/126 protections for an original parent moved outside the trusted root.
An outside directory symlink present before initial native chain opening is rejected OUTSIDE_ROOT; actual App original read chain also rejects after original metadata is held/released unmodified, then original path restore and UI retry readsB. Already-open metadata is not claimed to have been acquired through the bad link. Real roots service whole-root replacement tests both read/save, comparesdev/ino and revokes both owners' old leases; independent local checkpoint remains readable, originalB/new unrelatedD/outside sentinel unchanged.
Normal packaged A2 actual root replacement gets original native rootInvalidated event after each replacement timestamp, old-ref originalIPC read is UNTRUSTED, localL/durablecheckpoint retained. Actual root retry refuses different physical replacement without write. Restore original physical root, actual retry produces current-operation fresh lease/ref; real Ctrl-S original receipt and exact CRLF/emoji bytesL verified. The programmatic old-ref negative request and private draft verification are explicit checks, not substitutes for positive UI saves. Private COW fault A4 uses original ASAR/auth/requests/results, only same-source existing test guard plus own marker and original watch event hold/release. Two passing App runs normalexit0/null, all own App/native PIDs/prefixes closed, marker absent and observers restored.
Failure retained: root A first light scenario passed and dark source was actually saved (normal DOM footer and original RPC saved plus diskL), but the renewal predicate selected a previous light lease. The test timed out and was recorded failed, no normal-quit claim for cleanup. Corrected only the driver current restoration timestamp and exact documentID/ref filters; final normal A2 both passed with original assertions. Chain run exact source retained; all code outside the root-only branch is byte-identical to final driver, including complete chain scenario/setup/cleanup, so no unrelated chain rerun needed. Two read-only inspection scripts assumed a historical missing key and read an independently running verifier output too early; these produced no App operation/result and were corrected sequentially, not classified as product failures.
Current code9 unique=5 new native I plus4 existing root-invalidation U regressions; typecheck passed. Previous1179source hashes all identical, add2 verification files=1181final tested sources. No production/prototype/dependency/budget/acceptance scope change and no rebuild. Reused r73 ASAR/broker/watcher byte-identical;82runtime files and watcher freshly verified, prior six native package smokes retained by hash rather than reported newly run. No full pixel, physicalIME, clipboard, external resource or platform completion claim. Formal236/41956.32%,181unexecuted2blocked,180remaining A; Y02 and M05X etc remain open. No release/merge/tag/push.
'''
p=out/'execution-boundaries.txt';p.write_text(notes);artifacts[p.name]={'path':str(p.relative_to(r)),'sha256':sha(p)}
d={'schemaVersion':1,'id':'M9-ACCEPTANCE-DIRECTORY-ANCHOR-DEV127-R73','at':now(),'localDate':'2026-10-19','status':'passed-scoped-macos-case','revision':'R3.4/R3.4-P1; Y01 scope/steps/expected retained','branch':m['branch'],'head':m['head'],'platform':platform.platform(),'architecture':platform.machine(),'fullCasesPassed':['M9-T-Y01'],'productionChanges':[],'prototypeChanges':[],'productDefects':[],'driverFailure':'root-r1 dark renewal wait selected prior light lease despite actual native/UI/disk saved; root-r2 operation-scoped predicate passed','app':appMeta,'packageNativeSmokes':'DEV126 six checks reused unchanged hash, not rerun','previousReport':{'path':str(previous.relative_to(r)),'sha256':sha(previous),'all84ArtifactsUnchanged':True},'sourceBaseline':{'previousTestedFiles':1179,'testedFiles':1181,'previousSourceHashesUnchanged':True,'newVerificationFiles':added,'testedTarSha256':m['sha256'],'chainFinalCodeOutsideRootBranchUnchanged':True},'verification':{'currentCodePassed':9,'newUniqueCodeTests':5,'newTestsByBoundary':{'I':5},'existingRootInvalidationU':4,'currentSkipped':0,'currentTypecheckExit':0,'nativeRows':5,'actualAppScenarios':6,'privateChainFaultApp':4,'normalRootReplacementApp':2,'normalQuits':audit['normalQuits'],'failedRuns':1,'formalPassed':236,'formalTotal':419,'formalRemaining':183,'unexecuted':181,'blocked':2,'appRemaining':180},'boundaries':[native['boundary'],apps[0][1]['boundary'],apps[-1][1]['boundary'],notes],'artifacts':artifacts};report.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'report':str(report.relative_to(r)),'sha256':sha(report),'artifacts':len(artifacts),'testedFiles':1181,'testedTarSha256':m['sha256'],'formalPassedAfterUpdate':236,'percentage':round(236/419*100,2)},ensure_ascii=False))
