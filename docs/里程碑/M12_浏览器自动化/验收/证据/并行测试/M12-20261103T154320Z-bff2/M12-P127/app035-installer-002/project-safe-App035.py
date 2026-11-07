#!/usr/bin/python3
"""Pure-file S6 projection. Does not execute installer, native, App or tests."""
from pathlib import Path
import copy, datetime, hashlib, json, re, shutil, stat

ROOT = Path(__file__).parent
START = ROOT / 'installed-startup-001'
OUT = ROOT / 'safe-delivery-001'
RED = Path('/private/tmp/willyou-m12-app035-installer-001-partial-binding-001')
SOURCE = Path('/private/tmp/willyou-m12-browser-code-style-source-039/source-inputs.json')
BUILD = Path('/private/tmp/willyou-m12-browser-code-style-App035-build-001/result.json')

def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()

def load(path):
    return json.loads(Path(path).read_text())

def save(relative, value):
    path = OUT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

references = {}
provenance = []

def ref(path, boundary='Whole original file SHA only; private bytes retained unchanged'):
    path = Path(path)
    key = str(path)
    if key not in references:
        references[key] = {'path': key, 'sha256': sha(path), 'bytes': path.stat().st_size,
                           'mode': stat.S_IMODE(path.stat().st_mode), 'boundary': boundary}
    return references[key]

def original(path, relative=None):
    path = Path(path)
    relative = relative or str(path.relative_to(ROOT))
    target = OUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    assert sha(target) == sha(path)
    provenance.append({'member': relative, 'transformation': 'original bytes', 'source': ref(path)})

def pick(value, keys):
    return {key: copy.deepcopy(value[key]) for key in keys if key in value}

assert not OUT.exists(), 'Never overwrite an existing delivery'
OUT.mkdir()
raw = load(START / 'raw.json')
cleanup = load(START / 'cleanup.json')
judge = load(START / 'result.json')
six = load(ROOT / 'first-six-state.json')
release = load(ROOT / 'coordinator-resource-release.json')
size = load(ROOT / 'size-accounting-file-recheck.json')
comparison = load(ROOT / 'evidence/install-and-compare-result.json')
native = load(ROOT / 'evidence/installed-native-result.json')
candidate = load(ROOT / 'evidence/candidate-installer.json')

assert len(six['phases']) == 6 and all(p['exitCode'] == 0 for p in six['phases'])
assert len(judge['checks']) == 8 and all(p['passed'] is True for p in judge['checks'])
assert len(raw['commands']) == 3 and len({c['tag'] for c in raw['commands']}) == 3
assert all(c['actual']['code'] == 0 and c['actual']['signal'] is None and not c['actual']['timedOut']
           and c['actual']['cleanupSignals'] == [] for c in raw['commands'])
assert raw['appExit']['code'] == 0 and raw['appExit']['signal'] is None
assert raw['observedProcess']['signals'] == [] and raw['cleanupErrors'] == []
assert cleanup['allClear'] and release['allClear'] and size['allIndependentSumsMatch']
assert all(row['absent'] for row in cleanup['processes'] + cleanup['ports'])
assert all(row['socket']['absent'] and row['parent']['absent'] for row in cleanup['unix'])
assert all(row['clear'] and row['remainingRuntimeFiles'] == [] for row in cleanup['helpers'])
assert release['ownedMountsRemaining'] == [] and release['installedAppProcessPrefixCount'] == 0
assert comparison['inputEqualsDmgEqualsInstalled'] and comparison['identicalInstalledEntries'] == 20240
assert comparison['allOwnedMountsDetached'] and all(x['detachExitCode'] == 0 for x in comparison['cleanup'])
assert all(native['actualSixNativeChecks'][k] == 'passed' for k in
           ['sqlite', 'pty', 'voiceBridge', 'fileBroker', 'officeRenderer', 'fileWatcher'])

# Only recorded local transport paths and debug endpoint strings are inspected;
# no token values, auth files, databases or runtime directory traversal is used.
gateway_paths = set(raw.get('exactGatewayPaths', []))
for task in raw['tasks']:
    endpoint = task.get('receiver', {}).get('endpointPath')
    if endpoint:
        gateway_paths.add(endpoint)
electron_log = (START / 'electron.log').read_text()
debug_endpoints = set(re.findall(r'wss?://[^\s\"<>]+', electron_log))
redactions = []

def redact(value, context=''):
    if isinstance(value, list):
        return [redact(v, context + '[]') for v in value]
    if isinstance(value, dict):
        return {k: redact(v, context + '.' + k) for k, v in value.items()}
    if isinstance(value, str):
        for endpoint in gateway_paths | debug_endpoints:
            if endpoint in value:
                redactions.append({'path': context, 'category': 'owned-transport-endpoint', 'count': value.count(endpoint)})
                value = value.replace(endpoint, '<private-owned-transport>')
        value, count = re.subn(r'http://127\.0\.0\.1:\d+', '<synthetic-owned-http-site>', value)
        if count:
            redactions.append({'path': context, 'category': 'synthetic-fixture-origin', 'count': count})
        return value
    return value

safe_raw = pick(raw, ['group', 'case', 'layer', 'startedAt', 'finishedAt', 'driverPid', 'appPid',
                     'sourceManifestSha256', 'asarSha256', 'actualVersions', 'mainWindow', 'projectId',
                     'setupReload', 'installedCliProof', 'actualInstalledRuntime', 'actualStartupUi',
                     'status', 'appExit', 'observedProcess', 'httpClosed', 'cleanupErrors', 'boundary'])
safe_raw['commands'] = []
for command in raw['commands']:
    c = pick(command, ['role', 'tag', 'argv', 'taskId', 'runId', 'scheduledAt', 'parsed', 'extracted'])
    c['actual'] = pick(command['actual'], ['kind', 'pid', 'tag', 'argv', 'code', 'signal', 'timedOut',
                                         'cleanupSignals', 'startMonoNs', 'finishMonoNs', 'role', 'atMs'])
    c['actual']['originalStdoutSHA256'] = hashlib.sha256(command['actual']['stdout'].encode()).hexdigest()
    c['actual']['originalStderrBytes'] = len(command['actual']['stderr'].encode())
    c['actual']['stdoutScope'] = 'Original JSON parsed above, public synthetic URL origin redacted; exact original raw retained by whole-file SHA'
    safe_raw['commands'].append(c)
safe_raw['tasks'] = []
for task in raw['tasks']:
    t = pick(task, ['role', 'taskId', 'ptyId', 'aiProfileId', 'runId', 'cliPlan', 'planEvidence',
                    'url', 'pageId', 'readinessSamples'])
    t['health'] = pick(task['health'], ['id', 'name', 'runner', 'executable', 'check', 'checking'])
    t['receiver'] = pick(task['receiver'], ['kind', 'pid', 'binary', 'binarySha256', 'hasCliToken',
                                          'hasCliEndpoint', 'boundary', 'role', 'atMs'])
    t['receiver']['endpointValueArchived'] = False
    t['callerBoundary'] = 'Configured runner label codex, actual controlled receiver.py; no real Codex/OpenAI model invocation'
    safe_raw['tasks'].append(t)
safe_raw['cleanupSteps'] = []
for step in raw['cleanupSteps']:
    s = pick(step, ['label', 'at', 'status'])
    value = step.get('value')
    if step['label'] in ['normal-own-app-quit', 'observe-owned-child-exit', 'close-own-HTTP']:
        s['value'] = copy.deepcopy(value)
    elif step['label'].startswith('stop-own-task') and isinstance(value, dict):
        s['value'] = pick(value, ['id', 'projectId', 'ptyId', 'title', 'recovery', 'recoveryReason'])
        s['runtimeSnapshotArchived'] = False
    elif step['label'] == 'read-final-caller-events':
        s['eventCount'] = len(value)
        s['actualCliExitCodes'] = [v['code'] for v in value if v.get('kind') == 'cli-result']
    elif step['label'] == 'readonly-exact-owned-gateway-paths':
        s['ownedGatewayCount'] = len(value)
    elif step['label'] == 'final-resource-inventory':
        s['processes'] = copy.deepcopy(value['processes'])
        s['helpers'] = [{'pageId': x['pageId'], 'pids': x.get('pids', []),
                         'runtimeFileCount': len(x.get('names', []))} for x in value['helpers']]
    safe_raw['cleanupSteps'].append(s)
safe_raw['httpRequests'] = [pick(v, ['at', 'method', 'path', 'role']) for v in raw['requests']]
safe_raw['sourceRaw'] = ref(START / 'raw.json')
safe_raw['projectionBoundary'] = 'No full runtime, health env values, runtimeSnapshot, token, raw sockets/debug endpoint or original transport log. Synthetic CLI is actual installed Host I; not model R or foreground UI.'
safe_raw = redact(safe_raw, 'startup.raw')
safe_raw['redactions'] = copy.deepcopy(redactions)
save('installed-startup-001/raw.safe.json', safe_raw)
safe_cleanup = pick(cleanup, ['at', 'scope', 'processes', 'ports', 'allClear', 'originalNormalExit', 'originalHarness'])
safe_cleanup['sourceOriginal'] = ref(START / 'cleanup.json')
safe_cleanup['unix'] = [{'category': 'exact-owned-gateway', 'socketAbsent': x['socket']['absent'],
                         'parentAbsent': x['parent']['absent']} for x in cleanup['unix']]
safe_cleanup['helpers'] = [pick(x, ['pageId', 'clear', 'remainingRuntimeFiles']) for x in cleanup['helpers']]
save('installed-startup-001/cleanup.safe.json', safe_cleanup)
save('installed-startup-001/electron-log.safe.json', {'sourceOriginal': ref(START / 'electron.log'),
     'text': redact(electron_log, 'electron.log'), 'fullOriginalTransportLogArchived': False})

# Unmodified non-secret installer outputs, inventory metadata and frozen code.
outputs = ['first-six-state.json', 'root-startup-admission-review.json', 'coordinator-resource-release.json',
           'size-accounting-file-recheck.json', 'binding.json', 'runner-manifest.json', 'input-binding-receipt.json',
           'post-binding-file-review.json', 'directory-shape.json', 'clone-lineage.json', 'source039-inventory.projection.json',
           'cached-baseline-reference.json', 'official-build-input-adapter.json', 'current-static-App035.json',
           'evidence/candidate-installer.json', 'evidence/install-and-compare-result.json',
           'evidence/installed-native-result.json', 'evidence/installed-native-smoke-exit.json',
           'evidence/installed-helper-version-exit.json', 'evidence/installed-helper-signature-exit.json',
           'evidence/installed-signature.json', 'evidence/installed-native-smoke.stdout',
           'evidence/installed-native-smoke.stderr', 'evidence/installed-helper-version.stdout',
           'evidence/installed-helper-version.stderr', 'evidence/installed-helper-signature.stdout',
           'evidence/installed-helper-signature.stderr', 'evidence/private-copy-result.json',
           'evidence/private-install-copy.json', 'evidence/prepackaged-input-pins.json',
           'evidence/previous-payload-inventory.json', 'evidence/candidate-payload-inventory.json',
           'evidence/size-comparison.json', 'evidence/startup-pin-binding.json',
           'evidence/attempt-002/installer-build-start.json', 'evidence/attempt-002/installer-build-exit.json',
           'evidence/attempt-002/installer-build-input-preservation.json',
           'evidence/attempt-002/prepackaged-signature-gate.json',
           'evidence/attempt-002/installer-build.stdout', 'evidence/attempt-002/installer-build.stderr',
           'installed-startup-001/result.json', 'installed-startup-001/execution-started.json',
           'installed-startup-001/execution-installation-gates.json',
           'installed-startup-001/execution-pin-verification.json', 'installed-startup-001/pin.json',
           'installed-startup-001/pin.template.json', 'installed-startup-001/contract.json']
for name in outputs:
    original(ROOT / name)
for path in sorted(ROOT.glob('P127-*.log')):
    original(path)
for name in ['execution-ready.json', 'prepared-inputs.json', 'manifest.json', 'bound-input-manifest.json',
             'pending-pin-map.json', 'pure-binding-request.json', 'external-read-paths.json',
             'input-boundary.json', 'phase-resources.json', 'plan.json', 'pre-binding-PythonAST-App035.json',
             'installed-startup-001/execution-ready.json']:
    original(ROOT / name, 'frozen-inputs/' + name)
code = ['bind-App035-inputs.py', 'binding_static.py', 'binding_guard.py', 'run-first-six.py',
        'prepare-native-input.py', 'build-installer-002.py', 'install-and-compare.py',
        'check-installed-native.py', 'bind-installed-pins.py', 'check-final-resources.py', 'recheck-size.py']
initial = load(ROOT / 'manifest.json')['files']
code += [name for name in initial if name.startswith('installed-startup-001/') and '/node_modules/' not in name
         and Path(name).suffix in ['.mjs', '.py', '.patch']]
for name in sorted(set(code)):
    original(ROOT / name, 'frozen-inputs/' + name)
original(Path(__file__), 'project-safe-App035.py')

# The original failed first purebind remains a distinct red, never installation green.
red_files = ['partial-manifest.json', 'parent-reported-failure.json']
for name in red_files:
    original(RED / name, 'partial-binding-red-001/' + name)
for name in ['manifest.json', 'pure-binding-request.json', 'binding.json', 'prepared-inputs.json',
             'execution-ready.json', 'pending-pin-map.json', 'bind-App035-inputs.py',
             'binding_static.py', 'current-static-App035.json']:
    original(RED / 'frozen-partial' / name, 'partial-binding-red-001/frozen-partial/' + name)
save('partial-binding-red-001/boundary.json', {
    'originalRoot': '/private/tmp/willyou-m12-app035-installer-001', 'tool': '8ebaff', 'exitCode': 1,
    'failureClass': 'driver path retarget omission',
    'failure': 'Outer external template retained nonexistent browser-profile-App035-build-001 official log, while actual build is browser-code-style-App035-build-001',
    'partialBindingReadyTrueIsNotExecutionReady': True, 'installerPhasesExecuted': 0, 'NativeAppExecuted': 0,
    'originalPartialNeverResumed': True, 'new002ClonedFromUnexecuted034': True,
    'correction': 'Complete build-directory mapping plus immutable external-read-file existence/hash/mode admission before binder writes',
    'toolTraceBoundary': 'Full cfa70e/8ebaff tool transcripts remain with Root; parent-reported description is labeled and is not a fabricated full trace'})

for path in [START / 'raw.json', START / 'cleanup.json', START / 'electron.log', START / 'cli-results.jsonl',
             ROOT / 'manifest.json', ROOT / 'prepared-inputs.json', ROOT / 'bound-input-manifest.json', SOURCE, BUILD]:
    ref(path)
save('source-and-private-references.json', {'wholeFileHashesOnly': True, 'references': list(references.values()),
     'notArchived': ['App/DMG/native executable bytes', 'DB/Cookie/auth/WAL/SHM or real credentials',
                     'full Native or raw runtime/environment', 'complete debug/Unix/HTTP transport endpoints',
                     'runtime/cache/node_modules trees'],
     'recovery': 'Frozen own code copied, shared151 dependency bytes referenced by exact hashes/modes and original symlink; official source/build and large binary bytes private by whole-file SHA'})
save('member-provenance.json', {'members': provenance, 'originalFilesUnmodified': True})
save('result.safe.json', {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'group': 'M12-App035-S6-affected',
    'cases': ['M12-T140', 'M12-T143'], 'status': 'all-original-nine-phases-and-eight-judges-passed-Root-review-required',
    'App': 'App035/source039', 'sourceManifestSHA256': raw['sourceManifestSha256'], 'asarSHA256': raw['asarSha256'],
    'firstSix': {'driverPID': six['driverPid'], 'phasePIDs': [x['pid'] for x in six['phases']],
                 'numericExitCodes': [x['exitCode'] for x in six['phases']]},
    'startup': {'driverPID': raw['driverPid'], 'AppPID': raw['appPid'], 'stockCLICount': len(raw['commands']),
                'numericExitCodes': [c['actual']['code'] for c in raw['commands']], 'checks': judge['checks'],
                'normalExit': raw['appExit'], 'signals': raw['observedProcess']['signals'],
                'hiddenWindow': all(x['visible'] is False for x in raw['mainWindow'])},
    'fullPayload': pick(comparison, ['baselinePayloadEntries', 'candidatePayloadEntries', 'identicalInstalledEntries',
                                    'inputEqualsDmgEqualsInstalled', 'allOwnedMountsDetached']),
    'installedNative6': native['actualSixNativeChecks'], 'DMG': candidate['artifacts'][0], 'size': size,
    'startupCleanupCounts': {'PID': len(cleanup['processes']), 'TCP': len(cleanup['ports']),
                             'Unix': len(cleanup['unix']), 'helper': len(cleanup['helpers']), 'allClear': cleanup['allClear']},
    'finalResource': release, 'currentOuterReadySHA256': sha(ROOT / 'execution-ready.json'),
    'currentStartupReadySHA256': sha(START / 'execution-ready.json'),
    'originalPartialBindingRed': 'partial-binding-red-001/boundary.json',
    'UTypeBoundary': '035 official build/native6 newly executed; 034 actual50U/11files and bothTS reused using3688nonCSS source equality, not claimed fresh035U/type execution',
    'managedCallerBoundary': 'Synthetic receiver health/config plus actual installed TaskService/managed PTY/stock native CLI; no real model/OpenAI R',
    'T140T143PreviouslyAccepted': True, 'formalCaseIncrement': 0, 'publicLedgerModified': False,
    'resourcesHeld': False, 'resourceState': 'Root independently cleared and released actual own resources before this file-only projection',
    'boundary': 'Local ad-hoc macOS arm64 preview installer only; no foreground UI, models, real auth, x64, notarization, DeveloperID or publishing claim'})

# Static member scan only. Does not inspect real auth values or execute any code.
members = [p for p in OUT.rglob('*') if p.is_file()]
for path in members:
    content = path.read_bytes()
    for endpoint in gateway_paths | debug_endpoints:
        assert endpoint.encode() not in content, 'Transport endpoint leaked: ' + str(path)
    assert not re.search(rb'wss?://(?:127\.0\.0\.1|localhost):\d+/[0-9a-f-]{16,}', content), path
    assert path.suffix not in ['.dmg', '.asar', '.db', '.sqlite', '.node', '.dylib'], path
    assert not path.is_symlink(), path
save('projection-audit.json', {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'method': 'Same explicit S6 safe schema as App030, original bytes for reviewed nonsecret outputs/code; scoped safe raw/cleanup/log projection',
    'redactions': redactions, 'allMemberTransportLeakScanPassed': True,
    'sourceRawSHA256': sha(START / 'raw.json'), 'sourceCleanupSHA256': sha(START / 'cleanup.json'),
    'noCredentialValuesReadOrCopied': True, 'originalSensitiveSourceHashesAreWholeFileOnly': True,
    'privateFullSourceUnaffected': True, 'NativeAppOSModelExecutedDuringProjection': False,
    'formalCaseIncrement': 0, 'resourcesHeld': False})
files = [{'path': str(p.relative_to(OUT)), 'sha256': sha(p), 'bytes': p.stat().st_size,
          'mode': stat.S_IMODE(p.stat().st_mode)} for p in sorted(OUT.rglob('*')) if p.is_file()]
save('manifest.json', {'schema': 'M12-S6-safe-delivery-v1', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
     'group': 'M12-App035-S6-affected', 'cases': ['M12-T140', 'M12-T143'], 'files': files,
     'currentOuterReadySHA256': sha(ROOT / 'execution-ready.json'),
     'currentStartupReadySHA256': sha(START / 'execution-ready.json'),
     'allNinePhasesPassed': True, 'allEightJudgesPassed': True, 'formalCaseIncrement': 0,
     'resources': {'held': False, 'startupIndependentAllClear': True, 'RootFinalAllClear': True}})
print(json.dumps({'safeRoot': str(OUT), 'manifestSHA256': sha(OUT / 'manifest.json'),
                  'files': len(files), 'formalIncrement': 0, 'resourcesHeld': False}))
