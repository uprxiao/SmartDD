from pathlib import Path
import json, hashlib, datetime, subprocess, time, os, re

root = Path('/private/tmp/willyou-m11-s1a')
source = root / 'source-attempt-005'
out = root / 'evidence/diagnostic-registry-fix/attempt-001'
manifest_path = root / 'source-manifest-attempt-005.json'
expected_manifest = '56d94e2251bf7970467049d97ca850754a2954106bdd103bb88b85261c225527'
prior = root / 'evidence/composition-remainders/sequence-R01-R07-attempt-001/inputs-before.json'
test_file = 'src/main/core/applications/__tests__/session-diagnostics.test.ts'

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(name, value):
    (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def source_check(rows):
    changes = []
    for item in rows:
        path = source / item['path']
        if not path.is_file() or path.stat().st_size != item['bytes'] or digest(path) != item['sha256']:
            changes.append(item['path'])
    return changes

assert not (out / 'inputs-before.json').exists(), 'Do not overwrite an executed attempt'
assert digest(manifest_path) == expected_manifest
manifest = json.loads(manifest_path.read_text())
assert len(manifest['files']) == 5017
changes = source_check(manifest['files'])
assert not changes, changes
prior_baseline = json.loads(prior.read_text())
dependency_hashes = {name: digest(source / name) for name in prior_baseline['dependencyAndOutputHashes']}
cache = source / 'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json'
cache_before = digest(cache) if cache.is_file() else None
write('inputs-before.json', {
    'at': now(), 'source': str(source), 'manifest': str(manifest_path), 'manifestSha256': expected_manifest,
    'sourceFileCount': len(manifest['files']), 'sourceChanges': changes, 'fullSourceValidationPassed': True,
    'dependencyAndOutputHashes': dependency_hashes, 'dependencyFingerprintScope': '100 native/shared dependency/runtime/output paths inherited as a path list; all hashes freshly read before this batch',
    'sharedCacheHash': cache_before, 'testFile': test_file, 'testFileSha256': digest(source / test_file),
    'resourceLease': 'independent lightweight checks; shared dependencies read-only; no GUI or build',
})
commands = [
    ('metadata', ['node', 'scripts/applications/generate-module-metadata.mjs']),
    ('typecheck', ['pnpm', 'typecheck']),
    ('diagnostics', ['pnpm', 'test', test_file, '--maxWorkers=1', '--no-file-parallelism', '--no-cache', '--reporter=verbose', '--reporter=json', '--outputFile.json=' + str(out / 'vitest.json')]),
]
executions = []
for name, argv in commands:
    started = now()
    start = time.monotonic()
    timeout = False
    seen = set()
    stdout_path = out / (name + '.stdout.log')
    with stdout_path.open('wb') as stdout, (out / (name + '.stderr.log')).open('wb') as stderr:
        process = subprocess.Popen(argv, cwd=source, stdout=stdout, stderr=stderr, start_new_session=True)
        initial = {'name': name, 'argv': argv, 'cwd': str(source), 'pid': process.pid, 'processGroup': process.pid,
                   'supervisorPid': os.getpid(), 'startedAt': started, 'outerBudgetSeconds': 180, 'individualTestTimeout': 'Unmodified'}
        write(name + '.start.json', initial)
        print(json.dumps({'event': 'command-start', 'name': name, 'pid': process.pid}), flush=True)
        while process.poll() is None:
            for line in stdout_path.read_text(errors='replace').splitlines():
                if re.match(r'^\s*[×✗]', line) and line not in seen:
                    seen.add(line)
                    print(json.dumps({'event': 'failed-test', 'name': name, 'message': line.strip()}, ensure_ascii=False), flush=True)
            if time.monotonic() - start >= 180:
                timeout = True
                os.killpg(process.pid, 15)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, 9)
                    process.wait()
                break
            time.sleep(.25)
        code = process.wait()
    execution = {**initial, 'exitCode': code, 'timedOut': timeout, 'finishedAt': now(), 'elapsedSeconds': round(time.monotonic() - start, 3)}
    write(name + '.exit.json', execution)
    executions.append(execution)
    print(json.dumps({'event': 'command-exit', 'name': name, 'exitCode': code, 'timedOut': timeout, 'elapsedSeconds': execution['elapsedSeconds']}), flush=True)

report = json.loads((out / 'vitest.json').read_text()) if (out / 'vitest.json').is_file() else {}
items = []
for suite in report.get('testResults', []):
    for case in suite.get('assertionResults', []):
        items.append({'file': suite['name'], 'name': ' > '.join(case.get('ancestorTitles', []) + [case['title']]),
                      'status': case['status'], 'durationMs': case.get('duration'), 'failureMessages': case.get('failureMessages', [])})
counts = {'files': len(report.get('testResults', [])), 'reportedTotal': report.get('numTotalTests'), 'observedTests': len(items),
          'passed': sum(item['status'] == 'passed' for item in items), 'failed': sum(item['status'] == 'failed' for item in items),
          'notExecuted': sum(item['status'] not in ('passed', 'failed') for item in items)}
selection_ok = (bool(items) and counts['files'] == 1 and counts['reportedTotal'] == len(items)
                and len(set(item['name'] for item in items)) == len(items)
                and all(Path(item['file']).resolve() == (source / test_file).resolve() for item in items)
                and counts['notExecuted'] == 0)
write('per-test-results.json', {'counts': counts, 'fullAssignedFileVerified': selection_ok, 'tests': items})
after_changes = source_check(manifest['files'])
dep_after = {name: digest(source / name) if (source / name).is_file() else None for name in dependency_hashes}
dep_changes = [name for name, value in dependency_hashes.items() if dep_after[name] != value]
cache_after = digest(cache) if cache.is_file() else None
integrity_ok = not after_changes and not dep_changes and cache_before == cache_after and digest(manifest_path) == expected_manifest
write('inputs-after.json', {'at': now(), 'manifestSha256': digest(manifest_path), 'sourceFileCount': len(manifest['files']),
                          'sourceChanges': after_changes, 'dependencyAndOutputHashes': dep_after, 'dependencyAndOutputChanges': dep_changes,
                          'sharedCacheHash': cache_after, 'sharedCacheUnchanged': cache_before == cache_after, 'integrityPassed': integrity_ok})
processes = []
for item in executions:
    try:
        os.killpg(item['processGroup'], 0)
        alive = True
    except ProcessLookupError:
        alive = False
    except PermissionError:
        alive = 'unknown-permission'
    processes.append({'name': item['name'], 'processGroup': item['processGroup'], 'stillExists': alive})
stopped = all(item['stillExists'] is False for item in processes)
write('cleanup.json', {'at': now(), 'ownProcessGroups': processes, 'allOwnProcessesStopped': stopped,
                       'resourceLease': 'released' if stopped else 'not-released-needs-review', 'uiOrRealAgentStarted': False,
                       'sourceOrPublicLedgerChanged': False, 'dependencyOrSharedOutputBuildPerformed': False,
                       'externalHooksAddedByExecutor': False, 'integrityPassed': integrity_ok})
passed = all(item['exitCode'] == 0 and not item['timedOut'] for item in executions) and selection_ok and counts['failed'] == 0 and integrity_ok and stopped
result = {'schema': 'willyou-test-batch-result-v1', 'batch': 'M11-S1A-diagnostic-registry-fix', 'attempt': 1,
          'status': 'passed' if passed else 'failed-needs-classification', 'source': str(source), 'sourceManifestSha256': expected_manifest,
          'scope': 'Metadata check-only, typecheck, unchanged complete session-diagnostics test file; software evidence only',
          'commands': executions, 'counts': counts, 'fullAssignedFileVerified': selection_ok, 'perTestResults': 'per-test-results.json',
          'failures': [item for item in items if item['status'] == 'failed'], 'integrityPassed': integrity_ok,
          'allOwnProcessesStopped': stopped, 'resourceLeaseReleased': stopped, 'formalM11CasePassesAdded': 0,
          'failureClassification': 'No failures observed' if passed else 'Preserved original failures; coordinator review required',
          'finishedAt': now(), 'cleanup': 'cleanup.json'}
write('result.json', result)
files = [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path)} for path in sorted(out.iterdir()) if path.is_file() and path.name != 'manifest.json']
write('manifest.json', {'schema': 'willyou-evidence-manifest-v1', 'batch': result['batch'], 'attempt': 1, 'files': files})
print(json.dumps({'event': 'batch-sealed', 'status': result['status'], 'counts': counts, 'integrityPassed': integrity_ok,
                  'allOwnProcessesStopped': stopped, 'manifestSha256': digest(out / 'manifest.json')}, ensure_ascii=False), flush=True)
