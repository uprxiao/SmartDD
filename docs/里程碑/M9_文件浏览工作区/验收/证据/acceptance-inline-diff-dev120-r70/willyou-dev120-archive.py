from pathlib import Path
import datetime,gzip,hashlib,json,platform,shutil,tarfile
root=Path('/Users/hx/hx/hxWork/SmartDD');stage=root/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
previous=stage/'验收/证据/m9-acceptance-save-failure-dev119-r69-20261019.json'
assert sha(previous)=='1f4e009a4b99a4cddea1bf4f950654133242a48b6b718f0cba79527583a3a967'
old=json.loads(previous.read_text());prior=stage/'验收/证据/m9-acceptance-text-conflict-dev118-r69-20261019.json'
assert sha(prior)=='9c41075e8191f8ffc29d579eca31552f5225bb28e52dd275f6a2ad70dfabd873'
for report in [old,json.loads(prior.read_text())]:
 for item in report['artifacts'].values():assert sha(root/item['path'])==item['sha256']
build=json.loads((b/'willyou-m9-acceptance-batch-r70-build-sources.json').read_text())
tested=json.loads((b/'willyou-m9-acceptance-batch-r70-dev120-tested-sources.json').read_text())
assert build['fileCount']==tested['fileCount']==1148 and tested['changedFromPrevious']==['scripts/files/inline-diff-ui.mjs'] and not tested['addedFiles']
for p,h in tested['files'].items():assert sha(root/p)==h,p
for manifest in [build,tested]:
 assert sha(manifest['path'])==manifest['sha256']
 with tarfile.open(manifest['path']) as tar:
  assert len(tar.getmembers())==1148
  for e in tar.getmembers():assert hashlib.sha256(tar.extractfile(e).read()).hexdigest()==manifest['files'][e.name]
code=json.loads((b/'willyou-dev120-code-and-source-audit.json').read_text());assert code['uniqueCodePassed']==179
native=json.loads((b/'willyou-dev120-native-heavy-final.json').read_text());assert len(native['rows'])==10
native_code=json.loads((b/'willyou-dev120-native-heavy-code.json').read_text());assert native_code['success'] and native_code['numPassedTests']==10 and native_code['numPendingTests']==native_code['numFailedTests']==0
for n in ['code-final-r2','native-heavy-code','keep-local-final-code']:assert 'Unhandled Errors' not in (b/('willyou-dev120-'+n+'.log')).read_text()
def run(name):
 log=b/('willyou-dev120-'+name+'.log');row=next(json.loads(line) for line in reversed(log.read_text().splitlines()) if line.startswith('{"status":'));p=Path(row['artifacts']);return p,json.loads((p/'result.json').read_text())
runs={name:run(name) for name in ['app-red','prototype-ui-r1','prototype-ui-r2','prototype-heavy-final','app-diff-verified','app-diff-r2','app-conflict-r2','app-math-selection-r2','app-source-r2']}
assert runs['app-red'][1]['status']=='failed' and len(runs['app-red'][1]['checks'])==0
assert runs['prototype-ui-r1'][1]['status']=='failed' and len(runs['prototype-ui-r1'][1]['checks'])==7
assert runs['app-diff-verified'][1]['status']=='failed' and len(runs['app-diff-verified'][1]['checks'])==1
expected={'prototype-ui-r2':14,'prototype-heavy-final':16,'app-diff-r2':16,'app-conflict-r2':20,'app-math-selection-r2':16,'app-source-r2':11}
for name,count in expected.items():
 p,r=runs[name];assert r['status']=='passed' and len(r['checks'])==count and all(c['pass'] for c in r['checks']),name
 assert r['exit']['code']==0 and r['exit']['signal'] is None
 for key in ['rpcRestored','workerRestored']:
  if key in r:assert all(r[key].values()),(name,key)
 for row in r.get('rpc',{}).get('rows',[]):
  if row.get('delivered'):assert row['before']==row['after']
hashes=json.loads((b/'willyou-dev120-app-hashes-r70.json').read_text());assert hashes['runtimeAssetsVerified']==82
for name in ['app-diff-r2','app-conflict-r2']:assert runs[name][1]['asarSha256']==hashes['asarSha256']
audit=json.loads((b/'willyou-dev120-process-audit.json').read_text());assert audit['allClosed'] and audit['ownViteStopped']
assert 'pass 243' in (b/'willyou-dev120-prototype-models.log').read_text() and 'fail 0' in (b/'willyou-dev120-prototype-models.log').read_text()
assert 'pass 4' in (b/'willyou-dev120-prototype-sites-freeze.log').read_text() and 'fail 0' in (b/'willyou-dev120-prototype-sites-freeze.log').read_text()
assert 'built in' in (b/'willyou-dev120-prototype-build-freeze-verified.log').read_text()
smoke=json.loads(next(line for line in reversed((b/'willyou-dev120-package-r70.log').read_text().splitlines()) if line.startswith('{"version":')))
for name in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher']:assert smoke[name]=='passed'
assert json.loads((stage/'验收/用例覆盖索引.json').read_text())==json.loads((b/'willyou-dev120-index-before.json').read_text())
out=stage/'验收/证据/acceptance-inline-diff-dev120-r70';report=stage/'验收/证据/m9-acceptance-inline-diff-dev120-r70-20261019.json';assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
def copy(p,label):
 target=out/label;target.parent.mkdir(parents=True,exist_ok=True)
 if target.exists():assert sha(target)==sha(p)
 else:shutil.copy2(p,target)
 artifacts[label]={'path':str(target.relative_to(root)),'sha256':sha(target)}
def result(p,label):
 if p.stat().st_size<1000000:return copy(p,label)
 data=p.read_bytes();target=out/(label+'.gz');target.parent.mkdir(parents=True,exist_ok=True);compressed=gzip.compress(data,mtime=0)
 if target.exists():assert target.read_bytes()==compressed
 else:target.write_bytes(compressed)
 assert gzip.decompress(target.read_bytes())==data
 artifacts[label+'.gz']={'path':str(target.relative_to(root)),'sha256':sha(target),'encoding':'gzip','uncompressedSha256':sha(p),'uncompressedBytes':len(data)}
for p in sorted(b.glob('willyou-dev120-*')):
 if p.is_file() and p.suffix in ['.json','.log','.py','.mjs','.cjs']:copy(p,p.name)
for suffix in ['build-sources','dev120-tested-sources']:
 for ext in ['json','tar.gz']:
  p=b/('willyou-m9-acceptance-batch-r70-'+suffix+'.'+ext);copy(p,p.name)
for p,r in runs.values():
 result(p/'result.json','runs/'+p.name+'/result.json')
 for f in sorted({*p.glob('*electron.log'),*p.glob('*.png')}):copy(f,'runs/'+p.name+'/'+f.name)
notes='''DEV120 completes H33 only: formal228/419(54.42%),189unexecuted/2blocked,188remaining with A. R3.4/R3.4-P1 and original scope, steps, thresholds, expected remain unchanged. Old r69 actual A0 failed at missing diff budget/display, preserved as implementation red. Official MIT @codemirror/merge6.12.1 exact pin and notices/manifest176 records,0missing. No private Codex/Yoda resource acquired; local ../yoda does not exist. Retained B07 is the functional threshold reference; no new Codex or full pixel/theme/font matching claim.
Raw UTF16 <=262144 and CRLF/CR/LF lines <=5000 on BOTH local and disk permit diff; either over disables only comparison and explains why. File load/edit/save limits and host three choices are separate. Real CM unified diff has no accept/reject controls. scanLimit500/timeout50 are algorithm coarse fallback controls, not a hard total50ms guarantee. Exact raw source preview in a transactionExtender removes diff before downstream fields calculate an over-budget document; undo restores permitted comparison. originalDocChangeEffect updates changed disk source, never file baseline or local history. Stale view vs buffer coherence guard protects explicit disk selection. Full readonly CM disk source replaces prior262144-unit pre truncation, permitting complete safe select and rejecting edits, with no clipboard claim.
New31 checks=U21(policy10/controller7/source2/read-only-view2) and I10(boundaries7 plus public decisions3). Related code179 unique=175 run plus separate keep-local3 plus one new heavy fixture; full current native10 rerun overlaps9, not added again. Native I uses actual source/FileBuffer/CodeMirror merge/FileService/broker/recovery; jsdom geometry, fake timers, unrelated syntax/Markdown workers isolated. It is not actual UI/highlighting evidence. Native r69 broker reused because its bytes equal new r70; no fabricated native response. Boundary fixtures include both sides over separately, raw CRLF/emoji, equality, and simultaneous262144raw/5000lines with mostly disjoint versions. U instrumentation observes actual merge diff, does not substitute the algorithm.
P243 models, current build/Sites4 and actual isolated shared-core P16 pass. P labels synthetic data, never reads native files; full shared FileWorkspace wiring is compiled, isolated P16 is not a full-workspace pixel claim. Initial P7 passed then theme button was clipped by inherited margin-top:-40px; fix only isolated harness viewport layout, retain failure and unchanged assertions. Earlier unit64pass1fail twice used JSX text literal backslashes instead of CRLF; corrected fixture to actual newline. Initial missing-module policy red, sandbox Vite bind EPERM and pnpm prototype build vite-not-found retained; final uses existing root Vite binary and normal prepare-sites script, not dependency replacement.
Normal r70 actual App63 checks pass: new H33 light/dark16, H18 conflict decisions20, math selection16, source boundaries11. H33 actual pointer/keyboard converts B to L, actual independent writer D, real refresh/conflict, no hidden save or baseline choice, raw native draft still B-base/L-source. Real EOF insertion crosses threshold and undo reinstates diff. Full D readonly source model/selection exact and editing ignored. Explicit keep/disk/continue controls remain reachable below/above limits; real saves use D revision and exact CRLF/emoji bytes; diff removed only on real resolution. First r70 A passed growth1 then external driver query had invalid nested quoting; original observers restored, failure kept, fixed selector serialization only and reran unchanged assertions. No production input changed after package, only this external driver file; both source snapshots saved. All final App4 instances quit normally0/null and observers restore, known8 PIDs and9 scratch prefixes audited, own Vite stopped. Failure cleanup is not normal-quit evidence. No Store/editor/DOM value injection, clipboard, system IME, model, credentials, external services/apps, daily resources or pending recovery touched.
r70 macOS arm64 internal0.0.5 unpublished, six native smoke pass,82 runtime files match. Build1148 source tar3b991ad426d61ed62282dda427f93f3ee951c29755381547049224195f2001a6; tested1148 tarba7421cedcbcaab09ee58cf65d430f770e5d5b4a6425f618bae58c18befec9b9, only scripts/files/inline-diff-ui.mjs post-build change. Previous DEV11974 and DEV11893 artifacts verified unchanged. Large synthetic result JSON stored gzip with original byte hash and lossless verification; no userData/databases/bundles archived. All419 still required; H20/X03/reference/system/manual/platform and DEV111 extra giant-Markdown scrolling observation remain open. No commit/merge/tag/push/release.
'''
p=out/'failure-history.txt';p.write_text(notes);artifacts[p.name]={'path':str(p.relative_to(root)),'sha256':sha(p)}
value={'schemaVersion':1,'id':'M9-ACCEPTANCE-INLINE-DIFF-DEV120-R70','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localDate':'2026-10-19','status':'passed-one-case','revision':'R3.4 / R3.4-P1; H33 R07.7 original scope/steps/expected unchanged','branch':tested['branch'],'head':tested['head'],'platform':platform.platform(),'architecture':platform.machine(),'fullCasesPassed':['M9-T-H33'],'defects':[{'id':'M9-DEV-120-01','status':'fixed-and-retested','description':'r69 lacked inline diff and display-only bounds; full readonly disk source and explicit version decisions now preserved'}],'app':{'path':'/private/tmp/willyou-m9-acceptance-batch-r70-build/mac-arm64/WillYou.app','version':'0.0.5','published':False,**hashes,'nativeChecks':smoke},'previousReport':{'path':str(previous.relative_to(root)),'sha256':sha(previous),'all74ArtifactsUnchanged':True,'additionalDEV118ArtifactsUnchanged':93},'sourceBaseline':{'buildFiles':1148,'testedFiles':1148,'buildSha256':build['sha256'],'finalTestedSha256':tested['sha256'],'postBuildChanges':tested['changedFromPrevious'],'productionChangesAfterBuild':[],'prototypeChangesAfterBuild':[],'addedFilesFromDEV119':build['addedFiles'],'changedFromDEV119':build['changedFromPrevious']},'verification':{'currentCodeUniquePassed':179,'newUniqueCodeTests':31,'newTestsByBoundary':{'U':21,'I':10},'nativeH33Rows':10,'currentSkipped':0,'unhandledErrors':0,'currentTypecheckExit':0,'prototypeModels':243,'prototypeActualSharedCoreChecks':16,'prototypeSitesChecks':4,'actualUiChecks':63,'newH33UiChecks':16,'regressionChecks':{'H18':20,'mathSelection':16,'sourceBoundary':11},'normalQuitRuns':4,'formalPassed':228,'formalTotal':419,'formalRemaining':191,'unexecuted':189,'blocked':2,'appRemaining':188},'reference':{'retainedB07':'docs/里程碑/M9_文件浏览工作区/调研/M9_文件类型与编辑状态全集.md','upstream':['https://github.com/codemirror/merge/blob/main/src/unified.ts','https://github.com/codemirror/merge/blob/main/src/diff.ts'],'pin':'@codemirror/merge@6.12.1','license':'MIT','newCodexEvidence':False},'boundaries':[native['boundary'],runs['prototype-heavy-final'][1]['boundary'],runs['app-diff-r2'][1]['boundary'],'No full pixel/reference/system clipboard/physical IME/other-platform claim. Original all419 remain required.'],'artifacts':artifacts}
report.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(report.relative_to(root)),'sha256':sha(report),'artifacts':len(artifacts),'formalPassed':228,'percentage':round(228/419*100,2)},ensure_ascii=False))
