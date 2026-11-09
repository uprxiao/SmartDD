"""Read-only original data/proof re-adjudication; no OS/Native/runtime calls."""
import ast
import copy
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path('/private/tmp/willyou-m12-p103-cpu-proof-review-001')
CURRENT = Path('/private/tmp/willyou-m12-p103-app021-long-002/payload')
PRIOR = Path('/private/tmp/willyou-m12-p096-sync-metrics-long-001/payload')
SHA023 = '28e48dc679b777e5fe4e55ddb5c152ef74e046131955fd5a32f42867af6b1d42'
SHA024 = '26e9637bf5b5a77b63dc89930c71461180e593b4889f7cc9487fb92e7d8662c0'
SHA025 = 'fc0804c493320514f4938d76755c6d0bdc9aa42adb41c30813ffedafaa74b6c9'
PARENT = '705f0fc17120278f5f9158077985185c830129208b2d47ea80fcfd7e5bdd2353'
BRIDGE = 'ff8999695dec76dfa69abf43877e6d8f3764e7fa902ee6fb1a0c706e73f1d4c8'
PROBE = '755731dfa3a2a01fe89235766a895b83829ae9254c48a0596839174b093a2447'
HELPER = '8ee2435e2019810409c47f1a8b97534738c937b3d2c01f8c74425172d62f13a3'

def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def load(path):
    return json.loads(Path(path).read_text())

def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def verify_proof(current_pin, prior_pin, raw, parent, bridge, manifests, original_files, source_refs, native_inputs):
    """All original proof predicates on the exact original 11 plus a separately bound parent chain."""
    files = current_pin.get('files', [])
    old_files = prior_pin.get('files', [])
    original_map = {f['path']: f['sha256'] for f in old_files}
    current_map = {f['path']: f['sha256'] for f in files}
    expected = set(original_map) | {'source024-parent-bridge.json'}
    old_basis = len(old_files) == len(original_map) == 11
    original_11 = old_basis and len(files) == len(current_map) == 12 and set(current_map) == expected
    original_11 = original_11 and all(current_map.get(k) == v for k, v in original_map.items())
    predicates = {
        'original-P096-exact-11-required-set-and-current-one-extra-no-duplicates': original_11,
        'original-P096-11-each-prior-current-actual-SHA': all(x['priorActualSha256'] == x['currentActualSha256'] == x['requiredSha256'] for x in original_files),
        'original-fixed-probe007-manifest-pin': current_pin.get('probe007ManifestSha256') == prior_pin.get('probe007ManifestSha256') == PROBE,
        'original-source-manifest-bound-to-native-raw': current_pin.get('sourceManifestSha256', current_pin.get('source023ManifestSha256')) == raw.get('sourceManifest') == SHA025,
        'original-current-bridge-actual-SHA': current_pin.get('newSourceBridgeSha256') == BRIDGE == sha(CURRENT / 'source024-inheritance-bridge.json'),
        'original-fixed-helper-source-manifest-pin': current_pin.get('helperSourceManifestSha256') == prior_pin.get('helperSourceManifestSha256') == HELPER,
        'original-every-current-declared-proof-file-actual-SHA': all(sha(CURRENT / f['path']) == f['sha256'] for f in files),
        'original-probe007-actual-manifest-SHA': sha(CURRENT / 'coalition-evidence/probe007-manifest.json') == PROBE,
        'extra-parent-is-exact-original-P096-bridge': current_map.get('source024-parent-bridge.json') == PARENT == sha(CURRENT / 'source024-parent-bridge.json') == sha(PRIOR / 'source024-inheritance-bridge.json') == prior_pin.get('newSourceBridgeSha256'),
        'extra-current-bridge-references-exact-parent': bridge.get('previousSourceBridge') == {'path': 'source024-parent-bridge.json', 'sha256': PARENT},
        'extra-full-source-chain-023-to024-to025': parent.get('priorSourceManifestSha256') == SHA023 and parent.get('currentSourceManifestSha256') == SHA024 == bridge.get('priorSourceManifestSha256') and bridge.get('currentSourceManifestSha256') == SHA025 and current_pin.get('baselineSource023ManifestSha256') == prior_pin.get('baselineSource023ManifestSha256') == SHA023 and prior_pin.get('sourceManifestSha256') == SHA024,
        'extra-actual-source-manifest-hashes': all(x['actualSha256'] == x['requiredSha256'] for x in manifests),
        'extra-source-023-024-exact-declared-diff-and-modes': manifests[1]['exactChangesFromPrevious'] == sorted(parent.get('exactProductionChanges', [])) and manifests[1]['modesSameFromPrevious'] and manifests[1]['unchangedInputCount'] == parent.get('unchangedInputCount'),
        'extra-source-024-025-exact-declared-diff-and-modes': manifests[2]['exactChangesFromPrevious'] == sorted(bridge.get('exactProductionChanges', [])) and manifests[2]['modesSameFromPrevious'] and manifests[2]['unchangedInputCount'] == bridge.get('unchangedInputCount'),
        'extra-selected-production-spawn-Native-sources-actual-unchanged': bool(source_refs) and all(x['allSourceVersionsMatchRequiredSha256'] for x in source_refs),
        'extra-all-native-and-lifetime-sources-unchanged': manifests[1]['nativeAndSpawnClosureUnchanged'] and manifests[2]['nativeAndSpawnClosureUnchanged'],
        'extra-current-runtime-core-and-helper-actual-SHA-match-current-PIN': bool(native_inputs) and all(x['currentPinSha256'] == x['actualCurrentSha256'] for x in native_inputs),
        'extra-fixed-framework-helper-CLI-identity-cross-version-byte-identical': all(x['priorPinSha256'] == x['currentPinSha256'] for x in native_inputs if x['path'].startswith('Contents/Resources/native/') or x['path'].startswith('Contents/Resources/agent-browser/') or x['path'] == 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'),
    }
    return all(predicates.values()), predicates

def main():
    OUT.mkdir(mode=0o700, parents=True, exist_ok=True)
    monitored = ['coalition_judge.py', 'api_audit.py', 'coalition-proof-pin.json', 'source024-parent-bridge.json', 'source024-inheritance-bridge.json', 'coalition-result.json', 'cpu-analysis.json', 'raw.json', 'coalition-usage.jsonl', 'cpu-rusage.jsonl']
    original_hashes = {name: sha(CURRENT / name) for name in monitored}
    prior_pin, pin, raw = load(PRIOR/'coalition-proof-pin.json'), load(CURRENT/'coalition-proof-pin.json'), load(CURRENT/'raw.json')
    parent, bridge = load(CURRENT/'source024-parent-bridge.json'), load(CURRENT/'source024-inheritance-bridge.json')
    original_files = [{'path': f['path'], 'requiredSha256': f['sha256'], 'priorActualSha256': sha(PRIOR/f['path']), 'currentActualSha256': sha(CURRENT/f['path'])} for f in prior_pin['files']]
    folders = [Path('/private/tmp/willyou-m12-p078-source-023'), Path('/private/tmp/willyou-m12-p090-source-024'), Path('/private/tmp/willyou-m12-p101-source-025')]
    payloads = [load(p/'source-inputs.json') for p in folders]
    all_maps = [x['files'] for x in payloads]
    source_refs = []
    for ref in load(CURRENT/'coalition-evidence/selected-spawn-source-evidence.json')['references']:
        if not ref['label'].startswith('source023/'):
            continue
        rel = ref['label'][len('source023/'):]
        actual = [sha(p/'source'/rel) for p in folders]
        source_refs.append({'path': rel, 'requiredSha256': ref['sha256'], 'actual023024025': actual, 'allSourceVersionsMatchRequiredSha256': all(m.get(rel) == ref['sha256'] for m in all_maps) and all(h == ref['sha256'] for h in actual)})
    manifests = []
    for i, (folder, expected) in enumerate(zip(folders, [SHA023, SHA024, SHA025])):
        row = {'path': str(folder/'source-inputs.json'), 'requiredSha256': expected, 'actualSha256': sha(folder/'source-inputs.json'), 'fileCount': len(all_maps[i])}
        if i:
            a, z = all_maps[i-1], all_maps[i]
            changed = sorted(k for k in a.keys() | z.keys() if a.get(k) != z.get(k))
            # Changes are only the declared package-schema/listing implementation/tests,
            # not native inputs, process launchers or the selected spawn closure.
            allowed = {'src/main/core/applications/__tests__/tool-service.test.ts', 'src/main/core/applications/tool-service.ts'}
            if i == 2:
                allowed.add('src/main/core/applications/package-registry.ts')
            actual_changed = []
            for k in changed:
                actual_changed.append({'path': k, 'before': sha(folders[i-1]/'source'/k), 'after': sha(folder/'source'/k), 'matchesManifest': sha(folders[i-1]/'source'/k) == a[k] and sha(folder/'source'/k) == z[k]})
            row.update(exactChangesFromPrevious=changed, modesSameFromPrevious=payloads[i-1]['modes'] == payloads[i]['modes'], unchangedInputCount=sum(a.get(k) == v for k, v in z.items()), nativeAndSpawnClosureUnchanged=set(changed) <= allowed and all(x['matchesManifest'] for x in actual_changed) and all(x['allSourceVersionsMatchRequiredSha256'] for x in source_refs), changedFileActualSha256=actual_changed)
        manifests.append(row)
    p0, p1 = load(PRIOR/'prepared.json'), load(CURRENT/'prepared.json')
    a0 = {x['path']: x['sha256'] for x in p0['runtimeCoreFiles']}
    a1 = {x['path']: x['sha256'] for x in p1['runtimeCoreFiles']}
    current_package = p1['package']['app']
    native_inputs = [{'path': path, 'priorPinSha256': a0.get(path), 'currentPinSha256': value, 'actualCurrentSha256': sha(Path(current_package)/path)} for path, value in a1.items()]
    r0, r1 = load(PRIOR/'package-pin.json'), load(CURRENT/'package-pin.json')
    old_resources = {x['path']: x for x in r0['resourceFiles']}
    for f in r1['resourceFiles']:
        if f['path'].startswith(('native/', 'agent-browser/')):
            native_inputs.append({'path': 'Contents/Resources/'+f['path'], 'priorPinSha256': old_resources.get(f['path'],{}).get('sha256'), 'currentPinSha256': f['sha256'], 'actualCurrentSha256': sha(Path(current_package)/'Contents/Resources'/f['path'])})
    proof_ok, predicates = verify_proof(pin, prior_pin, raw, parent, bridge, manifests, original_files, source_refs, native_inputs)
    assert proof_ok, predicates
    # Reuse exact pure original adjudicator and API audit; never call its main(),
    # which would overwrite the original red coalition-result.json.
    assert sha(CURRENT/'coalition_judge.py') == sha(PRIOR/'coalition_judge.py')
    assert sha(CURRENT/'api_audit.py') == sha(PRIOR/'api_audit.py')
    sys.path.insert(0, str(CURRENT))
    spec = importlib.util.spec_from_file_location('original_p103_coalition_judge', CURRENT/'coalition_judge.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    events = [json.loads(line) for line in (CURRENT/'coalition-usage.jsonl').read_text().splitlines()]
    reference = [json.loads(line) for line in (CURRENT/'cpu-rusage.jsonl').read_text().splitlines()]
    original_native = [x for x in reference if x.get('coalition')]
    events += [x for x in reference if x.get('kind') == 'cpu-collector-error']
    raw_matches = original_native == [x for x in events if x.get('coalition')]
    api_result = module.audit(reference)
    analysis = load(CURRENT/'cpu-analysis.json')
    legacy_count = len(pin['files']) == 11 and len({x['path'] for x in pin['files']}) == 11
    old_result = module.adjudicate(events, raw, analysis, proof_ok and legacy_count, raw_matches, api_result['allCapturedApisValid'])
    old_result['originalAnalysisSha256'] = sha(CURRENT/'cpu-analysis.json')
    stored_red = load(CURRENT/'coalition-result.json')
    assert old_result == stored_red, 'Pure original result did not exactly reproduce its original red'
    fresh = module.adjudicate(events, raw, analysis, proof_ok, raw_matches, api_result['allCapturedApisValid'])
    fresh['originalAnalysisSha256'] = sha(CURRENT/'cpu-analysis.json')
    assert fresh['thresholdUnchanged'] == 5 and fresh['formalCaseCredit'] == 0
    assert all(x['passed'] for x in fresh['checks'])
    assert fresh['coalitionUpperExact'] == stored_red['coalitionUpperExact']
    assert fresh['coalitionUpperOneCorePercent'] < 5
    # Fail-closed controls recompute the complete proof gate, not a self-reported true.
    negative = []
    for name, field, mutate in [
        ('missing-required-original-file','pin',lambda x:x['files'].pop(0)),
        ('duplicate-original-file','pin',lambda x:x['files'].append(copy.deepcopy(x['files'][0]))),
        ('altered-required-original-file-hash','pin',lambda x:x['files'][0].update(sha256='0'*64)),
        ('altered-parent-file-pin','pin',lambda x:x['files'][-1].update(sha256='0'*64)),
        ('wrong-current-source','pin',lambda x:x.update(sourceManifestSha256='0'*64)),
        ('broken-current-parent-reference','bridge',lambda x:x['previousSourceBridge'].update(sha256='0'*64)),
        ('broken-parent-source-chain','parent',lambda x:x.update(currentSourceManifestSha256='0'*64)),
    ]:
        pp, pa, br = copy.deepcopy(pin), copy.deepcopy(parent), copy.deepcopy(bridge)
        target = {'pin':pp,'parent':pa,'bridge':br}[field];mutate(target)
        ok, details = verify_proof(pp, prior_pin, raw, pa, br, manifests, original_files, source_refs, native_inputs)
        assert not ok, name
        rejected = module.adjudicate(events, raw, analysis, ok, raw_matches, api_result['allCapturedApisValid'])
        assert not rejected['mandatoryChecksPassed'] and not rejected['scopeApproved']
        negative.append({'id': name, 'proofRejected': True, 'noScopeOrPass': True, 'falsePredicates': [k for k,v in details.items() if not v]})
    save('proof-review.json', {'computedProofOk': proof_ok, 'predicates': predicates, 'original11': original_files, 'sourceManifestsAndActualDiffs': manifests, 'selectedSpawnSourceReferences': source_refs, 'actualNativeInputs': native_inputs, 'actualRuntimeDifferencesNotOriginalProofPrerequisites': [x for x in native_inputs if x['priorPinSha256'] != x['currentPinSha256']], 'runtimeDifferenceBoundary': 'Three actual runtime byte differences: main executable and two node-pty modules. Each current actual file matches current App021 PIN. No signature-only cause or whole-runtime equivalence is asserted. Fixed Framework/Helper/CLI/identity remain byte-identical; current20role/UID/birth/path/CID/API evidence is rechecked by original adjudicator.', 'originalLegacyCountPredicate': legacy_count, 'legacyRedExactlyReproduced': old_result == stored_red, 'originalRedFailingChecks': [x['id'] for x in stored_red['checks'] if not x['passed']], 'negativeControls': negative})
    save('readjudication.json', fresh)
    assert {name: sha(CURRENT/name) for name in monitored} == original_hashes
    save('input-hashes.json', {'originalRoot': str(CURRENT), 'beforeAfterSame': True, 'files': [{'path': str(CURRENT/name), 'sha256': value} for name,value in original_hashes.items()], 'priorRoot': str(PRIOR), 'priorProofPinSha256': sha(PRIOR/'coalition-proof-pin.json'), 'pureAdjudicatorSha256': sha(CURRENT/'coalition_judge.py')})
    save('result.json', {'at': datetime.now(timezone.utc).isoformat(), 'status': 'independent-proof-chain-and-pure-readjudication-passed', 'originalRedPreserved': True, 'originalRedExactlyReproduced': True, 'proofGateComputedFromAllOriginalAndExtraConditions': proof_ok, 'originalRequiredFiles': 11, 'extraParentBridgeFiles': 1, 'proofPredicates': len(predicates), 'negativeControls': len(negative), 'readjudicationChecks': len(fresh['checks']), 'allReadjudicationChecksPassed': fresh['mandatoryChecksPassed'], 'decision': fresh['decision'], 'originalOwnOneCorePercent': fresh['originalOwnLowerPercent'], 'coalitionSupersetUpperOneCorePercent': fresh['coalitionUpperOneCorePercent'], 'originalIdleSeconds': fresh['originalIdleSeconds'], 'thresholdUnchanged': 5, 'formalCaseCredit': 0, 'NativeStarted': False, 'OSQueries': 0, 'AppStarted': False, 'models': 0, 'ports': 0, 'resourcesHeld': False, 'runtimeDifferenceCount': sum(x['priorPinSha256'] != x['currentPinSha256'] for x in native_inputs), 'runtimeDifferenceCauseProved': False, 'runtimeWholePackageByteEquivalenceClaimed': False, 'boundary': 'Pure original raw/proof review only; coalition is a superset including unrelated/busy/sampler CPU, not App-exclusive attribution. Original T111 formal credit remains coordinator review.'})
    print(json.dumps(load(OUT/'result.json')))

if __name__ == '__main__':
    main()
