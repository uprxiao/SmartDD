from pathlib import Path
import datetime, hashlib, json, platform, shutil, tarfile

root = Path('/Users/hx/hx/hxWork/SmartDD')
stage = root / 'docs/里程碑/M9_文件浏览工作区'
tmp = Path('/private/tmp')
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
previous = stage / '验收/证据/m9-acceptance-markdown-events-dev115-r66-20261019.json'
assert sha(previous) == '887386e0d81a241948d13eb3e54fe231c82201fcd210c8906e813efa0d6c6378'
old = json.loads(previous.read_text())
for entry in old['artifacts'].values(): assert sha(root / entry['path']) == entry['sha256']
build = json.loads((tmp / 'willyou-m9-acceptance-batch-r67-build-sources.json').read_text())
tested = json.loads((tmp / 'willyou-m9-acceptance-batch-r67-dev116-tested-sources.json').read_text())
assert build['fileCount'] == tested['fileCount'] == 1116
assert build['sha256'] == tested['sha256'] == '85987dd7c85b08e80466b611ec4d42b3cc419ad793086288964112c54f80018b'
assert tested['addedFiles'] == tested['changedFromPrevious'] == []
for path, value in tested['files'].items(): assert sha(root / path) == value, path
with tarfile.open(tested['path']) as archive:
    assert len(archive.getmembers()) == 1116
    for entry in archive.getmembers(): assert hashlib.sha256(archive.extractfile(entry).read()).hexdigest() == tested['files'][entry.name]
code = json.loads((tmp / 'willyou-dev116-code-final-r2.json').read_text())
assert code['success'] and code['numPassedTests'] == 204 and code['numFailedTests'] == code['numPendingTests'] == 0
assert 'Unhandled Errors' not in (tmp / 'willyou-dev116-code-final-r2.log').read_text()
native = json.loads((tmp / 'willyou-dev116-native-final-r2.json').read_text())
assert len(native['rows']) == 59 and len([row for row in native['rows'] if row.get('caseId') == 'M9-T-X07']) == 8
assert 'pass 241' in (tmp / 'willyou-dev116-prototype-models-final.log').read_text()
assert 'fail 0' in (tmp / 'willyou-dev116-prototype-models-final.log').read_text()
assert 'pass 4' in (tmp / 'willyou-dev116-sites-final.log').read_text()
def result(log):
    entry = next(json.loads(line) for line in reversed((tmp / log).read_text().splitlines()) if line.startswith('{"status":'))
    directory = Path(entry['artifacts']); return directory, json.loads((directory / 'result.json').read_text())
pdir, proto = result('willyou-dev116-prototype-ui-final.log')
adir, app = result('willyou-dev116-app-r1.log')
edir, events = result('willyou-dev116-events-regression-app.log')
mdir, math = result('willyou-dev116-math-regression-app.log')
for value, count in [(proto, 16), (app, 16), (events, 10), (math, 13)]:
    assert value['status'] == 'passed' and len(value['checks']) == count and all(row['pass'] for row in value['checks'])
for value in [proto, app, events, *math['sessions']]: assert value['exit']['code'] == 0 and value['exit']['signal'] is None
for value in [proto, app]: assert any(face['status'] == 'loaded' for face in value['fonts']) and not any(face['status'] == 'error' for face in value['fonts'])
for value in [app, events, *math['sessions']]:
    assert all(value['workerRestored'].values()) and all(value['rpcRestored'].values())
    for worker in value['workers']['rows']:
        for request in worker['inputs']: assert request['before'] == request['after']
        for message in worker['messages']:
            if message.get('deliveredAt'): assert message['before'] == message['after'] and message['trusted']
assert len([row for row in app['rpc']['rows'] if row['method'] == 'save']) == 16
assert all(value['expected'] == value['actual'] for value in app['files'].values()) and app['reopenedExactSavedSource']
assert events['nativeMouseupsAfterAllViewsClosed'] == []
assert json.loads((tmp / 'willyou-dev116-process-audit.json').read_text())['allClosed']
runtime = json.loads((tmp / 'willyou-dev116-runtime-r67.json').read_text()); assert runtime['verified'] == 82
hashes = json.loads((tmp / 'willyou-dev116-package-hashes.json').read_text())
assert hashes['asarSha256'] == app['asarSha256'] == events['asarSha256'] == math['asarSha256']
for key in ['brokerSha256', 'watcherSha256']: assert hashes[key] == old['app'][key]
smoke = next(json.loads(line) for line in (tmp / 'willyou-dev116-package-r67.log').read_text().splitlines() if line.startswith('{"version":'))
assert all(smoke[key] == 'passed' for key in ['sqlite', 'pty', 'voiceBridge', 'fileBroker', 'officeRenderer', 'fileWatcher'])
out = stage / '验收/证据/acceptance-math-selection-dev116-r67'
report = stage / '验收/证据/m9-acceptance-math-selection-dev116-r67-20261019.json'
assert not report.exists(); out.mkdir(exist_ok=True); artifacts = {}
def copy(path, label):
    target = out / label; target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists(): assert sha(path) == sha(target)
    else: shutil.copy2(path, target)
    artifacts[label] = {'path': str(target.relative_to(root)), 'sha256': sha(target)}
    assert sha(path) == sha(target)
for path in sorted(tmp.glob('willyou-dev116-*')):
    if path.is_file() and path.suffix in ['.json', '.log', '.py', '.cjs']: copy(path, path.name)
for path in sorted(tmp.glob('willyou-m9-acceptance-batch-r67*')):
    if path.is_file() and (path.suffix == '.json' or path.name.endswith('.tar.gz')): copy(path, path.name)
for log in ['willyou-dev116-prototype-ui-r1.log', 'willyou-dev116-prototype-ui-r2.log', 'willyou-dev116-prototype-ui-r3.log', 'willyou-dev116-prototype-ui-final.log', 'willyou-dev116-app-r1.log', 'willyou-dev116-events-regression-app.log', 'willyou-dev116-math-regression-app.log']:
    directory, value = result(log)
    files = {directory / 'result.json', *directory.glob('*electron.log')}
    if directory != tmp / 'willyou-math-selection-prototype-zobNmV': files.update(directory.glob('*.png'))
    # Only known static files in this batch's own scratch projects; never copy
    # userData, credentials, databases, pending-save staging or daily projects.
    if directory == adir: files.update(directory / 'project' / name for name in app['files'])
    for path in sorted(files): copy(path, 'runs/' + directory.name + '/' + str(path.relative_to(directory)))
for name in ['M9_Markdown与交互补充.md', '证据/m9-markdown-source-r2.json']: copy(stage / '调研' / name, 'reference/' + name)
notes = '''DEV116 completes X07 only, formal225/419 (53.70%). X03 remains unexecuted. Confirmed R3.4-P1 scope/steps/expected are unchanged. R uses retained M04 Un/Gn facts and trace, not new Codex access or full visual/dynamic parity. Mathematical offsets come from the actual pinned dollar-parser consumption, including closing-content offset before delimiter, normalized block body vs raw CRLF/CR/LF, inline quote/list prefix maps and frontmatter base. No HTML-to-source writeback. Focused source intersection removes the matching formula decorations; siblings remain widgets. Explicit source-focus effect and disposed-guarded focus updates restore formulas on blur. Other prose/heading/strong/link/image/entity decoration granularity remains X03.
Initial8 red failed all, then8 passed. Expanded8 native I+8 U all passed; final204 related checks0fail/skip/Unhandled. Native FileService, broker and FSEvents are real; Node worker_threads only adapts transport for the current unmodified compiled Markdown/KaTeX sources, CM and buffers real. U coalescing uses fake transport, separately disclosed, not real-engine evidence. Batch coalescing keeps the existing60-pending-request limit and all source/HTML/node budgets; each DOM signal releases its own result, last owner cancels original request. Actual old native broker/watcher bytes from r66 match r67.59 native rows include8 X07; legacy aggregate caseIds list has not been expanded, and coverage is derived from actual row caseId, not that old list.
FinalP241 models/build/Sites4 and16 actual light/dark browser scenarios pass; P synthetic range textarea portal retains sibling rendered formulas and source callbacks, not CM/native-file business. P attempt1 passed4 inline cases then multiline CSS attribute selector incorrectly used JSON escapes; fixed actual parser-offset selector without weakening position/source assertions. The P dev server also denied root pnpm KaTeX fonts; allow only the canonical exact KaTeX font directory, and final actual browser font faces load without errors. P attempt2 passed5 then nested block formula had no outer source metadata and no portal; actual parser range now supplies nested block source wrapper, mirrored production/prototype and revalidated204. P attempt3 passed16; final16 additionally retain source-selection screenshots and actual loaded font audit. First prototype build shell could not find local vite; root-installed binary succeeds. Initial TS event overload after span/div union is corrected with HTMLElement annotation, no runtime behavior change.
Actual r67 A16 cover paragraph, heading, quote, list, block, quote-block, list-block and eqno in light/dark. Assertions occur after real mousedown before mouse release: focused source caret equals contentEnd. Real arrows visit both endpoints and Shift-expand whole source range;8 inline scenarios additionally Shift-click next formula and verify exact anchor/head while third formula remains. Real Input.insertText replaces the deliberately selected full math range, blur restores new KaTeX.16 real native saves preserve untouched mixed EOL/source, all16 private files exactly match and saved file reopens. A/P do not inject DOM/Store/editor values, invoke source selection setters or clipboard. System theme in A is Chromium prefers-color-scheme environment emulation, not DOM editing. Read-only CM state and data ranges are observations. No models, external services/apps or live Codex. Workers and original file RPC data remain byte-identical and native messages trusted; observers restored, all own processes closed, normal App/P exits0.
Same r67 links/event A10 and real math lifecycle A13 also pass. The unchanged legacy math regression driver's string says X07 is outside its own claimed coverage; current X07 acceptance comes from this independent new16-scenario driver, not that old string. Lifecycle faults retain DEV114 disclosures: debugger-start pauses, explicit missing-module URL and native ErrorEvent gate preventDefault, no fake successes/errors or protocol result substitution. Final r67 six native smoke,82 runtime assets equal,1116 build/tested source snapshots byte-identical SHA85987dd7c85b08e80466b611ec4d42b3cc419ad793086288964112c54f80018b. No source changes after build. Earlier DEV115 report and all90 artifacts unchanged. No release/merge/tag/push. Manual/system/reference/platform, X03 and extra giant-block scrolling remain open; no scope removed to increase completion.
Initial read-only process audit in the default sandbox could not execute ps. Archive preflight then stopped on the missing process-audit file before creating an output directory or report. The same read-only check was rerun with authorized process access; no test/cleanup assertion was relaxed.
'''
note = out / 'failure-history.txt'; note.write_text(notes); artifacts[note.name] = {'path': str(note.relative_to(root)), 'sha256': sha(note)}
value = {
    'schemaVersion': 1, 'id': 'M9-ACCEPTANCE-MATH-SELECTION-DEV116-R67', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'localDate': '2026-10-19',
    'status': 'passed-one-case', 'revision': 'R3.4-20261017 / R3.4-P1; R06.2/R07.15/R01.6 unchanged', 'branch': tested['branch'], 'head': tested['head'],
    'platform': platform.platform(), 'macOS': platform.mac_ver()[0], 'architecture': platform.machine(),
    'fullCasesPassed': ['M9-T-X07'], 'regressionCases': ['M9-T-X01','M9-T-X02','M9-T-X04','M9-T-X05','M9-T-X06','M9-T-X08','M9-T-X09','M9-T-X10','M9-T-X11','M9-T-X12','M9-T-H14','M9-T-H17'],
    'productionChanges': [path for path in build['changedFromPrevious'] + build['addedFiles'] if path.startswith('src/') and not path.endswith('.test.ts') and not path.endswith('.test.tsx')],
    'prototypeChanges': [path for path in build['changedFromPrevious'] + build['addedFiles'] if path.startswith('prototypes/')],
    'defects': [{'id':'M9-DEV-116-01','state':'fixed-and-r67-retested','problem':'Mathematical mousedown selected the whole block start; all sibling math disappeared.','fix':'Exact parser contentEnd, node-level mathematical source decorations, focus/blur restoration and coalesced real engine groups.'},{'id':'M9-DEV-116-02','state':'fixed-and-r67-retested','problem':'Nested block math had no source wrapper, so prototype source editing portal could not mount.','fix':'Attach the actual raw parser range for nested block tokens and mirror the source map in production and prototype.'}],
    'app': {'path':'/private/tmp/willyou-m9-acceptance-batch-r67-build/mac-arm64/WillYou.app','version':'0.0.5','published':False,**hashes,'nativeChecks':smoke,'runtimeAssetsVerified':82},
    'previousReport': {'path':str(previous.relative_to(root)),'sha256':sha(previous),'all90ArtifactsUnchanged':True},
    'sourceBaseline': {'buildFiles':1116,'testedFiles':1116,'buildSha256':build['sha256'],'finalTestedSha256':tested['sha256'],'postBuildProductionChanges':[],'postBuildExternalChanges':[],'postBuildNewFiles':[]},
    'verification': {'codePassedDeduplicated':204,'newUniqueCodeTests':16,'newTestsByBoundary':{'U':8,'I':8},'currentSkipped':0,'prototypeModelsPassed':241,'prototypeSitesPassed':4,'prototypeActualUiChecks':16,'actualUiChecks':16,'actualEventRegressionUiChecks':10,'actualMathRegressionUiChecks':13,'nativeWorkerInstances':len(app['workers']['rows']),'originalFileRpcRows':len(app['rpc']['rows']),'intentionalPrivateFixtureSaves':16,'completedBatchNormalQuits':[app['exit'],events['exit'],*[session['exit'] for session in math['sessions']]],'prototypeNormalQuit':proto['exit'],'codeExit':0,'typecheckExit':0,'prototypeBuildExit':0,'packageExit':0,'unhandledErrors':0,'formalPassed':225,'formalTotal':419,'formalRemaining':194,'unexecuted':192,'blocked':2,'appRemaining':191},
    'boundaries': [app['boundary'],proto['boundary'],'R retained M04 facts and confirmed scope; no new Codex runtime/source/full pixel claim. X03 prose/heading/strong/link/image/entity granularity remains open.','Native I adapts only Worker/IPC transport and jsdom geometry/focus; U coalescing fake session is not real-engine acceptance. Native broker/watcher bytes match the new actual App.','Actual mouse/keyboard/save/reopen results and native Worker/RPC forwarding are separate from synthetic P. A theme uses prefers-color-scheme environment emulation. KaTeX font faces actually loaded without error in P and A.','Mathematical lifecycle A13 retains existing explicit fault boundaries and old driver scope text; independent new A16 provides X07 proof. Related204 is not a fresh repository-wide test suite. No new security/CLI/platform/physical IME claim.','No release. All419 must still pass; system/manual/reference/platform and unclassified extra scrolling observations remain open.'],
    'artifacts': artifacts,
}
report.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'report':str(report.relative_to(root)),'sha256':sha(report),'artifacts':len(artifacts),'formalPassed':225}, ensure_ascii=False))
