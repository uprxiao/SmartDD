from pathlib import Path
import datetime,gzip,hashlib,io,json,os,platform,shutil,subprocess,tarfile
r=Path('/Users/hx/hx/hxWork/SmartDD');s=r/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();read=lambda p:json.loads(Path(p).read_text());now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
previous=s/'验收/证据/m9-acceptance-save-races-dev128-r74-20261019.json';assert sha(previous)=='3dee6817019f252a0a7e8f238480a43876809594ab3ef1605562300c57c31bf3';old=read(previous)
for a in old['artifacts'].values():assert sha(r/a['path'])==a['sha256']
assert read(s/'验收/用例覆盖索引.json')==read(b/'willyou-dev129-index-before.json')
frozen=read(b/'willyou-dev129-frozen-budget.json');assert sha(r/frozen['path'])==frozen['sha256']=='71cb45102ad1ce09c31699b7d4ac437a9138a3bbe8454c34a981a0e981ef6a46'
code={};initial=read(b/'willyou-dev129-recovery-full-code.json');assert (initial['numPassedTests'],initial['numFailedTests'])==(19,1)
for label in ['recovery-full-code','storm-code-green','root-owner-regression-code']:
 d=read(b/f'willyou-dev129-{label}.json')
 for suite in d['testResults']:
  for t in suite['assertionResults']:
   key=suite['name']+'::'+t['fullName']
   if t['status']=='passed':code[key]={'status':'passed','source':f'willyou-dev129-{label}.json','durationMs':t['duration']}
assert len(code)==29
(b/'willyou-dev129-selected-code.json').write_text(json.dumps({'at':now(),'uniquePassed':29,'unresolvedFailures':0,'unresolvedSkipped':0,'results':code,'boundary':'19 passed plus one strict-input fixture failure; the same failed test passes after removing display-only fields from the DirectoryListRequest. Selected rerun skips five unrelated cases already passed in the full run. Root/owner regression adds nine distinct passed tests. No duplicate counting.'},ensure_ascii=False,indent=2)+'\n')
red=read(b/'willyou-dev129-recovery-code-red.json');assert (red['numPassedTests'],red['numFailedTests'])==(1,1)
red2=read(b/'willyou-dev129-cost-real-red-code.json');assert (red2['numPassedTests'],red2['numFailedTests'])==(0,1)
specs=[('gBDTcQ','failed',5,False),('SQZ4e9','failed',0,False),('XaGIBz','failed',2,False),('zpyHia','passed',7,True),('nUNEcU','passed',4,True)]
entries=[];normal=[]
for suffix,status,count,selected in specs:
 directory=b/('willyou-watch-recovery-app-'+suffix);d=read(directory/'result.json');assert d['status']==status and len(d['checks'])==count
 assert d['sentinelBefore']==d.get('sentinelAfter',d['sentinelBefore'])
 for p in d['processes']:
  assert p['exit']['code']==0 and p['exit']['signal'] is None and all(p['costRestored'].values()) and all(p['watchRestored'].values())
  if selected:normal.append(p['exit'])
 if selected:assert all(c['pass'] for c in d['checks'])
 for trace in directory.glob('trace-*.json'):
  t=read(trace);assert not t['watch']['active'] and not t['cost']['timers'] and not t['cost']['pendingEnds'];assert all(x['settled'] and x['stopped'] and x['unsubscribeCalls']==1 for x in t['watch']['native']);assert all(x['settled'] for x in t['cost']['calls']);assert all(x.get('before')==x.get('after') for x in t['watch']['updates']);assert all(x['inputHash']==x['deliveredInputHash'] for x in t['cost']['calls'] if x.get('deliveredInputHash'))
 entries.append({'directory':directory,'data':d,'selected':selected})
assert len(normal)==21
perf=entries[-1]['data'];natural=perf['checks'][0]
for kind in ['cold','warm']:
 assert len(natural[kind])==20
 for sample in natural[kind]:
  assert sample['elapsedMs']<=frozen['budget']['maxSnapshotWallMs'];assert any(x['operation']=='list' and x.get('relativePath')=='sub' and x.get('entries')==2000 for x in sample['calls']);assert any(x['operation']=='metadata' and x.get('relativePath')=='a.txt' for x in sample['calls'])
release=perf['checks'][1];assert len(release['cycles'])==20 and len(release['after']['watch']['native'])==20 and release['after']['cost']['timers']==0 and not release['after']['cost']['resources']
for fault in perf['checks'][2:]:assert fault['observedIdleMs']>=fault['cooldown']-10
ip=[x for x in read(b/'willyou-dev129-recovery-full.json')['rows'] if x.get('coldDistribution')][0]
assert len(ip['cold'])==len(ip['warm'])==20 and ip['stoppedAt']['resources']==ip['baseline']==[]
prior=read(b/'willyou-m9-acceptance-batch-r74-dev128-tested-sources.json');build=read(b/'willyou-m9-acceptance-batch-r75-build-sources.json');assert build['fileCount']==1193
files=set(prior['files'])|set(subprocess.check_output(['rg','--files','src','native','scripts'],cwd=r,text=True).splitlines());hashes={p:sha(r/p) for p in files}
changed=sorted(p for p,h in prior['files'].items() if hashes[p]!=h);assert changed==['docs/真实App自动验收流程.md','scripts/lib/file-watch-observer.mjs','src/main/core/files/watch-service.ts']
afterBuild=sorted(p for p,h in build['files'].items() if hashes[p]!=h);assert afterBuild==['docs/真实App自动验收流程.md','scripts/lib/file-watch-cost-observer.mjs']
assert sorted(files-set(build['files']))==['scripts/files/watch-recovery-budget-ui.mjs']
for p,h in prior['files'].items():
 if p.startswith(('src/renderer/','native/','prototypes/')):assert hashes[p]==h
assert len(files)==1194
prefix=b/'willyou-m9-acceptance-batch-r75-dev129-tested-sources';archive=prefix.with_suffix('.tar.gz');manifest=prefix.with_suffix('.json');assert not archive.exists() and not manifest.exists()
with archive.open('xb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as compressed:
  with tarfile.open(fileobj=compressed,mode='w|',format=tarfile.PAX_FORMAT) as tar:
   for p,h in sorted(hashes.items()):
    path=r/p;data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==h;e=tarfile.TarInfo(p);e.size=len(data);e.mode=path.stat().st_mode&0o777;e.mtime=int(path.stat().st_mtime);tar.addfile(e,io.BytesIO(data))
m={'at':now(),'path':str(archive),'sha256':sha(archive),'files':hashes,'fileCount':len(hashes),'branch':build['branch'],'head':build['head'],'previousManifest':str(b/'willyou-m9-acceptance-batch-r74-dev128-tested-sources.json'),'buildManifest':str(b/'willyou-m9-acceptance-batch-r75-build-sources.json'),'changedFromPrevious':changed,'newVerificationAndProductionFiles':sorted(files-set(prior['files'])),'changedAfterBuild':afterBuild,'addedAfterBuild':sorted(files-set(build['files'])),'productionInputsUnchangedAfterBuild':True};manifest.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
app=b/'willyou-m9-acceptance-batch-r75-build/mac-arm64/WillYou.app';resources=app/'Contents/Resources';assert sha(resources/'app.asar')==perf['asarSha256']=='59c70a032437fcac22ab8e7775ea6956079b549079523b4f896f43a65e291e26';assert sha(resources/'native/willyou-files')==old['app']['brokerSha256']==perf['brokerSha256'];assert read(b/'willyou-dev129-runtime-r75.json')['verified']==82
watcher=read(b/'willyou-dev129-watcher-r75.json');assert watcher['sha256']==old['app']['watcherSha256']
smokes=[json.loads(x) for x in (b/'willyou-dev129-r75-build.log').read_text().splitlines() if x.startswith('{"version"')][-1];assert all(smokes[k]=='passed' for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
prefixes=[str(app),'/private/tmp/willyou-watch-recovery-native-'];live=[]
for line in subprocess.check_output(['/bin/ps','-A','-o','pid=,ppid=,stat=,comm=,args='],text=True).splitlines():
 parts=line.strip().split(None,4)
 if len(parts)==5 and any(p in parts[3] for p in prefixes):live.append({'pid':int(parts[0]),'comm':parts[3]})
assert not live,live
audit={'at':now(),'allOwnProcessesClosed':True,'ownedExecutablePrefixes':prefixes,'ownedMatches':live,'selectedNormalExits':normal,'selectedNormalExitCount':len(normal),'I20NativeSubscriptionsUnsubscribed':True,'A20NativeSubscriptionsUnsubscribed':True,'ownWatcherTimersZero':True,'modificationAfterStopNoCallback':True,'noVolumeCreated':True};(b/'willyou-dev129-process-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
out=s/'验收/证据/acceptance-watch-recovery-dev129-r75';report=s/'验收/证据/m9-acceptance-watch-recovery-dev129-r75-20261019.json';assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
def copy(p,label):
 p=Path(p);target=out/label;target.parent.mkdir(parents=True,exist_ok=True);raw=p.read_bytes();data=raw
 if p.suffix=='.json' and len(raw)>1024*1024:target=target.with_name(target.name+'.gz');data=gzip.compress(raw,mtime=0)
 if target.exists():assert target.read_bytes()==data
 else:target.write_bytes(data)
 a={'path':str(target.relative_to(r)),'sha256':sha(target)}
 if data is not raw:a.update(encoding='gzip',uncompressedSha256=hashlib.sha256(raw).hexdigest())
 artifacts[str(target.relative_to(out))]=a
for p in sorted(b.glob('willyou-dev129-*')):
 if p.is_file() and p.suffix in ['.json','.log','.py','.cjs','.mjs','.ts']:copy(p,p.name)
for p in [archive,manifest,b/'willyou-m9-acceptance-batch-r75-build-sources.json',b/'willyou-m9-acceptance-batch-r75-build-sources.tar.gz']:copy(p,p.name)
for entry in entries:
 for p in sorted(entry['directory'].iterdir()):
  if p.is_file() and p.suffix in ['.json','.png','.log']:copy(p,'runs/'+entry['directory'].name+'/'+p.name)
notes='''Y04/Y05 original R3.4/R3.4-P1 scopes, steps and expectations unchanged. macOS26.6.1arm64 only. Production changes watch-service.ts plus watch-budget.ts and pre-execution frozen shared JSON E1. Actual chmod000 subdirectory originally produced PERMISSION without visible poll degradation; real red preserved. Fix carries permission metadata out of snapshots, retires real native subscription, keeps healthy root capability, automatically rescans successful restored membership, then honors native reconnect backoff. Missing leaf errors do not revoke healthy root. Measured shared-root snapshot wall time controls scheduled scans including native hints; >200ms shows cost status, normal scans clear it; 1000ms natural acceptance bound, 10percent wall-duty scheduling target up to30s cap. Not measured process CPU, no fixed50ms project recursion, no OS disk-cache cold claim.
29 selected distinct code tests all passed: full batch19pass/1 strict DirectoryListRequest fixture error, fixed same selected storm test1pass, plus9 root/owner regressions. Five skipped in selected storm invocation already passed in full batch, not unexecuted formal cases. New I6, budget U3, previous related I/U20. Real native/broker bytes are identical r74/r75; current TS service under test and runtime bundle match r75.
Final A7 recovery checks plus A4 budget checks,21 selected normal App exits. A20 fresh-process first complete list2000/open-file snapshots and20 same-App/consumer warm snapshots; I20 fresh-service contexts and20warm separately named. Original three exact paths root/sub/a.txt, no closed descendants. Same-App20 real subscriptions each exactly one unsubscribe, owned timers/platform resources zero, later real write causes no callback/read. Slow original stdin request delivery300ms is explicit fault; all request hashes identical and actual native responses original. Separate light/dark cost warnings and recovered cleared status; actual cooldown measured against frozen original policy, not included in natural samples. Both themes also real permission loss/restore, atomic replacement then in-place edits,3000real creates with >2000 unchanged native hints and full rescan/actual visible tree tail. Native-create rejection is explicitly injected EMFILE only, actual poll add/modify/delete snapshots/GUI verified, not OS descriptor exhaustion.
Preserved original product permission and slow-budget reds. Sandboxed FSEvents startup failures are environment failures, not product reds; final native runs use authorized actual host access. Earlier App driver failures concern initial fingerprint readiness, already-expanded directory toggling and scrolling before render. Stronger state/membership/render waits retain all original business assertions. Sources, logs, previous green subsets and final batches preserved. No new layout/styles/P pages; existing status host actual light/dark verified. No complete Codex pixel/IME/clipboard/other-platform claim, no release/merge/tag/push. All observer functions restored and own processes closed; daily resources untouched.'''
(out/'BOUNDARIES.txt').write_text(notes+'\n');artifacts['BOUNDARIES.txt']={'path':str((out/'BOUNDARIES.txt').relative_to(r)),'sha256':sha(out/'BOUNDARIES.txt')}
d={'at':now(),'caseIds':['M9-T-Y04','M9-T-Y05'],'revision':'R3.4/R3.4-P1','environment':{'system':platform.platform(),'architecture':platform.machine(),'swVers':subprocess.check_output(['sw_vers'],text=True)},'branch':build['branch'],'head':build['head'],'sourceSnapshot':{k:v for k,v in m.items() if k!='files'},'app':{'path':str(app),'asarSha256':perf['asarSha256'],'brokerSha256':perf['brokerSha256'],'watcherSha256':watcher['sha256'],'version':smokes['version'],'runtimeFilesVerified':82,'nativeSmokes':smokes},'frozenBudget':frozen,'results':{'selectedCodePassed':29,'newI':6,'newBudgetU':3,'appRecoveryChecks':7,'appBudgetChecks':4,'selectedNormalAppExits':21,'ICold':ip['coldDistribution'],'IWarm':ip['warmDistribution'],'ACold':natural['coldDistribution'],'AWarm':natural['warmDistribution'],'slowFaultCooldowns':[{'theme':x['theme'],'scanMs':x['elapsed'],'requiredIdleMs':x['cooldown'],'actualIdleMs':x['observedIdleMs']} for x in perf['checks'][2:]],'formalPassed':239,'formalTotal':419,'unexecuted':178,'blocked':2,'appRemaining':177},'previousReport':{'path':str(previous.relative_to(r)),'sha256':sha(previous),'verifiedArtifacts':len(old['artifacts'])},'artifacts':artifacts,'boundary':notes,'releasePerformed':False};report.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(report),'sha256':sha(report),'artifacts':len(artifacts),'sourceFiles':len(hashes),'sourceTarSha256':m['sha256'],'formalPassedAfterDocs':239,'total':419},ensure_ascii=False))
