from pathlib import Path
import datetime
import hashlib
import json
import os

sequence = Path('/private/tmp/willyou-m11-s1a/evidence/composition-remainders/sequence-R01-R07-attempt-001')
baseline = json.loads((sequence / 'inputs-before.json').read_text())
plan = json.loads((sequence / 'plan-selected.json').read_text())
source = Path(baseline['sourceRoot'])

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(name, value):
    (sequence / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

assert not (sequence / 'manifest.json').exists(), 'Do not overwrite a sealed sequence'
manifest_path = Path(baseline['sourceManifest'])
manifest_hash = digest(manifest_path)
source_manifest = json.loads(manifest_path.read_text())
source_changes = []
for item in source_manifest['files']:
    path = source / item['path']
    if not path.is_file() or path.stat().st_size != item['bytes'] or digest(path) != item['sha256']:
        source_changes.append(item['path'])

dependency_hashes = {}
dependency_changes = []
for name, expected_hash in baseline['dependencyAndOutputHashes'].items():
    path = source / name
    actual_hash = digest(path) if path.is_file() else None
    dependency_hashes[name] = actual_hash
    if actual_hash != expected_hash:
        dependency_changes.append(name)
cache = source / 'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json'
cache_hash = digest(cache) if cache.is_file() else None

original_plan = Path('/private/tmp/willyou-m11-s1a/evidence/composition-remainder-preparation/attempt-001/task-test-partitions.json')
preparation_manifest = original_plan.parent / 'manifest.json'
group_receipts = []
own_processes = []
all_selected = []
evidence_errors = []
failures = []
totals = {'expected': 0, 'selectedReported': 0, 'passed': 0, 'failed': 0, 'selectedNotExecuted': 0, 'outsideExecuted': 0}
elapsed = 0.0
for group in plan['groups']:
    directory = Path(group['evidenceDirectory'])
    evidence_manifest_path = directory / 'manifest.json'
    evidence_manifest = json.loads(evidence_manifest_path.read_text())
    for entry in evidence_manifest['files']:
        path = directory / entry['path']
        if not path.is_file() or path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            evidence_errors.append(str(path))
    result = json.loads((directory / 'result.json').read_text())
    tests = json.loads((directory / 'per-test-results.json').read_text())
    cleanup = json.loads((directory / 'cleanup.json').read_text())
    start = json.loads((directory / 'execution-start.json').read_text())
    expected = set(group['expectedNames'])
    actual = [item for item in tests['tests'] if item['selected']]
    exact = (len(actual) == group['count'] == len(expected)
             and set(item['fullName'] for item in actual) == expected
             and all(item['status'] not in ('passed', 'failed') for item in tests['tests'] if not item['selected']))
    if not exact or not result['selectionVerified']:
        evidence_errors.append(group['id'] + ':selection')
    for item in actual:
        all_selected.append((group['file'], item['fullName']))
    for item in result['failures']:
        failures.append({'groupId': group['id'], 'file': group['file'], **item})
    for key in totals:
        totals[key] += result['counts'][key]
    elapsed += result['elapsedSeconds']
    pgid = start['processGroup']
    try:
        os.killpg(pgid, 0)
        alive = True
    except ProcessLookupError:
        alive = False
    except PermissionError:
        alive = 'unknown-permission'
    own_processes.append({'groupId': group['id'], 'processGroup': pgid, 'stillExists': alive})
    group_receipts.append({'groupId': group['id'], 'directory': str(directory), 'manifestSha256': digest(evidence_manifest_path),
                           'status': result['status'], 'counts': result['counts'], 'elapsedSeconds': result['elapsedSeconds'],
                           'selectionVerified': exact, 'criticalChanges': result['criticalChanges'],
                           'sharedCacheUnchangedDuringGroup': result['sharedCacheUnchangedDuringGroup'],
                           'cleanupAlreadyConfirmedStopped': cleanup['localGroupProcessesStopped']})

at = datetime.datetime.now(datetime.timezone.utc).isoformat()
integrity_ok = (manifest_hash == baseline['sourceManifestSha256'] and not source_changes and not dependency_changes
                and cache_hash == baseline['sharedCacheHash']
                and digest(original_plan) == baseline['planSha256']
                and digest(preparation_manifest) == baseline['preparationManifestSha256']
                and not evidence_errors
                and all(not group['criticalChanges'] and group['sharedCacheUnchangedDuringGroup'] for group in group_receipts))
selection_ok = len(all_selected) == len(set(all_selected)) == plan['expectedUniqueTests'] == totals['expected'] == 125
stopped = all(row['stillExists'] is False for row in own_processes)
write('inputs-after.json', {
    'at': at, 'sourceRoot': str(source), 'sourceManifest': str(manifest_path), 'sourceManifestSha256': manifest_hash,
    'sourceManifestHashUnchanged': manifest_hash == baseline['sourceManifestSha256'], 'sourceFileCount': len(source_manifest['files']),
    'sourceChanges': source_changes, 'fullSourceValidationPassed': not source_changes,
    'dependencyAndOutputHashes': dependency_hashes, 'dependencyAndOutputChanges': dependency_changes,
    'sharedCacheHash': cache_hash, 'sharedCacheUnchanged': cache_hash == baseline['sharedCacheHash'],
    'preparationManifestSha256': digest(preparation_manifest), 'planSha256': digest(original_plan),
    'evidenceErrors': evidence_errors, 'integrityPassed': integrity_ok,
})
write('cleanup.json', {
    'at': at, 'ownProcessGroups': own_processes, 'allOwnTestProcessGroupsStopped': stopped,
    'sequenceDependencyLease': 'released' if stopped else 'not-released-needs-process-review',
    'uiOrRealAgentStarted': False, 'externalHooksOrListenersAddedByExecutor': False,
    'sharedOutOrDependencyBuildPerformed': False, 'sourceAndDependencyIntegrityPassed': integrity_ok,
})
write('result.json', {
    'schema': 'willyou-test-sequence-result-v1', 'sequence': 'M11-S1A-R01-R07', 'attempt': 1,
    'status': ('passed' if totals['failed'] == 0 else 'completed-with-preserved-test-failures') if integrity_ok and stopped and selection_ok else 'needs-integrity-or-cleanup-review',
    'scope': '125 exact remaining software tests on frozen source003; no formal M11 case closed',
    'sourceManifestSha256': manifest_hash, 'startedAt': baseline['at'], 'finishedAt': at,
    'summedTestCommandElapsedSeconds': round(elapsed, 3), 'counts': totals,
    'uniqueSelectedTests': len(set(all_selected)), 'exact125UniqueSelectionVerified': selection_ok,
    'groups': group_receipts, 'failures': failures,
    'failureClassification': 'R03 six failures have the same old stop spy argument expectation: expected [p1], received [p1, zentao]. Pending coordinator review of compatibility versus updated contract; source and expectations were not altered.',
    'originalFailuresPreserved': True, 'formalM11CasePassesAdded': 0,
    'sourceAndDependencyIntegrityPassed': integrity_ok, 'allOwnTestProcessGroupsStopped': stopped,
    'dependencyLeaseReleased': stopped, 'inputReceipt': 'inputs-after.json', 'cleanup': 'cleanup.json',
})
files = []
for path in sorted(sequence.iterdir()):
    if path.is_file() and path.name != 'manifest.json':
        files.append({'path': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path)})
write('manifest.json', {'schema': 'willyou-evidence-manifest-v1', 'sequence': 'M11-S1A-R01-R07', 'attempt': 1, 'files': files})
print(json.dumps({'status': json.loads((sequence / 'result.json').read_text())['status'], 'counts': totals,
                  'uniqueSelectedTests': len(set(all_selected)), 'integrityPassed': integrity_ok,
                  'allOwnProcessGroupsStopped': stopped, 'summedTestCommandElapsedSeconds': round(elapsed, 3),
                  'manifestSha256': digest(sequence / 'manifest.json')}, ensure_ascii=False))
