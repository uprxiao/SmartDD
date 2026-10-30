from pathlib import Path
import json,hashlib,tarfile,gzip,io,subprocess,datetime,platform,shutil
r=Path.cwd();s=r/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp')
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
 return h.hexdigest()
now=datetime.datetime.now(datetime.timezone.utc).isoformat();prior=s/'验收/证据/m9-acceptance-pdf-rendering-dev136-r79-20261019.json';assert sha(prior)=='44a7109bbf2529a572fc0989b7cab818f1eebc24f4471626584da066d14ac9ed';old=json.loads(prior.read_text());assert all(sha(r/a['path'])==a['sha256'] for a in old['artifacts'].values())
basePath=r/old['artifacts']['willyou-dev136-source-delta.json']['path'];base=json.loads(basePath.read_text());assert len(base['files'])==1237
changed={p:sha(r/p) for p,h in base['files'].items() if sha(r/p)!=h};assert set(changed)=={'docs/真实App自动验收流程.md'},changed
new=set(subprocess.check_output(['rg','--files','src','native','scripts','prototypes/m6-codex/tests'],text=True).splitlines())-set(base['files']);new.add('docs/里程碑/M9_文件浏览工作区/技研/实验/dev137-pdf-lifecycle-budget.json');assert len(new)==6,new
added={p:sha(r/p) for p in sorted(new)};hashes={**base['files'],**changed,**added};assert len(hashes)==1243
budget='2f9d3ff33d5fc97446597f929d20fd65af6b3db43722534f28bc87dab2f2b808';assert sha(r/'docs/里程碑/M9_文件浏览工作区/技研/实验/dev137-pdf-lifecycle-budget.json')==budget
def tar_bytes(path,items):
 with path.open('wb') as raw:
  with gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w|') as t:
    for name,data in sorted(items.items()):
     a=tarfile.TarInfo(name);a.mode=0o644;a.size=len(data);t.addfile(a,io.BytesIO(data))
delta=b/'willyou-dev137-source-delta.tar.gz';tar_bytes(delta,{p:(r/p).read_bytes() for p in changed|added});m={'at':now,'previousReport':str(prior.relative_to(r)),'previousReportSha256':sha(prior),'previousManifest':str(basePath.relative_to(r)),'previousManifestSha256':sha(basePath),'deltaPath':str(delta),'deltaSha256':sha(delta),'changedFiles':changed,'addedFiles':added,'files':hashes,'fileCount':1243,'productionNativeDependenciesUnchanged':True};(b/'willyou-dev137-source-delta.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
formal={'I':'willyou-pdf-lifecycle-I-tSoseh','A26-passed-subchecks-overall-failed-supplement':'willyou-pdf-lifecycle-app-EDaEfU','A1-supplemental':'willyou-pdf-lifecycle-app-HFX5O0'}
i=json.loads((b/formal['I']/'result.json').read_text());a=json.loads((b/formal['A26-passed-subchecks-overall-failed-supplement']/'result.json').read_text());z=json.loads((b/formal['A1-supplemental']/'result.json').read_text())
assert i['status']=='passed' and len(i['checks'])==12 and a['status']=='failed' and len(a['checks'])==26 and z['status']=='passed' and len(z['checks'])==1
assert all(c['pass'] for d in [i,a,z] for c in d['checks']);assert all(d['budgetSha256']==budget for d in [i,a,z]);assert all(d['asarSha256']==old['app']['asarSha256'] for d in [i,a,z]);assert all(d['exit']['code']==0 and d['exit']['signal'] is None for d in [i,z])
assert a['before']==z['before']==z['after'];assert not i['final']['engineWorkers'] and not i['final']['observation']['activePdfTimers'];assert not z['silentCleanup']['settled']['activePdfTimers'];assert not z['finalObservation']['activePdfTimers']
contractMs=max(c['result']['ms'] for c in i['checks']);closeMs=max(x['ms'] for d in [a,z] for c in d['checks'] for x in c['result']['destroyed']);watchMs=max(x['firedAt']-x['at'] for x in z['checks'][0]['fired']);metrics={'contractDisposeMaxMs':contractMs,'trustedCloseToNativeTargetDestroyedMaxMs':closeMs,'originalWatchdogObservedMs':watchMs,'silentExitCleanupWaitMs':z['silentCleanup']['ms'],'retryToReadyMs':z['checks'][0]['restoredMs']};assert contractMs<1000 and closeMs<1000 and 15000<=watchMs<=17000 and metrics['retryToReadyMs']<5000
fixture=json.loads((b/'willyou-dev137-fixtures.json').read_text());project=Path(fixture['projectPath'])
for name,h in z['after'].items():
 p=project/name;st=p.stat();assert h=={'sha256':sha(p),'inode':str(st.st_ino),'mtimeNs':str(st.st_mtime_ns),'ctimeNs':str(st.st_ctime_ns)}
app=Path(old['app']['path']);assert sha(app/'Contents/Resources/app.asar')==old['app']['asarSha256'];assert sha(app/'Contents/Resources/native/willyou-files')==old['app']['brokerSha256'];v=json.loads((b/'willyou-dev137-runtime-r79.json').read_text());assert v['verified']==82 and all(sha(r/x['file'])==x['sha256'] for x in v['files']);u=json.loads((b/'willyou-dev137-U.json').read_text());assert u['success'] and u['numPassedTests']==19 and not u['numFailedTests'] and not u['numPendingTests'];assert 'error TS' not in (b/'willyou-dev137-typecheck.log').read_text();assert not json.loads((b/'willyou-dev137-process-audit.json').read_text())['remainingProcesses']
out=s/'验收/证据/acceptance-pdf-lifecycle-dev137-r79';out.mkdir(exist_ok=True);arts={}
def copy(p,label):
 p=Path(p);q=out/label;q.parent.mkdir(parents=True,exist_ok=True);meta={}
 if p.suffix=='.json' and p.stat().st_size>1048576:
  q=q.with_name(q.name+'.gz');meta={'encoding':'gzip','uncompressedSha256':sha(p)}
  with p.open('rb') as src,q.open('wb') as dst:
   with gzip.GzipFile(filename='',fileobj=dst,mode='wb',mtime=0) as gz:shutil.copyfileobj(src,gz,1048576)
 else:shutil.copyfile(p,q)
 arts[str(q.relative_to(out))]={'path':str(q.relative_to(r)),'sha256':sha(q),**meta}
for p in sorted(b.glob('willyou-dev137-*')):
 if p.is_file() and p.suffix in ['.log','.json','.mjs','.py','.gz']:copy(p,p.name)
for p in sorted((b/'willyou-dev137-before').rglob('*')):
 if p.is_file():copy(p,'before/'+str(p.relative_to(b/'willyou-dev137-before')))
for run in ['willyou-pdf-lifecycle-I-R1TJK7',*formal.values()]:
 p=b/run
 for q in sorted(p.iterdir()):
  if q.is_file() and q.suffix in ['.log','.json','.png','.mjs','.cjs','.html']:copy(q,'runs/'+p.name+'/'+q.name)
raws={c['name']:(project/c['name']).read_bytes() for c in fixture['cases']};assert all(sha(project/c['name'])==c['sha256'] for c in fixture['cases']);raws['fixtures.json']=(project.parent/'fixtures.json').read_bytes();tar_bytes(b/'willyou-dev137-fixture-files.tar.gz',raws);copy(b/'willyou-dev137-fixture-files.tar.gz','fixtures.tar.gz')
boundary='Y18 original I/A scope, steps and expected unchanged. Actual production renderer engine/session-slot bundled only for import/format adaptation in separate sandbox/contextIsolation/no-node browser window, using original packaged PDF.js and native Worker; authenticated native file reads match exact four synthetic source bytes. I12 actual browser contract checks,3 rounds each:200-page inflight load dispose, actual pending Worker page RPC rejected and post-dispose run rejected, real password wait dispose, old active and queued owner cancelled/final normal3-page only. All15 I native targets destroyed, own PDF timers/explicit engine port listeners/ports0. Normal unchanged r79 A26 individually passed: light/dark3 rounds of200-page startup-close, password wait-close, rapid bulk/alternate/normal switching and close/reopen fresh real Worker/canvas, plus one actual uncaught Worker JS error/retry per theme. Trusted native ErrorEvent and actual thread termination, not fabricated ErrorEvent or OS segfault. Supplemental silent Worker close waits original15000ms pending-operation watchdog then original200ms destructor handshake; A1 final pass with timers/ports/explicit listeners0 and fresh retry. A26 fullrun overall failed only because supplemental immediate assertion raced real200ms cleanup; retain raw89MB trace gzip with original SHA and actual intermediate state. Selected independent failed supplemental rerun only, unchanged source/ASAR/budget, not one27-check fullgreen run. Earlier I driver waited paused before request on idle Worker, fixed order; no production defect. Snapshot formatter compacted after first A to avoid repeated cumulative89MB metadata, original observer archived; forwarding/identity/ownership unchanged. Frozen pre-execution budgetv1.1 unchanged; source/native/dependencies no change, no new package. r79 original6smokes/hashes reused and82runtime files newly verified.19U/typecheck pass. Four source hashes/inodes/mtime/ctime unchanged across A26 and A1, all4 owned instances closed. Selected I12 and A1 normal exit0/null; failed I/A cleanup not normalexit proof. Root PDF resource counts + native Worker context destruction measured, no global listener/heap/RSS/GPU or long-term budget claim. No password entered or recorded, model/CLI/clipboard/external-app launch. Two worker-error screenshots personally viewed; no R/V or other-case pass claimed. Current1243 source files recoverable via1237 base+7-file delta. Formal248/419=59.19%,169unexecuted+2blocked,168includeA. Y14/Y17 still partial missingV; existing system/manual/platform gaps unchanged. No release.'
report=s/'验收/证据/m9-acceptance-pdf-lifecycle-dev137-r79-20261019.json';assert not report.exists();data={'at':now,'caseIds':['M9-T-Y18'],'caseCompletion':'passed: all original I/A requirements','revision':'R3.4/R3.4-P1','branch':'feature/0.0.1','head':old['head'],'environment':{'system':platform.platform(),'architecture':platform.machine()},'app':old['app'],'sourceSnapshot':{k:v for k,v in m.items() if k!='files'},'results':{'formalPassed':248,'formalTotal':419,'unexecuted':169,'blocked':2,'appRemaining':168,'actualBrowserIntegrationChecks':12,'unitTests':19,'appMainPassedSubchecks':26,'appSupplementalRerunChecks':1,'appMainRunOverall':'failed on supplemental cleanup wait assertion','selectedNormalExits':2,'ownedInstancesClosed':4},'metrics':metrics,'formalRuns':formal,'fixtures':fixture,'artifacts':arts,'boundary':boundary,'releasePerformed':False};report.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(report.relative_to(r)),'sha256':sha(report),'artifacts':len(arts),'sourceFiles':1243,'metrics':metrics},ensure_ascii=False))
