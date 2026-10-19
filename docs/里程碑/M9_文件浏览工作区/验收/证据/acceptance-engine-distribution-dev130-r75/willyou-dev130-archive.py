from pathlib import Path
import datetime,gzip,hashlib,io,json,os,platform,shutil,subprocess,tarfile
r=Path('/Users/hx/hx/hxWork/SmartDD');s=r/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();read=lambda p:json.loads(Path(p).read_text());now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
previous=s/'验收/证据/m9-acceptance-watch-recovery-dev129-r75-20261019.json';assert sha(previous)=='2ddef395124884cbbef51b57cc08bdaf3be0abc8296e785236b7585bdbc8af07';old=read(previous)
for a in old['artifacts'].values():assert sha(r/a['path'])==a['sha256']
assert read(s/'验收/用例覆盖索引.json')==read(b/'willyou-dev130-index-before.json')
code=read(b/'willyou-dev130-distribution-I-final-code.json');assert code['success'] and (code['numPassedTests'],code['numFailedTests'],code['numPendingTests'])==(3,0,0)
i=read(b/'willyou-dev130-distribution-I-final.json');versions,licenses,distribution=i['rows'];assert len(versions['records'])==31 and len(licenses['files'])==275 and licenses['mcpPackages']==16
assert [(x['packages']) for x in licenses['summaries']]==[176,45] and distribution['totalLogicalBytes']==1539508570
entries=[]
for suffix in ['', '2','3','4','5','6']:
 summary=read(b/f'willyou-dev130-distribution-A{suffix}.log');directory=Path(summary['artifacts']);a=read(directory/'result.json');selected=suffix=='6';assert a['status']==('passed' if selected else 'failed')
 if selected:
  assert len(a['checks'])==4 and all(x['pass'] for x in a['checks']);assert a['sourceHashes']==a['sourceHashesAfter'];assert a['exit']['code']==0 and a['exit']['signal'] is None;assert a['rawWorkerRestored'] and a['mainRestored'] and all(a['workerRestored'].values());assert a['firstScreen']['scripts'] and len(a['firstScreen']['scripts'])==128;assert a['markdown']['hidden'][0]['functionType']=='function' and a['markdown']['hidden'][0]['destroyed'];assert a['pdf']['scripts']
 entries.append({'directory':directory,'data':a,'selected':selected})
final=entries[-1]['data'];app=Path(old['app']['path']);resources=app/'Contents/Resources';assert final['asarSha256']==old['app']['asarSha256']==sha(resources/'app.asar')
prior=read(b/'willyou-m9-acceptance-batch-r75-dev129-tested-sources.json');build=read(b/'willyou-m9-acceptance-batch-r75-build-sources.json');files=set(prior['files'])|set(subprocess.check_output(['rg','--files','src','native','scripts'],cwd=r,text=True).splitlines());hashes={p:sha(r/p) for p in files};changed=sorted(p for p,h in prior['files'].items() if hashes[p]!=h)
assert changed==['docs/真实App自动验收流程.md'];added=sorted(files-set(prior['files']));assert added==['scripts/files/engine-distribution-ui.mjs','src/main/core/files/engine-distribution-acceptance.test.ts'];assert len(files)==1196
for p,h in prior['files'].items():
 if p.startswith(('src/','native/','prototypes/')) or p in ['package.json','pnpm-lock.yaml','NOTICE']:assert hashes[p]==h,p
afterBuild=sorted(p for p,h in build['files'].items() if hashes[p]!=h);assert afterBuild==['docs/真实App自动验收流程.md','scripts/lib/file-watch-cost-observer.mjs']
prefix=b/'willyou-m9-acceptance-batch-r75-dev130-tested-sources';archive=prefix.with_suffix('.tar.gz');manifest=prefix.with_suffix('.json');assert not archive.exists() and not manifest.exists()
with archive.open('xb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as compressed:
  with tarfile.open(fileobj=compressed,mode='w|',format=tarfile.PAX_FORMAT) as tar:
   for p,h in sorted(hashes.items()):
    path=r/p;data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==h;e=tarfile.TarInfo(p);e.size=len(data);e.mode=path.stat().st_mode&0o777;e.mtime=int(path.stat().st_mtime);tar.addfile(e,io.BytesIO(data))
m={'at':now(),'path':str(archive),'sha256':sha(archive),'files':hashes,'fileCount':1196,'branch':build['branch'],'head':build['head'],'previousManifest':str(b/'willyou-m9-acceptance-batch-r75-dev129-tested-sources.json'),'buildManifest':str(b/'willyou-m9-acceptance-batch-r75-build-sources.json'),'changedFromPrevious':changed,'newVerificationFiles':added,'changedAfterBuild':afterBuild,'addedAfterBuild':sorted(files-set(build['files'])),'productionInputsUnchangedAfterBuild':True,'normalPackageReused':True};manifest.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
live=[]
for line in subprocess.check_output(['/bin/ps','-A','-o','pid=,ppid=,stat=,comm=,args='],text=True).splitlines():
 parts=line.strip().split(None,4)
 if len(parts)==5 and str(app) in parts[3]:live.append({'pid':int(parts[0]),'comm':parts[3]})
assert not live,live
audit={'at':now(),'allOwnAppProcessesClosed':True,'ownedExecutablePrefix':str(app),'ownedMatches':live,'selectedNormalExit':final['exit'],'originalWorkerAndMainObserverRestored':True,'failedCleanupNotNormalQuit':True,'noVolumeCreated':True};(b/'willyou-dev130-process-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
out=s/'验收/证据/acceptance-engine-distribution-dev130-r75';report=s/'验收/证据/m9-acceptance-engine-distribution-dev130-r75-20261019.json';assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
def copy(p,label):
 p=Path(p);target=out/label;target.parent.mkdir(parents=True,exist_ok=True);raw=p.read_bytes();data=raw
 if p.suffix=='.json' and len(raw)>1024*1024:target=target.with_name(target.name+'.gz');data=gzip.compress(raw,mtime=0)
 if target.exists():assert target.read_bytes()==data
 else:target.write_bytes(data)
 a={'path':str(target.relative_to(r)),'sha256':sha(target)}
 if data is not raw:a.update(encoding='gzip',uncompressedSha256=hashlib.sha256(raw).hexdigest())
 artifacts[str(target.relative_to(out))]=a
for p in sorted(b.glob('willyou-dev130-*')):
 if p.is_file() and p.suffix in ['.json','.log','.py','.cjs','.mjs','.ts']:copy(p,p.name)
for p in [archive,manifest]:copy(p,p.name)
for entry in entries:
 for p in sorted(entry['directory'].iterdir()):
  if p.is_file() and p.suffix in ['.json','.png','.log']:copy(p,'runs/'+entry['directory'].name+'/'+p.name)
 for p in sorted((entry['directory']/'project').iterdir()):
  if p.is_file() and p.suffix in ['.pdf','.md','.ts','.txt']:copy(p,'runs/'+entry['directory'].name+'/fixtures/'+p.name)
notes='''Y09 original R3.4/R3.4-P1 scope/steps/expected. I3 and A4 pass on macOS26.6.1arm64; no production, native, renderer, prototype, dependency, version, NOTICE or license changes. r75 App reused, ASAR59c70a032437fcac22ab8e7775ea6956079b549079523b4f896f43a65e291e26. Previous r75 six native smokes and82 runtime file hashes stay applicable; existing native-smoke verifies complete LibreOffice hashes/vendor signature, POI jars/classes/JRE/TeX and engine notices. Other platforms not installation-accepted.
31 direct M9 engine choices have exact package versions and exact lock specifier/resolution. General pre-existing app infrastructure dependency ranges are outside this parser-engine list; their upstream transitive declarations are not claimed range-free, actual resolution is frozen in lock. All275 license/notice files and NOTICE shipped byte-identically in actual ASAR, including general176 records, code-highlighting45 plus exact tm-grammars notice and16 MCP package provenance records; counts across manifests are not claimed distinct. All recorded notice hashes checked. No missing-notice list entries.
Actual initial static graph is4,528,421-byte index plus2,996-byte preload helper. Mermaid/PDF/math/highlighting8 large assets outside initial static closure, Worker assets remain lazy. Actual file UI: first-screen128 loaded script records contain no large engines; ordinary text starts original code-editor Worker, then TypeScript gets real colored tokens/trusted raw reply. Markdown math and Mermaid show actual output, math/Markdown Workers carry original packets, real sandboxed diagram window loads original module with real callable function then is destroyed. PDF opened after all previous Worker observers are restored: original native transfer semantics, actual canvas/text and actual lazy pdf module scriptParsed. No runtime network/download was needed; diagrams and packaged fonts/engines stay local. Readonly source hashes unchanged, original observers restored, final actual normal App exit0/null.
Actual unpacked logical file bytes1,539,508,570, symlinks separately counted (not compressed DMG size or measured filesystem allocated blocks). Contents Frameworks287,109,059;Resources1,244,651,184;MacOS52,800;outer signature7,691,434;plist/pkginfo4,093. LibreOffice26.2.4.2build0229ac93fcf0d7cbc6376066c6f35021cef002dc,17,610file/link entries,791,208,986bytes;fixed vendored mac runtime, no ambient Office fallback. POI5.5.1/Temurin21.0.12.1+1 and Tectonic0.17.0/offline selected v33 bundle use build-time fixed resources and original notices;native-smoke current r75 verifies startup/signatures/hashes. Mac x64 recipe exists but not tested here;Windows/Linux native file broker/complete Office business remain unverified/unsupported experimental boundaries.
Preserved driver failures: parse is shared by code and Markdown; filename applies only to parse not window messages; code consumer uses addEventListener and is invisible to onmessage-only observer; file:// Resource Timing is empty; PDF transfers detach ArrayBuffers legally and pure DTO JSON-before/after observer is inappropriate. Final driver uses actual protocol fields, passive trusted message observation, read-only CDP scriptParsed and hidden module/function+real render, restores code/Markdown observers before PDF. These are instrumentation failures, not product defects or fake green. Original positive loading/UI requirements retained. Earlier subset successes and cleanup kills are not counted as extra cases or final normal quits. All failures/sources/data saved. No pixel-fidelity/other-platform/IME/full release claim, no merge/tag/push/publish.'''
(out/'BOUNDARIES.txt').write_text(notes+'\n');artifacts['BOUNDARIES.txt']={'path':str((out/'BOUNDARIES.txt').relative_to(r)),'sha256':sha(out/'BOUNDARIES.txt')}
d={'at':now(),'caseIds':['M9-T-Y09'],'revision':'R3.4/R3.4-P1','environment':{'system':platform.platform(),'architecture':platform.machine(),'swVers':subprocess.check_output(['sw_vers'],text=True)},'branch':build['branch'],'head':build['head'],'sourceSnapshot':{k:v for k,v in m.items() if k!='files'},'app':old['app'],'results':{'codePassed':3,'codeFailed':0,'codeSkipped':0,'actualAppChecks':4,'selectedNormalAppExits':1,'exactDirectEngineVersions':31,'originalLicenseFilesVerified':275,'generalManifestRecords':176,'codeManifestRecords':45,'mcpProvenanceRecords':16,'initialStaticJsBytes':4531417,'largeLazyAssets':8,'appLogicalBytes':1539508570,'formalPassed':240,'formalTotal':419,'unexecuted':177,'blocked':2,'appRemaining':176},'platformBoundary':{'macOSarm64':'Actual r75 I/A package resources and loaded engines passed','macOSx64':'Fixed native build recipe only; not installation tested here','Windowsx64':'Experimental build recipe; native file/Office full business not validated here','Linuxx64':'Experimental build recipe; native file/Office full business not validated here'},'previousReport':{'path':str(previous.relative_to(r)),'sha256':sha(previous),'verifiedArtifacts':len(old['artifacts'])},'artifacts':artifacts,'boundary':notes,'releasePerformed':False};report.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(report),'sha256':sha(report),'artifacts':len(artifacts),'sourceFiles':1196,'sourceTarSha256':m['sha256']},ensure_ascii=False))
