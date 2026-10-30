from pathlib import Path
import datetime,gzip,hashlib,json,platform,shutil,tarfile
r=Path('/Users/hx/hx/hxWork/SmartDD');s=r/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
previous=s/'验收/证据/m9-acceptance-symlink-race-dev123-r71-20261019.json';assert sha(previous)=='8db4f3f000cd0c9fdde0b2bbbbf0c485c638b2f4ad0ae1881c98e28e61ce1b8a';old=json.loads(previous.read_text())
for a in old['artifacts'].values():assert sha(r/a['path'])==a['sha256']
build=json.loads((b/'willyou-m9-acceptance-batch-r72-build-sources.json').read_text());tested=json.loads((b/'willyou-m9-acceptance-batch-r72-dev124-tested-sources.json').read_text());prior=json.loads((b/'willyou-m9-acceptance-batch-r71-dev123-tested-sources.json').read_text())
assert len(build['files'])==len(tested['files'])==1171 and tested['addedFiles']==[] and tested['changedFromPrevious']==['scripts/files/resource-url-ui.mjs','src/main/core/files/resource-url-acceptance.test.ts']
for m in [build,tested]:
 assert sha(m['path'])==m['sha256']
 with tarfile.open(m['path']) as tar:
  assert len(tar.getmembers())==1171
  for e in tar.getmembers():assert hashlib.sha256(tar.extractfile(e).read()).hexdigest()==m['files'][e.name]
for p,h in tested['files'].items():assert sha(r/p)==h,p
assert sum(tested['files'][p]==h for p,h in prior['files'].items())==1154
assert json.loads((s/'验收/用例覆盖索引.json').read_text())==json.loads((b/'willyou-dev124-index-before.json').read_text())
assert json.loads((b/'willyou-dev124-code-audit.json').read_text())['uniqueCurrentPassed']==129
native=json.loads((b/'willyou-dev124-native-final.json').read_text());assert len(native['rows'])==4 and all(x['pass'] for x in native['rows'])
runs=[]
for name,count in [('resource-red',None),('resource-red-r2',None),('app-r1',6),('app-symlink-r1',12),('app-pdf-r1',9),('app-media-r1',15),('app-raster-r1',18),('app-svg-r1',2)]:
 summary=json.loads((b/('willyou-dev124-'+name+'.log')).read_text().splitlines()[-1]);directory=Path(summary['artifacts']);app=json.loads((directory/'result.json').read_text());runs.append((name,directory,app))
 if count is not None:assert app['status']=='passed' and len(app['checks'])==count
 if name=='resource-red-r2':assert app['defectObserved'] and app['peer']['hash']==app['owner']['hash'] and app['exit']['code']==0
 if name=='app-r1':
  assert app['peerClosed'] and not app['peerSetup']['hasBridge'] and app['peerSetup']['preferences']['nodeIntegration']==False and app['before']==app['after'] and all(app['restored'].values())
  assert app['exit']['code']==0 and app['exit']['signal'] is None
  for x in app['checks']:
   assert x['pass'] and x['owner']['ok'] and not x['peer']['ok'] and all(not y['result']['ok'] for y in x['forged']) and not x['expired']['ok'] and not x['expiredPeer']['ok'] and x['recovered']['ok'] and x['replacement']['output']['url']!=x['url']
  for x in app['rpc']:
   if x.get('delivered'):assert x['input']==x['inputAfter'] and x['before']==x['after']
 if name=='app-pdf-r1':assert app['caseResults']=={'F15':'passed','F14':'passed'} and app['syntheticPasswordScan']['matchedPaths']==[]
 if name=='app-svg-r1':assert app['requests']==[] and app['before']==app['after'] and app['exit']['code']==0
hashes=json.loads((b/'willyou-dev124-bundle-hashes.json').read_text());appPath=Path('/private/tmp/willyou-m9-acceptance-batch-r72-build/mac-arm64/WillYou.app');resources=appPath/'Contents/Resources'
assert sha(resources/'app.asar')==hashes['asarSha256'] and sha(resources/'native/willyou-files')==hashes['brokerSha256']==old['app']['brokerSha256']
assert hashes['watcherSha256']==old['app']['watcherSha256'] and hashes['runtimeAssetsVerified']==82
assert json.loads((b/'willyou-dev124-process-audit.json').read_text())['allClosed']
package=(b/'willyou-dev124-package.log').read_text();assert all('"'+x+'":"passed"' in package for x in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
out=s/'验收/证据/acceptance-resource-url-dev124-r72';report=s/'验收/证据/m9-acceptance-resource-url-dev124-r72-20261019.json';assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
def copy(p,label):
 target=out/label;target.parent.mkdir(parents=True,exist_ok=True)
 if Path(p).suffix=='.json' and Path(p).stat().st_size>1024*1024:
  original=Path(p).read_bytes();target=target.with_name(target.name+'.gz');data=gzip.compress(original,mtime=0)
  if target.exists():assert target.read_bytes()==data
  else:target.write_bytes(data)
  artifacts[str(target.relative_to(out))]={'path':str(target.relative_to(r)),'sha256':sha(target),'encoding':'gzip','uncompressedSha256':hashlib.sha256(original).hexdigest()}
 else:
  if target.exists():assert sha(target)==sha(p)
  else:shutil.copy2(p,target)
  artifacts[label]={'path':str(target.relative_to(r)),'sha256':sha(target)}
for p in sorted(b.glob('willyou-dev124-*')):
 if p.is_file() and p.suffix in ['.json','.log','.py','.mjs','.cjs','.stderr']:copy(p,p.name)
for prefix in ['willyou-m9-acceptance-batch-r72-build-sources','willyou-m9-acceptance-batch-r72-dev124-tested-sources']:
 for ext in ['json','tar.gz']:copy(b/(prefix+'.'+ext),prefix+'.'+ext)
for name,directory,app in runs:
 for p in sorted(directory.iterdir()):
  if p.is_file() and p.suffix in ['.json','.log','.png']:copy(p,'runs/'+directory.name+'/'+p.name)
 if name in ['app-r1','app-svg-r1']:
  for p in sorted((directory/'project').iterdir()):
   if p.is_file():copy(p,'runs/'+directory.name+'/fixtures/'+p.name)
for kind in ['pdf','media','raster']:
 fixture=json.loads((b/('willyou-dev124-'+kind+'-fixtures.log')).read_text());manifest=Path(fixture.get('manifest') or join) if False else Path(fixture.get('manifest',str(Path(fixture['artifacts'])/'fixtures.json')) if kind=='raster' else fixture['manifest'])
 copy(manifest,'fixtures/'+kind+'-manifest.json')
 if (manifest.parent/'encoders.log').exists():copy(manifest.parent/'encoders.log','fixtures/'+kind+'-encoders.log')
notes='''M11 original I/A scope/steps/expected unchanged. Formal233/41955.61%,184unexecuted2blocked,183remaining with A. No release.
Genuine red in normal r71: a second actual same-session BrowserWindow, same app file URL, no preload/node or IPC auth replacement, decoded the original ordinary-image Blob and read exactly the same RGBA hash. First earlier fetch probe failed because current CSP disallowed blob fetch, so image decode/canvas was used; do not treat that first probe as a product red. Only final probe source is retained plus both raw logs/results; no historical source snapshot invented.
Fix ordinary images/SVG and PDF input via revision/owner-bound willyou-resource token URLs, reusing existing media range/stream/cancellation implementation. Main classification and 40MiBimage/256MiBPDF bounds retained independently at native reads. PDF.js still gets complete hash-verified bytes, never an authored path/URL. One combined default-session webRequest gate handles media+resources because Electron keeps only its last listener; real initiating webContents/mainFrame identity is compared with original controller owner before protocol IO. No caller-selected file:// or HTTP proxy, paths/query rejected, opaque random32byte token, no-store, four grants/owner and four reads/grant, bounded1MiB native chunks. Token validity ends with active preview, document/root/owner lifetime; this is the tested expiry boundary, not a new wall-clock TTL claim. Protocol unavailable fails closed for image/PDF, no shared Blob fallback. Existing media binary fallback retained.
Current129 unique code pass,26new(U22/I4), typecheck0, native59/core17/PDF/model21 and policy tests; no skip/Unhandled. I real SQLite/resolver/controller/FileService and actual packaged native: PNG/SVG/PDF, foreign ref denial beforeIO, malformed URL noIO, exact owner bytes, wrong-owner release harmless, close original while peer token remains, destroyedowner zero resources, real external revision change410/root close zero. Sender frames synthetic I; real gate proved separately A. Two first policy tests failed only because native Request constructor itself rejects credentials URLs; allows rejection retained, constructor rejection asserted without weakening policy. Typecheck buffer generic on unit deferred resolver corrected, no production cast/fallback.
r72 normal App A6(light/dark xPNG/SVG/PDF): actual UI open/close/reopen and original passive IPC; same-session actual second unprivileged window, transferred URLs denied,24forged URL attempts denied, closed original URL owner/peer denied, reopen fresh token exact sourcehash while old stays invalid. Twelve valid original/reopened source fetches match raw bytes, source/outside canaries unchanged, original IPC inputs/results preserved and restored, peer destroyed and main normalexit0/null. No Store/editor/DOM-value injection, CUA/Codex bypass, clipboard, credentials, model or external App. Browser programmatic malicious reads are required security inputs, not human input claims.
Affected A regression56checks = M04normal12 +PDF9variants plus navigation/restore +media15 +raster18(including GIF compositor colors/alpha/realdecodeerrors) +maliciousSVG2(actual source/image clicks, no script/rawDOM injection or own-loopback network). Together62 array checks plus PDF navigation/restore. PDF/media/raster legacy drivers use harness cleanup, not normal-exit proof. M11/M04/SVG3 current runs and2 early probes have explicit normal exits; all own bundle-prefix/native processes closed, peer windows destroyed. Same original native source/broker and watcher hashes, fresh82runtime/sixsmokes.1171build/tested sources,1154of1163prior unchanged,9existing changed+8new; postbuild only external A driver and native I test expanded with SVG, production inputs unchanged. Prototype code/styles0changes; existing image/PDF/source/error UI unchanged, old P243/shared16/build/Sites4 not rerun/fullpixel claim. Viewed light PDF screenshot only. No Windows/Linux/physicalIME/fullCodexpixel or other embedded-image Blob path claim. M05/H20/X03 and remaining system/manual/reference/platform work open, all419 required.
'''
p=out/'execution-boundaries.txt';p.write_text(notes);artifacts[p.name]={'path':str(p.relative_to(r)),'sha256':sha(p)}
value={'schemaVersion':1,'id':'M9-ACCEPTANCE-RESOURCE-URL-DEV124-R72','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localDate':'2026-10-19','status':'passed-one-case','revision':'R3.4 / R3.4-P1; M11 original scope/steps/expected unchanged','branch':tested['branch'],'head':tested['head'],'platform':platform.platform(),'architecture':platform.machine(),'fullCasesPassed':['M9-T-M11'],'productionChanges':['src/main/core/files/resource-service.ts','src/main/core/files/media-service.ts','src/main/core/files/file-service.ts','src/main/core/files/controller.ts','src/main/core/files/viewer-assets.ts','src/main/index.ts','src/renderer/index.html','src/shared/file-resource.ts','src/renderer/features/files/preview-resource.ts','src/renderer/features/files/workspace-panel.tsx','src/renderer/features/files/pdf/preview.tsx'],'prototypeChanges':[],'defects':[{'id':'M9-DEV124-BLOB-OWNER','status':'fixed-and-retested','finding':'Same-session second real window could decode original ordinary-image Blob and read identical pixels.','fix':'Opaque owner/revision/lifetime protocol for ordinary image/SVG and PDF input; no unscoped fallback.'}],'app':{**hashes,'path':str(appPath),'version':'0.0.5','published':False,'nativeChecksCurrent':['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher']},'previousReport':{'path':str(previous.relative_to(r)),'sha256':sha(previous),'all148ArtifactsUnchanged':True},'sourceBaseline':{'previousTestedFiles':1163,'buildFiles':1171,'testedFiles':1171,'buildSha256':build['sha256'],'finalTestedSha256':tested['sha256'],'priorSourceFilesUnchanged':1154,'changedFromPrior':build['changedFromPrevious'],'addedAtBuild':build['addedFiles'],'postBuildChanges':tested['changedFromPrevious'],'postBuildProductionInputChanges':[]},'verification':{'currentCodePassedUnique':129,'newUniqueCodeTests':26,'newTestsByBoundary':{'U':22,'I':4},'currentSkipped':0,'unhandledErrors':0,'currentTypecheckExit':0,'nativeResourceRows':4,'nativeBrokerRegressionPassed':59,'coreRegressionPassed':17,'newActualAppChecks':6,'actualAppRegressionChecks':56,'actualAppChecksTotal':62,'pdfNavigationAndRestoreAdditional':True,'currentNormalQuitRuns':[app['exit'] for name,path,app in runs if name in ['app-r1','app-symlink-r1','app-svg-r1']],'formalPassed':233,'formalTotal':419,'formalRemaining':186,'unexecuted':184,'blocked':2,'appRemaining':183},'boundaries':[native['boundary'],notes],'artifacts':artifacts}
report.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(report.relative_to(r)),'sha256':sha(report),'artifacts':len(artifacts),'formalPassed':233,'percentage':round(233/419*100,2)},ensure_ascii=False))
