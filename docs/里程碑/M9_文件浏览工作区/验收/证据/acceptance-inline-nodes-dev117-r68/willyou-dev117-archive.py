from pathlib import Path
import datetime,hashlib,json,platform,shutil,tarfile
root=Path('/Users/hx/hx/hxWork/SmartDD');stage=root/'docs/里程碑/M9_文件浏览工作区';tmp=Path('/private/tmp')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
previous=stage/'验收/证据/m9-acceptance-math-selection-dev116-r67-20261019.json'
assert sha(previous)=='3c8b23fa2f23537076645ad792fbd96e68d1c94876c73ad8d1ad9e10e5de2bf1'
old=json.loads(previous.read_text())
for row in old['artifacts'].values():assert sha(root/row['path'])==row['sha256'],row['path']
build=json.loads((tmp/'willyou-m9-acceptance-batch-r68-build-sources.json').read_text());tested=json.loads((tmp/'willyou-m9-acceptance-batch-r68-dev117-tested-sources.json').read_text())
assert build['fileCount']==tested['fileCount']==1125
assert build['sha256']=='d00b8f85bad0925c610d686e7ee5422f33dfda167d54d4e572ca263a7498d67d'
assert tested['addedFiles']==[] and tested['changedFromPrevious']==['scripts/files/markdown-inline-ui.mjs']
for path,value in tested['files'].items():assert sha(root/path)==value,path
for manifest in [build,tested]:
 assert sha(manifest['path'])==manifest['sha256']
 with tarfile.open(manifest['path']) as archive:
  assert len(archive.getmembers())==1125
  for row in archive.getmembers():assert hashlib.sha256(archive.extractfile(row).read()).hexdigest()==manifest['files'][row.name]
code=json.loads((tmp/'willyou-dev117-code-final.json').read_text());native=json.loads((tmp/'willyou-dev117-native-final.json').read_text())
assert code['success'] and code['numPassedTests']==226 and code['numFailedTests']==code['numPendingTests']==0
assert 'Unhandled Errors' not in (tmp/'willyou-dev117-code-final.log').read_text()
assert len(native['rows'])==66 and sum(row.get('caseId')=='M9-T-X03' for row in native['rows'])==7
assert 'pass 241' in (tmp/'willyou-dev117-prototype-models.log').read_text() and 'fail 0' in (tmp/'willyou-dev117-prototype-models.log').read_text()
assert 'pass 4' in (tmp/'willyou-dev117-sites.log').read_text()
def result(log):
 row=next(json.loads(line) for line in reversed((tmp/log).read_text().splitlines()) if line.startswith('{"status":'))
 directory=Path(row['artifacts']);return directory,json.loads((directory/'result.json').read_text())
plogs=['willyou-dev117-prototype-inline-ime.log','willyou-dev117-prototype-math-verified.log','willyou-dev117-prototype-events-verified.log']
alogs=['willyou-dev117-app-inline-ime-verified.log','willyou-dev117-app-math-selection-verified.log','willyou-dev117-app-events-verified.log','willyou-dev117-app-math-lazy-verified.log','willyou-dev117-app-source-verified.log']
pairs=[result(log) for log in plogs+alogs]
for (_,value),count in zip(pairs,[20,16,18,20,16,10,13,11]):
 assert value['status']=='passed' and len(value['checks'])==count
 assert all(row.get('pass',True) for row in value['checks'])
 for own in [*value.get('sessions',[]),*([value] if value.get('exit') else [])]:
  assert own['exit']['code']==0 and own['exit']['signal'] is None
  for key in ['workerRestored','rpcRestored','linkRestored','eventRestored']:
   if key in own:assert all(own[key].values())
  for worker in own.get('workers',{}).get('rows',[]):
   for request in worker.get('inputs',[]):assert request['before']==request['after']
   for message in worker.get('messages',[]):
    if message.get('deliveredAt'):assert message['before']==message['after'] and message['trusted']
inline=pairs[3][1];assert len([row for row in inline['rpc']['rows'] if row['method']=='save'])==2
assert len(inline['actualLinkRows'])==2
assert json.loads((tmp/'willyou-dev117-process-audit.json').read_text())['allClosed']
assert json.loads((tmp/'willyou-dev117-runtime-r68.json').read_text())['verified']==82
hashes=json.loads((tmp/'willyou-dev117-package-hashes.json').read_text())
for _,value in pairs[3:]:assert value['asarSha256']==hashes['asarSha256']
for key in ['brokerSha256','watcherSha256']:assert hashes[key]==old['app'][key]
smoke=next(json.loads(line) for line in (tmp/'willyou-dev117-package-r68.log').read_text().splitlines() if line.startswith('{"version":'))
assert all(smoke[key]=='passed' for key in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
report=stage/'验收/证据/m9-acceptance-inline-nodes-dev117-r68-20261019.json';out=stage/'验收/证据/acceptance-inline-nodes-dev117-r68'
assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
def copy(path,label):
 target=out/label;target.parent.mkdir(parents=True,exist_ok=True)
 if target.exists():assert sha(path)==sha(target)
 else:shutil.copy2(path,target)
 artifacts[label]={'path':str(target.relative_to(root)),'sha256':sha(target)}
 assert sha(path)==sha(target)
for path in sorted(tmp.glob('willyou-dev117-*')):
 if path.is_file() and path.suffix in ['.json','.log','.py','.cjs','.mjs']:copy(path,path.name)
for path in sorted(tmp.glob('willyou-m9-acceptance-batch-r68*')):
 if path.is_file() and (path.suffix=='.json' or path.name.endswith('.tar.gz')):copy(path,path.name)
finaldirs={directory for directory,_ in pairs}
for log in sorted(tmp.glob('willyou-dev117-*.log')):
 rows=[json.loads(line) for line in log.read_text().splitlines() if line.startswith('{"status":')]
 if not rows:continue
 directory=Path(rows[-1]['artifacts']);value=json.loads((directory/'result.json').read_text())
 paths={directory/'result.json',*directory.glob('*electron.log')}
 if directory in finaldirs:paths.update(directory.glob('*.png'))
 elif value['status']=='failed' and (directory/'failure.png').exists():paths.add(directory/'failure.png')
 if directory==pairs[3][0]:
  paths.update(directory/'project'/name for name in ['light-inline.md','dark-inline.md','other.txt','other2.txt','tiny.png','tiny2.png'])
 for path in sorted(paths):copy(path,'runs/'+directory.name+'/'+str(path.relative_to(directory)))
for name in ['M9_Markdown与交互补充.md','证据/m9-markdown-source-r2.json']:copy(stage/'调研'/name,'reference/'+name)
notes='''DEV117 is a PARTIAL X03 checkpoint. Full cases passed=[], formal225/419 (53.70%) unchanged,192 unexecuted/2 blocked,191 remaining with A. Original steps/expected/scope preserved. Retained M02 summary and source-trace metadata do not contain exact per-node selection/focus predicates; both recorded original module locations are absent. No fresh Codex access, REA retrieval, copied restricted artifacts or exact pixel claim. Current containing-link policy for image/entity is explicit local migration behavior, not proved Codex equivalence. Higher heading levels/full dynamic or visual coverage and physical IME candidate state remain unverified.
Initial6 plan tests red, then6 green, expanded7; shared8 plus native7 give22 new tests U15/I7. Typecheck first failed implicit-any atomic arrays; explicit Range<Decoration>[] fixes it. Final226 related code tests0fail/skip/Unhandled;66 native rows include7 X03 and8 X07. Native FileService/broker/FSEvents real; current compiled parser/KaTeX transport and jsdom geometry adapted for I, fake transport isolated in U. P241 models,build,Sites4 pass. P now uses actual production CM source/editor and workers with synthetic image/link host, no real native authority. Actual mouse/keyboard source editing never changes Store/editor/DOM values directly. Source full raw UTF16 and line endings remain authoritative.
P math r1 failed0 because first lazy dependency optimization reloaded page/reset synthetic input. Vite explicit deps/entries/dedupe fixes it without scanning unrelated predev temp imports. P math r2 1pass then heading caret33!=32; r3 2pass then quote30!=29. Actual asynchronous layout moved formula before Shift-click. Driver now waits original ready siblings/two RAF and hits a verified current glyph point; exact caret/anchor/head assertions unchanged. r4 and final16 pass. P events r1 6pass then missing real CM anchor; waits actual parsed mark and final18 pass. P inline r1 2pass then entity Boolean check incorrectly included unrelated escaped-star entity. Selector now addresses exact raw-from, with stronger unrelated-entity-retained assertion; final20 pass. Old failures/results retained. No A functional failures.
Standalone P harness initially missed real parent file-workspace stylesheet; importing it exposed legacy parent heading overrides. Shared scoped block selectors, default fw-md-block, source-core and parent padding now align own P/A; no claim full Codex pixel parity. Final own A light source-heading and dark rendered screenshots inspected. Inline fixture is all CRLF, not mixed-EOL; separate source11 and native cases cover mixed EOL. Final P54=inline20+math16+events18, final A70=inline20+math16+events10+lazy13+source11. Earlier18 duplicates not added. Inline A makes2 actual native saves, checks exact fixture bytes/images and2 actual text-link calls; image related calls are observed separately. Browser-native Chromium composition preedit/commit/cancel verified inside bold; physical system IME candidate state not verified.
Original Worker/native requests/results, RPC observations forwarded unchanged and restored. No clipboard/model/external App/service/live Codex. Native lazy faults retain prior boundaries: debugger pause, missing-module native failure and synchronous preventDefault of native error gate, no invented protocol success/error. Existing legacy lazy driver X07 scope text is limited to that driver; independent math16 supplies current regression proof. Six normal A quits and three selected final P quits exit0; all21 own known PIDs closed including exact5188 Vite. No unrelated process closed. r68 six smoke/82 runtime assets equal,1125 source files. Only external inline driver changed after build (image-link filtering, composition checks); no production/prototype/build input change. Previous DEV116 report/all147 artifacts unchanged. No commit/merge/tag/push/release. Extra unclassified giant-block scroll observation and remaining system/reference/platform cases remain open.
'''
path=out/'failure-history.txt';path.write_text(notes);artifacts[path.name]={'path':str(path.relative_to(root)),'sha256':sha(path)}
value={
 'schemaVersion':1,'id':'M9-ACCEPTANCE-INLINE-NODES-DEV117-R68','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localDate':'2026-10-19','status':'partial-case-checkpoint',
 'revision':'R3.4-20261017 / R3.4-P1; original X03 steps/expected/scope unchanged','branch':tested['branch'],'head':tested['head'],'platform':platform.platform(),'macOS':platform.mac_ver()[0],'architecture':platform.machine(),
 'fullCasesPassed':[],'partialCases':['M9-T-X03'],'regressionCases':['M9-T-X01','M9-T-X02','M9-T-X04','M9-T-X05','M9-T-X06','M9-T-X07','M9-T-X08','M9-T-X09','M9-T-X10','M9-T-X11','M9-T-X12'],
 'productionChanges':[p for p in build['changedFromPrevious']+build['addedFiles'] if p.startswith('src/') and not p.endswith(('.test.ts','.test.tsx'))],
 'prototypeChanges':[p for p in build['changedFromPrevious']+build['addedFiles'] if p.startswith('prototypes/')],
 'defects':[{'id':'M9-DEV-117-01','state':'fixed-and-r68-retested','problem':'Selecting one inline node removed all sibling semantic decorations; default P used a separate textarea implementation.','fix':'Parser-derived per-node plans and focus/selection-aware decorations, shared production CM core in P.'},{'id':'M9-DEV-117-02','state':'fixed-and-r68-retested','problem':'Legacy prototype parent heading CSS overrode shared rendering.','fix':'Scope actual shared block styles and align own P container/source-core padding.'}],
 'app':{'path':'/private/tmp/willyou-m9-acceptance-batch-r68-build/mac-arm64/WillYou.app','version':'0.0.5','published':False,**hashes,'nativeChecks':smoke,'runtimeAssetsVerified':82},
 'previousReport':{'path':str(previous.relative_to(root)),'sha256':sha(previous),'all147ArtifactsUnchanged':True},
 'sourceBaseline':{'buildFiles':1125,'testedFiles':1125,'buildSha256':build['sha256'],'finalTestedSha256':tested['sha256'],'postBuildProductionChanges':[],'postBuildExternalChanges':tested['changedFromPrevious'],'postBuildNewFiles':[]},
 'verification':{'codePassedDeduplicated':226,'newUniqueCodeTests':22,'newTestsByBoundary':{'U':15,'I':7},'nativeRows':66,'nativeX03Rows':7,'currentSkipped':0,'unhandledErrors':0,'prototypeModelsPassed':241,'prototypeSitesPassed':4,'prototypeActualUiChecks':54,'actualUiChecks':70,'actualInlineUiChecks':20,'actualMathSelectionUiChecks':16,'actualEventUiChecks':10,'actualLazyMathUiChecks':13,'actualSourceUiChecks':11,'intentionalInlineNativeSaves':2,'completedBatchNormalQuits':[own['exit'] for _,v in pairs[3:] for own in ([v] if v.get('exit') else v['sessions'])],'prototypeNormalQuits':[v['exit'] for _,v in pairs[:3]],'codeExit':0,'typecheckExit':0,'prototypeBuildExit':0,'packageExit':0,'formalPassed':225,'formalTotal':419,'formalRemaining':194,'unexecuted':192,'blocked':2,'appRemaining':191},
 'boundaries':[inline['boundary'],'Retained R M02 is insufficient for exact node predicates. Missing raw source is recorded; no bypass or fresh Codex access. X03 status stays unexecuted with partial evidence.','Synthetic P shares real CM/source/workers and fixture-only hosts; no native IO evidence. I transport/jsdom adapters and U fake transports are separate from actual A.','All-CRLF inline fixture; mixed EOL comes from independent source/native regressions. Browser composition is not physical system IME candidate evidence.','Related226 is not a fresh repository-wide suite. Full visual/dynamic/reference/platform and extra scrolling observations remain open. All419 still required.'],
 'artifacts':artifacts}
report.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'report':str(report.relative_to(root)),'sha256':sha(report),'artifacts':len(artifacts),'formalPassed':225,'fullCasesPassed':[]},ensure_ascii=False))
