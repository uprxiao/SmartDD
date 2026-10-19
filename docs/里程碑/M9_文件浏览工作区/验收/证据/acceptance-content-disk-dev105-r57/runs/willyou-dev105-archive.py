from pathlib import Path
import datetime,hashlib,json,platform,shutil,tarfile,io
root=Path('/Users/hx/hx/hxWork/SmartDD');stage=root/'docs/里程碑/M9_文件浏览工作区';tmp=Path('/private/tmp');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
previous=stage/'验收/证据/m9-acceptance-name-limit-dev104-r57-20261019.json';old=json.loads(previous.read_text());assert sha(previous)=='99223e507a21fbb989e058cee7042b737b5334454c39f73aa3236a10c4df21e0'
for v in old['artifacts'].values():assert sha(root/v['path'])==v['sha256'],v['path']
manifest=tmp/'willyou-m9-acceptance-batch-r57-dev105-completed-tested-sources.json';m=json.loads(manifest.read_text());assert m['fileCount']==1046 and sha(m['path'])==m['sha256']
for p,h in m['files'].items():assert sha(root/p)==h,p
assert all(p.endswith(('.test.ts','.test.tsx'))or p.startswith('scripts/')for p in m['changedFromPrevious']+m['addedFiles'])
code=json.loads((tmp/'willyou-dev105-code-r3.json').read_text());assert code['success'] and code['numPassedTests']==104 and not code['numFailedTests'];assert all(x['status']=='passed' for f in code['testResults']for x in f['assertionResults'])
assert 'Unhandled Errors' not in (tmp/'willyou-dev105-code-r3.log').read_text()
appdirs={'content':tmp/'willyou-content-cancel-app-eELRxb','disk':tmp/'willyou-terminal-disk-read-app-4I4f5H','window-regression':tmp/'willyou-window-boundary-app-qMPFnd'}
apps={k:json.loads((p/'result.json').read_text())for k,p in appdirs.items()};assert all(x['status']=='passed'for x in apps.values());assert [len(apps[k]['checks'])for k in appdirs]==[3,34,2]
a=apps['disk'];assert a['selectedStartIndex']==0 and len(a['watchTrace']['queue'])==16 and not a['watchTrace']['held'];assert all(p['delivered'] and p['before']==p['after']for p in a['watchTrace']['queue'])
assert all(x['bytes']==0 and x['executedCommands']==0 for k in ['content','disk']for x in apps[k]['receivers'].values())
assert all(x['asarSha256']==old['app']['asarSha256']for x in apps.values());runtime=json.loads((tmp/'willyou-dev105-runtime-r57.json').read_text());assert runtime['verified']==81
out=stage/'验收/证据/acceptance-content-disk-dev105-r57';assert not out.exists();out.mkdir(parents=True);artifacts={}
def copy(src,name):
 p=out/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,p);artifacts[name]={'path':str(p.relative_to(root)),'sha256':sha(p)}
for p in sorted(tmp.glob('willyou-dev105*')):
 if p.is_file()and p.suffix in ['.json','.log','.py']:copy(p,'runs/'+p.name)
copy(manifest,'source-final/manifest.json');copy(m['path'],'source-final/sources.tar.gz')
for p in m['changedFromPrevious']+m['addedFiles']:copy(root/p,'sources/'+p)
failed=[tmp/name for name in ['willyou-terminal-disk-read-app-4SQXzQ','willyou-terminal-disk-read-app-9coFw2','willyou-terminal-disk-read-app-6Y0xKJ','willyou-terminal-disk-read-app-LBB04z','willyou-terminal-disk-read-app-dsHnXm']]
for p in [*appdirs.values(),*failed]:
 assert (p/'result.json').exists()
 for file in sorted(p.iterdir()):
  if file.is_file()and(file.name in ['result.json','electron.log']or file.suffix=='.png'):copy(file,'apps/'+p.name+'/'+file.name)
 fixture=out/'fixtures'/f'{p.name}.tar.gz';fixture.parent.mkdir(exist_ok=True)
 # Only synthetic files, no userdata/profile/database or local credentials.
 with tarfile.open(fixture,'x:gz')as tar:
  for folder in ['A','B','project','T1','T2']:
   d=p/folder
   if d.exists():
    for file in sorted(d.rglob('*')):
     if file.is_file()and not file.is_symlink():tar.add(file,arcname=str(file.relative_to(p)),recursive=False)
 artifacts['fixtures/'+fixture.name]={'path':str(fixture.relative_to(root)),'sha256':sha(fixture)}
notes='''DEV105 failure and boundary history (2026-10-19)
R11 A r1 could not listen on loopback in sandbox (EPERM). r2 normal-permission own App passed 3/3, exact original packets/results unchanged.
First typecheck failed only a test RenderHook enabled:true literal inference; explicit shared props type fixed, final typecheck exit0.
Code r1 search25 passed. Combined r2 sandbox passed98/failed6 native-watch setup; normal-permission same sources r3 passed104/104, no Unhandled Errors. No production fix or increased timeout made those green.
Disk A r1/r2/r3 stopped at4 successful scenes. r4 debug starts at index4 and passed0; exact debug state shows original A loaded and tab pinned. Actual failure was app.open(sentinel) waiting for an unrendered virtual row. Earlier pin suspicion was incorrect. Current driver explicitly wheels actual tree; no Store/DOM scroll write. Exact early driver revisions were not separately snapshotted; preserve raw logs/results/screenshots without inventing their historic hashes.
Disk A r5 passed24 scenes, then waited for a resume button after actual tasks.kill; UI intentionally retains exited terminal, so this expectation was invalid. It also stopped native watch IDs while the renderer retained them, provoking an UNTRUSTED configure warning: a disclosed harness fault, not a newly found production defect. r6 waits actual task ptyId=null and real exit display; watcher remains alive and only original notification delivery is held. r6 complete34/34.
Final source snapshot contains final drivers, five additions and four test/driver changes against r57; all runtime production inputs are byte-identical. No rebuild, no prototype changes or reference/pixel claims. All own App input sequences serial; native code suite overlapped one UI instance. Two pre-existing external CLI opt-ins were not selected, cumulative code counts are historical union, not a new full suite. System IME/manual/daily-data and remote future cases remain separate.
'''
p=out/'failure-history.txt';p.write_text(notes);artifacts[p.name]={'path':str(p.relative_to(root)),'sha256':sha(p)}
report={'schemaVersion':1,'id':'M9-ACCEPTANCE-CONTENT-DISK-DEV105-R57','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localDate':'2026-10-19','status':'passed-two-cases','revision':'R3.4-20261017 / R3.4-P1','branch':m['branch'],'head':m['head'],'platform':platform.platform(),'fullCasesPassed':['M9-T-R11','M9-T-S09'],'regressionCasesPassed':['M9-T-C10','M9-T-C11','M9-T-L10','M9-T-L14'],'defects':[],'app':old['app'],'previousReport':{'path':str(previous.relative_to(root)),'sha256':sha(previous),'all105ArtifactsUnchanged':True},'sourceBaseline':{'files':m['fileCount'],'finalTestedSha256':m['sha256'],'previousSha256':old['sourceBaseline']['finalTestedSha256'],'changedFromPrevious':m['changedFromPrevious'],'addedFiles':m['addedFiles'],'productionChanges':[],'prototypeChanges':[],'reusedBuildBecauseRuntimeInputsUnchanged':True},'verification':{'codePassedDeduplicated':104,'newUniqueCodeTests':21,'newTestsByBoundary':{'R11_U':3,'R11_I':6,'S09_U':2,'S09_I':10},'cumulativeCodeUnion':1974,'externalCliOptInNotSelected':2,'actualNewChecks':37,'actualRegressionChecks':2,'actualUiTotalChecks':39,'nativeOriginalSearchRowsAndCancel':True,'diskStateTriggerWriterMatrix':32,'latePhysicalReplacementReplies':2,'deferredOriginalWatchPackets':16,'codeExit':0,'typecheckExit':0,'runtimeAssetsVerified':81,'nativeChecksReusedFromDEV104':6,'unhandledErrors':0,'formalPassed':205,'formalTotal':419,'formalRemaining':214,'unexecuted':212,'blocked':2,'appRemaining':211},'boundaries':[apps['content']['boundary'],apps['disk']['boundary'],'R11 A requires closing real modal before task/root click; direct scope lifecycle + real abort is I. Streaming original native operation already completed when success held, not a claim active OS read remains running. I start-pending boundary verifies cancellation of live native request signal.','Busy state is genuine own foreground PTY output, no model work. No-current-terminal is project view with authorized files and no task handoff. Stopped task confirms native ptyId null and actual exit output; browsed without resume.','Sixteen original watch notifications withheld only during reactivate/refresh; original channel, payload hashes and restoration verified. Two late-read cases physically replace inode, close and explicitly reopen before delivering original success or actual chmod000 PERMISSION.','Original r57 build six native smokes reused; current runtime81 hashes reverified, all production inputs unchanged, final1046-source tar/hash recoverable. No test-only mutation packaged.','No prototype UI change; only existing authorized flows tested, P/V/reference/physicalIME and all other unexecuted cases remain separate. Failures/partial results retained, no source replacement or daily AIS usage.'],'artifacts':artifacts}
path=stage/'验收/证据/m9-acceptance-content-disk-dev105-r57-20261019.json';assert not path.exists();path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(path.relative_to(root)),'sha256':sha(path),'artifacts':len(artifacts),'checks':report['verification']},ensure_ascii=False))
