"""Read-only published release provenance and small-asset audit; no installer download."""
import datetime, hashlib, json, os, re, subprocess, time, traceback
from pathlib import Path

P = Path(__file__).resolve().parent
ROOT = P.parent.parent
REPO = 'uprxiao/SmartDD'
RUN = 41399417380
HEAD = '44b46ca42cc8fff192c4fd8ae051431f369a2b8b'
TAG = 'v0.1.1'
TAG_OBJECT = '727e651fbcead7528b7ea86ddec95195e60471c1'
RELEASE_ID = 431168778
EXPECTED_LOG_SHA = '8c5fd33f9707956a89881b384a2b3ba24db14b919cecfdc1e685b7d6b6453860'
receipts, findings = [], []
started = time.monotonic()

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def sha(b):
    return hashlib.sha256(b).hexdigest()

def put(name, value):
    (P / name).write_text(json.dumps(value, ensure_ascii=True, indent=2) + '\n')

def need(condition, code, details=None):
    if not condition:
        item = {'code': code, 'details': details}
        findings.append(item)
        print(json.dumps({'finding': item}), flush=True)

def query(args, name, optional=False):
    argv = ['env', '-u', 'GH_TOKEN', '-u', 'GITHUB_TOKEN', 'gh', *args]
    t = time.monotonic()
    try:
        q = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=25)
        out, err, code = q.stdout, q.stderr, q.returncode
        timed_out = False
    except subprocess.TimeoutExpired as exc:
        out, err, code, timed_out = exc.stdout or b'', exc.stderr or b'', None, True
    (P / name).write_bytes(out)
    (P / (name + '.stderr.log')).write_bytes(err)
    row = {'argv': argv, 'path': name, 'exitCode': code, 'timedOut': timed_out,
           'elapsedSeconds': round(time.monotonic() - t, 3)}
    receipts.append(row)
    put('query-receipts.json', receipts)
    print(json.dumps({'phase': name, 'exitCode': code, 'elapsedSeconds': row['elapsedSeconds']}), flush=True)
    if code != 0:
        if optional:
            return None
        raise RuntimeError('Read-only query failed: ' + name)
    return json.loads(out) if name.endswith('.json') else out

put('execution.json', {'argv': ['python3', str(P / 'audit.py')], 'pid': os.getpid(),
    'pgid': os.getpgid(0), 'startedAt': now(), 'scope': 'read-only GitHub and five small release files'})
print(json.dumps({'started': True, 'pid': os.getpid(), 'pgid': os.getpgid(0), 'privateRoot': str(P)}), flush=True)

try:
    run = query(['api', f'repos/{REPO}/actions/runs/{RUN}'], 'actual-run.json')
    need(run.get('head_sha') == HEAD and run.get('run_attempt') == 2 and
         run.get('status') == 'completed' and run.get('conclusion') == 'success', 'FINAL_RUN_NOT_EXACT_SUCCESS')
    jobs1 = query(['api', f'repos/{REPO}/actions/runs/{RUN}/attempts/1/jobs?per_page=100'], 'attempt1-jobs.json')['jobs']
    jobs2 = query(['api', f'repos/{REPO}/actions/runs/{RUN}/attempts/2/jobs?per_page=100'], 'attempt2-jobs.json')['jobs']
    first = {x['name']: x for x in jobs1}
    second = {x['name']: x for x in jobs2}
    need(len(jobs1) == len(first) == len(jobs2) == len(second) == 9, 'JOB_SET_NOT_NINE_UNIQUE')
    need(sum(x['conclusion'] == 'success' for x in jobs1) == 7 and
         sum(x['conclusion'] == 'failure' for x in jobs1) == 1 and
         sum(x['conclusion'] == 'skipped' for x in jobs1) == 1, 'ORIGINAL_ATTEMPT_SHAPE_MISMATCH')
    logical = []
    for name, original in first.items():
        latest = second.get(name)
        reuse = original['conclusion'] == 'success'
        chosen = original if reuse else latest
        valid = bool(latest and chosen and chosen.get('head_sha') == HEAD and
                     chosen.get('status') == 'completed' and chosen.get('conclusion') == 'success' and
                     latest.get('conclusion') == 'success')
        same_execution = bool(latest and all(original.get(k) == latest.get(k)
                                  for k in ['started_at', 'completed_at', 'runner_id']))
        if reuse:
            valid = valid and same_execution
        else:
            expected_id = 125147363815 if name == 'publish' else 125142979265
            valid = bool(valid and latest['id'] == expected_id and latest['id'] != original['id']
                         and latest.get('run_attempt') == 2)
        need(valid, 'JOB_EXECUTION_OR_REUSE_NOT_VERIFIED', name)
        logical.append({'name': name, 'mode': 'reused-original-success' if reuse else 'new-attempt2-execution',
            'evidenceAttempt': 1 if reuse else 2, 'originalJobId': original['id'],
            'originalConclusion': original['conclusion'], 'providerAttempt2JobId': latest['id'] if latest else None,
            'originalExecution': {k: original.get(k) for k in ['started_at', 'completed_at', 'runner_id']},
            'providerAttempt2Execution': {k: latest.get(k) for k in ['started_at', 'completed_at', 'runner_id']} if latest else None,
            'inheritedExecutionMetadata': same_execution if reuse else False, 'verified': valid})
    need(sum(x['mode'] == 'reused-original-success' for x in logical) == 7 and
         sum(x['mode'] == 'new-attempt2-execution' for x in logical) == 2, 'RETRY_BOUNDARY_NOT_SEVEN_PLUS_TWO')
    first_sealed = ROOT / 'release-watch/attempt001/manifest.json'
    sealed_sha = sha(first_sealed.read_bytes())
    need(sealed_sha == '115aa24eacc03af04c6708d569599181012783ee9029612774542bada1d97a63', 'FIRST_ATTEMPT_MANIFEST_DRIFT')

    ref = query(['api', f'repos/{REPO}/git/ref/tags/{TAG}'], 'actual-tag-ref.json')
    obj = query(['api', f'repos/{REPO}/git/tags/{TAG_OBJECT}'], 'actual-annotated-tag.json')
    need(ref.get('object', {}).get('type') == 'tag' and ref.get('object', {}).get('sha') == TAG_OBJECT and
         obj.get('sha') == TAG_OBJECT and obj.get('tag') == TAG and
         obj.get('object', {}).get('type') == 'commit' and obj['object']['sha'] == HEAD, 'ANNOTATED_TAG_SOURCE_MISMATCH')
    release = query(['api', f'repos/{REPO}/releases/tags/{TAG}'], 'actual-release.json')
    latest = query(['api', f'repos/{REPO}/releases/latest'], 'latest-release.json', optional=True)
    latest404 = latest is None and 'HTTP 404' in (P / 'latest-release.json.stderr.log').read_text()
    nonlatest = bool((latest and latest.get('id') != RELEASE_ID) or latest404)
    need(release.get('id') == RELEASE_ID and release.get('tag_name') == TAG and
         release.get('draft') is False and release.get('prerelease') is True and nonlatest, 'RELEASE_PUBLIC_PREVIEW_NONLATEST_NOT_VERIFIED')

    assets = release.get('assets', [])
    installers = [x for x in assets if re.search(r'\.(dmg|exe|msi|AppImage|deb|rpm)$', x['name'], re.I)]
    expected = {'manifest-mac-arm64.json': ('mac', 'arm64', 1),
                'manifest-mac-x64.json': ('mac', 'x64', 1),
                'manifest-win-x64.json': ('win', 'x64', 2),
                'manifest-linux-x64.json': ('linux', 'x64', 3)}
    manifests = [x for x in assets if x['name'] in expected]
    sums = [x for x in assets if x['name'] == 'SHA256SUMS.txt']
    need(len(installers) == 7 and len(manifests) == 4 and len(sums) == 1 and len(assets) == 12, 'ASSET_SET_NOT_SEVEN_FOUR_ONE')
    need(len({x['name'] for x in assets}) == len(assets), 'ASSET_NAMES_NOT_UNIQUE')
    small_assets = manifests + sums
    if len(small_assets) != 5 or any(x['size'] > 2 * 1024 * 1024 for x in small_assets):
        raise RuntimeError('Five-small-assets size or identity guard failed')
    directory = P / 'small-assets'
    directory.mkdir(exist_ok=True)
    downloads = []
    for asset in small_assets:
        name = asset['name']
        query(['release', 'download', TAG, '--repo', REPO, '--dir', str(directory), '--pattern', name], 'download-' + name + '.log')
        data = (directory / name).read_bytes()
        valid = len(data) == asset['size'] and asset.get('digest') == 'sha256:' + sha(data)
        need(valid, 'SMALL_ASSET_SIZE_OR_DIGEST_MISMATCH', name)
        downloads.append({'name': name, 'bytes': len(data), 'sha256': sha(data), 'serverDigest': asset.get('digest'), 'verified': valid})
    checksums = {}
    for line in (directory / 'SHA256SUMS.txt').read_text().splitlines():
        match = re.fullmatch(r'([a-fA-F0-9]{64})\s+\*?(.+)', line)
        need(bool(match), 'SHA256SUMS_MALFORMED_LINE')
        if match:
            need(match[2] not in checksums, 'SHA256SUMS_DUPLICATE_NAME', match[2])
            checksums[match[2]] = match[1].lower()
    need(len(checksums) == 7 and set(checksums) == {x['name'] for x in installers}, 'SHA256SUMS_SET_MISMATCH')
    producers, installer_checks = [], []
    by_name = {x['name']: x for x in installers}
    for asset in manifests:
        m = json.loads((directory / asset['name']).read_text())
        platform, arch, count = expected[asset['name']]
        valid = (m.get('schemaVersion') == 2 and m.get('version') == '0.1.1' and m.get('commit') == HEAD
                 and m.get('dirty') is False and m.get('platform') == platform and m.get('arch') == arch
                 and len(m.get('files', [])) == count and m.get('verification') == 'packaged-electron-sqlite-pty')
        need(valid, 'PRODUCER_PROVENANCE_MISMATCH', asset['name'])
        producers.append({'name': asset['name'], 'manifest': m, 'verified': valid})
        for f in m.get('files', []):
            a = by_name.get(f.get('file'))
            valid = bool(a and a['state'] == 'uploaded' and a['size'] == f.get('size')
                         and f.get('sha256') == checksums.get(f.get('file'))
                         and a.get('digest') == 'sha256:' + f.get('sha256', '')
                         and a['name'].startswith('WillYou-0.1.1-'))
            need(valid, 'INSTALLER_MANIFEST_SUM_SERVER_MISMATCH', f.get('file'))
            installer_checks.append({'name': f.get('file'), 'size': f.get('size'), 'sha256': f.get('sha256'),
                'sumSha256': checksums.get(f.get('file')), 'serverDigest': a.get('digest') if a else None,
                'serverSize': a.get('size') if a else None, 'verifiedMetadata': valid, 'installerDownloaded': False})
    need(len(installer_checks) == 7 and len({x['name'] for x in installer_checks}) == 7, 'PRODUCER_INSTALLER_UNION_MISMATCH')

    logpath = ROOT / 'release-watch/attempt001/checks-job-full.log'
    raw = logpath.read_bytes()
    need(sha(raw) == EXPECTED_LOG_SHA, 'ORIGINAL_CHECKS_LOG_HASH_MISMATCH')
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', raw.decode(errors='replace'))
    check_job = next(x for x in jobs1 if x['name'] == 'build / checks / checks')
    step = next(x for x in check_job['steps'] if x['name'] == 'Run pnpm test:release')
    counts, count_lines, vitest_lines = {}, [], []
    for line in text.splitlines():
        stamp = re.search(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z', line)
        match = re.search(r'(?:#|ℹ)\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)', line)
        if match and stamp and step['started_at'][:19] <= stamp[0][:19] <= step['completed_at'][:19]:
            counts[match[1]] = int(match[2]); count_lines.append(line)
        if re.search(r'\b(?:Test Files|Tests)\s+\d+', line):
            vitest_lines.append(line)
    need(counts.get('tests') == 24 and counts.get('pass') == 24 and counts.get('fail') == 0 and counts.get('skipped') == 0,
         'ORIGINAL_RELEASE_RULE_COUNTS_NOT_24', counts)
    need(any(re.search(r'\bTests\s+5866\s+passed\s*\|\s*1000\s+skipped\s*\(6866\)', x) for x in vitest_lines),
         'ORIGINAL_FULL_TEST_COUNTS_UNVERIFIED', vitest_lines)
    (P / 'reused-checks-summary.log').write_text('\n'.join(count_lines + vitest_lines) + '\n')
    put('reused-checks-provenance.json', {'jobId': check_job['id'], 'evidenceAttempt': 1,
        'rawPath': str(logpath), 'rawSha256': sha(raw), 'releaseStep': step, 'releaseRules': counts,
        'vitestSummary': vitest_lines, 'rerunInAttempt2': False})

    result = {'schema': 'willyou-final-v011-readonly-release-audit-v1',
        'status': 'passed-readonly-release-audit' if not findings else 'findings', 'runId': RUN,
        'candidate': HEAD, 'runAttempt': run.get('run_attempt'), 'runConclusion': run.get('conclusion'),
        'tag': TAG, 'annotatedTagObject': TAG_OBJECT, 'peeledTagCommit': obj.get('object', {}).get('sha'),
        'release': {k: release.get(k) for k in ['id', 'html_url', 'tag_name', 'draft', 'prerelease', 'published_at']},
        'nonlatestVerified': nonlatest, 'latestEndpoint404': latest404,
        'assetCounts': {'installers': len(installers), 'producerManifests': len(manifests), 'sums': len(sums)},
        'logicalJobs': logical, 'logicalJobCounts': {'reusedOriginalSuccess': 7, 'newAttempt2Executions': 2},
        'originalAttemptManifestSha256': sealed_sha, 'originalFailurePreserved': True,
        'downloadedSmallAssets': downloads, 'producerManifests': producers,
        'installerMetadataCrossChecks': installer_checks, 'checks': {'originalLogSha256': sha(raw),
        'releaseRules': counts, 'vitestSummary': vitest_lines, 'rerunInAttempt2': False},
        'findings': findings, 'formalCasePassesAdded': 0,
        'boundaries': ['Only four producer JSON and SHA256SUMS downloaded; no installer bytes downloaded.',
            'Seven installer checks cover producer SHA/size + SHA256SUMS + server digest/size, not local installation.',
            'Attempt2 reuses seven original successes; only Mac x64 and publish are fresh execution.',
            'Original attempt1 timeout preserved; a successful retry does not prove its root cause.',
            'No tests/build/native/UI/Agent, workflow changes, retries, dispatches, tag edits or release edits.'],
        'finishedAt': now()}
    put('result.json', result)
    print(json.dumps({'status': result['status'], 'findings': findings, 'assetCounts': result['assetCounts'],
                      'checks': counts, 'elapsedSeconds': round(time.monotonic() - started, 3)}), flush=True)
except Exception as exc:
    put('audit-error.json', {'errorClass': type(exc).__name__, 'error': str(exc), 'traceback': traceback.format_exc(), 'at': now()})
    print(json.dumps({'status': 'audit-error', 'error': str(exc)}), flush=True)
    raise
finally:
    d = json.loads((P / 'execution.json').read_text())
    d.update(finishedAt=now(), elapsedSeconds=round(time.monotonic() - started, 3),
             scriptCompleted=True, queryProcessesJoined=True)
    put('execution.json', d)
