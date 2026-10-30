from pathlib import Path
import json,hashlib,tarfile,gzip,io,platform,datetime,subprocess
root=Path.cwd();stage=root/'docs/里程碑/M9_文件浏览工作区';tmp=Path('/private/tmp')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
report=stage/'验收/证据/m9-acceptance-keyboard-focus-dev134-r79-20261019.json'
assert not report.exists()
prior=stage/'验收/证据/m9-acceptance-markdown-diagram-dev133-r75-20261019.json'
assert sha(prior)=='e3aad8094db84b38bdc44c88c1368629394693b05c983611968ed7d35d28a0b4'
old=json.loads(prior.read_text());assert all(sha(root/v['path'])==v['sha256'] for v in old['artifacts'].values())
base=json.loads((tmp/'willyou-m9-acceptance-batch-r79-build-sources.json').read_text());assert len(base['files'])==1224 and sha(base['path'])==base['sha256']
changes={p:sha(root/p) for p,h in base['files'].items() if sha(root/p)!=h}
assert set(changes)=={'docs/真实App自动验收流程.md'},changes
hashes={**base['files'],**changes}
p=tmp/'willyou-dev134-final-source-manifest.json'
p.write_text(json.dumps({'at':now,'buildManifest':'willyou-m9-acceptance-batch-r79-build-sources.json','buildTarSha256':base['sha256'],'postBuildChangedFiles':changes,'boundary':'Only common workflow accident-prevention note appended after build; all production/native/dependencies/prototype/test/driver files unchanged. Milestone result records maintained separately.','files':hashes,'fileCount':len(hashes)},ensure_ascii=False,indent=2)+'\n')
def tar_bytes(path,items):
 with path.open('wb') as raw:
  with gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w|') as t:
    for name,b in sorted(items.items()):
     a=tarfile.TarInfo(name);a.size=len(b);a.mode=0o644;t.addfile(a,io.BytesIO(b))
tar_bytes(tmp/'willyou-dev134-postbuild-doc-delta.tar.gz',{p:(root/p).read_bytes() for p in changes})
# Older complete snapshots are represented as checked differences from the final build snapshot.
previous=[]
for n in [76,77,78]:
 mpath=tmp/f'willyou-m9-acceptance-batch-r{n}-build-sources.json';m=json.loads(mpath.read_text());assert sha(m['path'])==m['sha256']
 changed={p:h for p,h in m['files'].items() if base['files'].get(p)!=h}
 with tarfile.open(m['path']) as t:
  content={p:t.extractfile(p).read() for p in changed}
 assert all(hashlib.sha256(content[p]).hexdigest()==h for p,h in changed.items())
 delta=tmp/f'willyou-dev134-r{n}-source-delta-from-r79.tar.gz';tar_bytes(delta,content)
 app=tmp/f'willyou-m9-acceptance-batch-r{n}-build/mac-arm64/WillYou.app'
 previous.append({'build':f'r{n}','fileCount':len(m['files']),'originalSourceTarSha256':m['sha256'],'manifest':mpath.name,'base':'r79 build full source tar','changedFiles':changed,'removeFromBase':sorted(set(base['files'])-set(m['files'])),'delta':delta.name,'deltaSha256':sha(delta),'asarSha256':sha(app/'Contents/Resources/app.asar')})
(tmp/'willyou-dev134-previous-build-baselines.json').write_text(json.dumps(previous,ensure_ascii=False,indent=2)+'\n')
files=['willyou-dev134-r79-final-code.json','willyou-dev134-final-I-regressions.json','willyou-dev134-r79-root-I.json']
unique=set();tests=[]
for name in files:
 d=json.loads((tmp/name).read_text());assert d['success'] and d['numFailedTests']==0
 for suite in d['testResults']:
  for a in suite['assertionResults']:
   if a['status']=='passed':
    key=(suite['name'],a['fullName']);assert key not in unique;unique.add(key)
 tests.append({'file':name,'passed':d['numPassedTests'],'skipped':d['numPendingTests']})
assert len(unique)==65
assert 'ℹ pass 41' in (tmp/'willyou-dev134-P-model-final.log').read_text()
assert 'TS' not in (tmp/'willyou-dev134-typecheck8.log').read_text()
pack=json.loads((tmp/'willyou-dev134-fast-package-result.json').read_text());assert pack['status']=='passed' and all(x['code']==0 for x in pack['steps'])
smoke=json.loads((tmp/'willyou-dev134-r79-native-smoke.log').read_text());assert all(smoke[k]=='passed' for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
runtime=json.loads((tmp/'willyou-dev134-runtime-r79.json').read_text());assert runtime['verified']==82
formal={'P':'willyou-keyboard-focus-prototype-baqQxw','A':'willyou-keyboard-focus-app-rlIHHc','B22-A':'willyou-tree-selection-app-NbTDnU','D-search':'willyou-keyboard-focus-app-HjApCO','D-tree':'willyou-keyboard-focus-app-Gn9Vel'}
runs={k:json.loads((tmp/v/'result.json').read_text()) for k,v in formal.items()}
for k,n in [('P',20),('A',20),('B22-A',4),('D-search',10),('D-tree',10)]:assert runs[k]['status']=='passed' and len(runs[k]['checks'])==n
for k in ['P','A','D-search','D-tree']:assert runs[k]['exit']['code']==0 and runs[k]['exit']['signal'] is None
assert runs['A']['runtime']['packaged'] is True and runs['D-tree']['runtime']['packaged'] is False
assert runs['A']['inputObserverRestored'] and all(runs['A']['rpcRestored'].values())
assert runs['B22-A']['receiverBefore']['pid']==runs['B22-A']['receiverAfter']['pid'] and runs['B22-A']['receiverAfter']['bytes']==runs['B22-A']['receiverAfter']['executedCommands']==0
app=Path(pack['app']);asar=sha(app/'Contents/Resources/app.asar');assert asar==runs['A']['asarSha256']==runs['B22-A']['asarSha256']
assert all(sha(root/v['file'])==v['sha256'] for v in runtime['files']) # Packaged Node separately compared these82 ASAR entries to out; verify out has not changed since then.
cleanup=json.loads((tmp/'willyou-dev134-accidental-launch-cleanup.json').read_text());assert not cleanup['remainingR76Processes']
out=stage/'验收/证据/acceptance-keyboard-focus-dev134-r79';out.mkdir(exist_ok=True);artifacts={}
def copy(p,label):
 p=Path(p);target=out/label;target.parent.mkdir(parents=True,exist_ok=True);raw=p.read_bytes();meta={}
 if p.suffix=='.json' and len(raw)>1048576:
  target=target.with_name(target.name+'.gz');meta={'encoding':'gzip','uncompressedSha256':hashlib.sha256(raw).hexdigest()};raw=gzip.compress(raw,mtime=0)
 assert not target.exists() or target.read_bytes()==raw,str(target)
 target.write_bytes(raw);artifacts[str(target.relative_to(out))]={'path':str(target.relative_to(root)),'sha256':sha(target),**meta}
for p in sorted(tmp.glob('willyou-dev134-*')):
 if p.is_file() and p.suffix in ['.log','.json','.mjs','.cjs','.py','.gz']:copy(p,p.name)
for n in [76,77,78,79]:copy(tmp/f'willyou-m9-acceptance-batch-r{n}-build-sources.json',f'builds/r{n}-source-manifest.json')
copy(base['path'],'builds/r79-full-sources.tar.gz')
for p in sorted((tmp/'willyou-dev134-before').rglob('*')):
 if p.is_file():copy(p,'before/'+str(p.relative_to(tmp/'willyou-dev134-before')))
runpaths=sorted({p for p in tmp.glob('willyou-keyboard-focus-*') if (p/'result.json').exists()}|{tmp/formal['B22-A']})
for p in runpaths:
 for q in sorted(p.iterdir()):
  if q.is_file() and q.suffix in ['.json','.log','.png']:copy(q,'runs/'+p.name+'/'+q.name)
fixtures={};fixtureMeta=[]
for p in runpaths:
 for f in ['A.txt','B.txt','C.txt','folder/child.txt']:
  q=p/'project'/f
  if q.is_file():
   name=p.name+'/'+f;raw=q.read_bytes();fixtures[name]=raw;fixtureMeta.append({'path':name,'bytes':len(raw),'sha256':sha(q)})
tar_bytes(tmp/'willyou-dev134-fixtures.tar.gz',fixtures);copy(tmp/'willyou-dev134-fixtures.tar.gz','fixtures.tar.gz')
boundary='Y20 U/P/A and Y22 P/A original scope/steps/expected preserved. P20 uses actual shared prototype with four synthetic sources; it is not native filesystem evidence. Current code65 unique (19U,46 native I; root-selected fixture has five unselected skips, not passes), P model41, typecheck passed. Final r79 normal packaged A20 verifies light/dark Shift no/stale anchor, Meta/Control Space selection-only/no open, visible-all directories, full sibling ARIA and single row tab stop; search toolbar Esc/backdrop focus restoration, bidirectional Tab trap, lower result46 visible and Enter editor focus/selection retained. Real CDP trusted input; native file RPC observer forwards original results; no saves, four original files unchanged. B22 affected normal packaged A4 preserves first eligible selected-file host behavior, focus and one preview, actual isolated PTY same pid and zero input/commands, original files/inodes/mtime unchanged. B22 close is cleanup, not normal-quit proof. One final A and selected P normal quit0/null; D10 search and D10 tree are real unpackaged diagnostic Apps, not formal A. Root native refresh removed focused rows; product preserves current owned container/navigation until fresh rows, cancels old RAF and reveals distant target, and cancels when user leaves. Search result close now disables modal trigger restoration and waits same buffer editor readiness; no focus stealing after explicit outside input. Early U/A reds and driver errors retained. P fixture ordering assumptions, non-awaited real focus and transient BaseUI guard assertions were driver errors; real r76 focus loss and r77/r78 result-trigger focus were product defects. Native/dependency source inputs unchanged; final r79 first validates actual Electron ABI, performs full compile, identical builder/afterPack, six original native smokes and82 runtime file hashes; only redundant native rebuild omitted. No installer/release. Sandbox codesign check failed in dev-preview build1; identical escalated build2 passed without resource changes. Initial two Node probes omitted ELECTRON_RUN_AS_NODE, and an accidentally launched r76 using default SmartDD userData remained; audit found it and SIGTERM closed only verified pid23262. No UI interaction was sent to that instance. No pre-launch daily-data baseline exists, so unchanged daily data is not claimed; no default data recovery/deletion/modification attempted during cleanup. This accident is excluded from acceptance and separately archived. All final deliberate tests use private userData. Current full1224 build-source snapshot plus one common-workflow note delta are recoverable; prior build source deltas and failures retained. Historical driver versions between builds not separately snapshotted unless present in archived build tars; do not invent hashes. Screenshots light-tree and dark-result personally inspected for visible selection and actual result line46, not full Codex pixel parity. Other platform/system IME/reference cases remain incomplete; no release.'
d={'at':now,'caseIds':['M9-T-Y20','M9-T-Y22'],'affectedRegressionCaseIds':['M9-T-B22'],'revision':'R3.4/R3.4-P1','branch':'feature/0.0.1','head':base['head'],'environment':{'system':platform.platform(),'architecture':platform.machine()},'app':{'path':str(app),'asarSha256':asar,'brokerSha256':sha(app/'Contents/Resources/native/willyou-files'),'watcherSha256':json.loads((tmp/'willyou-dev134-watcher-r79.json').read_text())['sha256'],'version':'0.0.5','nativeSmokeChecks':6,'runtimeFilesVerified':82},'sourceSnapshot':{'buildFiles':1224,'buildManifest':'builds/r79-source-manifest.json','buildTar':'builds/r79-full-sources.tar.gz','buildTarSha256':base['sha256'],'postBuildDocChanges':changes,'finalManifest':'willyou-dev134-final-source-manifest.json','postBuildDelta':'willyou-dev134-postbuild-doc-delta.tar.gz','productionFilesAfterBuildUnchanged':True},'results':{'unitTests':19,'nativeIntegrationTests':46,'uniqueCodeTests':65,'modelTests':41,'prototypeChecks':20,'packagedAppChecks':20,'affectedB22AppChecks':4,'developmentDiagnosticChecks':20,'selectedNormalPackagedAppExits':1,'formalPassed':245,'formalTotal':419,'unexecuted':172,'blocked':2,'appRemaining':171},'tests':tests,'formalRuns':formal,'earlierBuilds':previous,'fixtures':fixtureMeta,'artifacts':artifacts,'boundary':boundary,'releasePerformed':False}
report.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'report':str(report.relative_to(root)),'sha256':sha(report),'artifacts':len(artifacts),'sourceFiles':1224},ensure_ascii=False))
