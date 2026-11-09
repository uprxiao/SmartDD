"""External CM003 power lifecycle only. --check is file-only; other modes require lease."""
from pathlib import Path
import argparse, datetime, hashlib, json, os, re, shlex, signal, stat, subprocess, sys, time, threading

ROOT = Path('/private/tmp/willyou-m12-t09-cm-power-wrapper-001')
TARGET = Path('/private/tmp/willyou-m12-t131-t09-lifecycle-ar-003')
NODE = '/Users/liubu/.hermes/node/bin/node'

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b): return hashlib.sha256(b).hexdigest()
def read_json(p): return json.loads(Path(p).read_text())
def save(name, value):
    p = ROOT / name
    tmp = p.with_name(p.name + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        os.chmod(tmp, 0o600); json.dump(value, f, ensure_ascii=False, indent=2); f.write('\n')
    os.replace(tmp, p)

def check_inputs():
    assert Path(__file__).resolve() == ROOT / 'run.py'
    binding = read_json(ROOT / 'binding.json')
    assert binding['targetRoot'] == str(TARGET)
    for name, key in [('READY.json', 'targetReadySHA'), ('execution-ready.json', 'targetExecutionReadySHA'), ('manifest.json', 'targetManifestSHA')]:
        assert sha((TARGET / name).read_bytes()) == binding[key], name
    ready = read_json(TARGET / 'READY.json'); er = read_json(TARGET / 'execution-ready.json')
    assert ready['root'] == er['root'] == str(TARGET)
    assert len(er['inputs']) == ready['inputCount'] == 256
    for f in er['inputs']:
        p = TARGET / f['path']; assert not p.is_symlink()
        b = p.read_bytes()
        assert sha(b) == f['sha256'] and len(b) == f['bytes'] and stat.S_IMODE(p.stat().st_mode) == f['mode'], f['path']
    env_prefix = 'WILLYOU_TEST_CACHE_DIR=' + str(TARGET) + '/cache NODE_COMPILE_CACHE=' + str(TARGET) + '/cache/node '
    commands = {'driver': [NODE, str(TARGET / 'run.mjs'), '--execute', '--t09-cm'],
                'cleanup': [NODE, str(TARGET / 'verify-cleanup.mjs'), '--verify'],
                'judge': [NODE, str(TARGET / 'judge.mjs'), '--judge']}
    assert ready['execute'] == env_prefix + ' '.join(commands['driver'])
    assert ready['afterActualExit'] == [env_prefix + ' '.join(commands['cleanup']), env_prefix + ' '.join(commands['judge'])]
    assert binding['driverBudgetSeconds'] == ready['maximumBudgetSeconds'] == 285
    for name, expected in binding['wrapperInputs'].items():
        assert sha((ROOT / name).read_bytes()) == expected
    return binding, commands

def ps_parse(line):
    m = re.match(r'^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(\S+)\s+(.+)$', line)
    if not m: return None
    return {'pid': int(m[1]), 'ppid': int(m[2]), 'uid': int(m[3]), 'birth': m[4], 'comm': m[5], 'argv': shlex.split(m[6])}

def ps_one(pid):
    p = subprocess.run(['/bin/ps', '-ww', '-p', str(pid), '-o', 'pid=,ppid=,uid=,lstart=,comm=,command='], capture_output=True, text=True, timeout=5)
    assert p.returncode in (0, 1)
    rows = [ps_parse(s) for s in p.stdout.splitlines() if s.strip()]
    rows = [r for r in rows if r]
    if not rows: return None
    assert len(rows) == 1 and rows[0]['pid'] == pid
    return rows[0]

def same_identity(a, b):
    return b is not None and all(a[k] == b[k] for k in ['pid', 'uid', 'birth', 'comm', 'argv'])

def child_candidates(pid):
    p = subprocess.run(['/usr/bin/pgrep', '-P', str(pid)], capture_output=True, text=True, timeout=5)
    assert p.returncode in (0, 1)
    return [int(s) for s in p.stdout.split() if s.isdigit()]

def find_guard(driver, utility):
    expected = [['/usr/bin/caffeinate', '-i', '-s'] + utility, ['caffeinate', '-i', '-s'] + utility]
    guards = []
    for pid in child_candidates(driver['pid']):
        row = ps_one(pid)
        if row and row['ppid'] == driver['pid'] and row['uid'] == os.getuid() and Path(row['comm']).name == 'caffeinate' and row['argv'] in expected:
            guards.append(row)
    assert len(guards) <= 1, 'Ambiguous exact guard, no unknown signal allowed'
    return guards[0] if guards else None

def current_ac_power():
    p = subprocess.run(['/usr/bin/pmset', '-g', 'batt'], capture_output=True, text=True, timeout=5)
    assert p.returncode == 0
    return {'at': utc(), 'ACPower': bool(re.search(r'Now drawing from [\"\']AC Power[\"\']', p.stdout)), 'rawPowerOutputSaved': False}

def own_assertions(guard_pids):
    p = subprocess.run(['/usr/bin/pmset', '-g', 'assertions'], capture_output=True, text=True, timeout=5)
    assert p.returncode == 0
    facts = []
    for pid in guard_pids:
        lines = [s for s in p.stdout.splitlines() if re.search(r'\bpid\s+' + str(pid) + r'\(caffeinate\)', s)]
        facts.append({'pid': pid, 'ownLines': len(lines), 'idleSystem': any('PreventUserIdleSystemSleep' in s for s in lines),
                      'system': any(re.search(r'\bPreventSystemSleep\b', s) for s in lines),
                      'displayOrUserActive': any('PreventUserIdleDisplaySleep' in s or 'UserIsActive' in s for s in lines)})
    return {'at': utc(), 'facts': facts, 'allRequestedOwnAssertionsObserved': bool(facts) and all(f['idleSystem'] and f['system'] and not f['displayOrUserActive'] for f in facts),
            'allOwnAssertionsAbsent': all(f['ownLines'] == 0 for f in facts), 'otherProcessesOrRawPmsetSaved': False}

def signal_exact(identity, sig, record, reason):
    current = ps_one(identity['pid'])
    if not same_identity(identity, current):
        record.append({'at': utc(), 'pid': identity['pid'], 'signal': sig.name, 'sent': False, 'reason': 'recorded-birth-exe-argv-absent-or-changed'})
        return
    os.kill(identity['pid'], sig)
    record.append({'at': utc(), 'pid': identity['pid'], 'signal': sig.name, 'sent': True, 'reason': reason, 'normalExitClaimed': False})

def execute():
    assert os.environ.get('WILLYOU_M12_NATIVE_LEASE_CONFIRMED') == '1'
    binding, commands = check_inputs()
    runtime = ROOT / 'runtime-001'; runtime.mkdir(mode=0o700)
    start = utc(); first_wall = time.time_ns(); first_mono = time.monotonic_ns()
    r = {'startedAt': start, 'wrapperPid': os.getpid(), 'targetRoot': str(TARGET), 'scope': 'external power lifecycle, original CM input and commands unchanged',
         'phases': [], 'errors': [], 'knownIdentities': [], 'permanentSettingsChanged': False, 'displayOrUserActiveFlagsRequested': False,
         'heartbeatLayer': 'Python wrapper, not Node event loop or proof against all clamshell sleep', 'formalCaseIncrement': 0,
         'resourcesHeld': True, 'postTerminalVerificationRequired': True}
    wrapper = ps_one(os.getpid()); assert wrapper and wrapper['uid'] == os.getuid() and str(ROOT / 'run.py') in wrapper['argv'] and '--execute' in wrapper['argv']
    r['wrapperIdentity'] = wrapper; r['knownIdentities'].append(wrapper); save('power-lifecycle.private.json', r)
    heartbeat = open(runtime / 'wrapper-heartbeat.private.jsonl', 'x', encoding='utf-8'); os.chmod(runtime / 'wrapper-heartbeat.private.jsonl', 0o600)
    heartbeat_count = 0; max_wall_gap = 0.; max_mono_gap = 0.; previous_wall = first_wall; previous_mono = first_mono
    def tick(stage):
        nonlocal heartbeat_count, max_wall_gap, max_mono_gap, previous_wall, previous_mono
        wall = time.time_ns(); mono = time.monotonic_ns()
        wg = (wall - previous_wall) / 1e6; mg = (mono - previous_mono) / 1e6
        max_wall_gap = max(max_wall_gap, wg); max_mono_gap = max(max_mono_gap, mg)
        heartbeat.write(json.dumps({'seq': heartbeat_count, 'stage': stage, 'wrapperPid': os.getpid(), 'wallUtc': utc(), 'wallElapsedMs': (wall-first_wall)/1e6, 'monoElapsedMs': (mono-first_mono)/1e6, 'wallGapMs': wg, 'monoGapMs': mg}) + '\n'); heartbeat.flush()
        heartbeat_count += 1; previous_wall = wall; previous_mono = mono
    heartbeat_stage = ['initializing']; heartbeat_stop = threading.Event(); heartbeat_errors = []
    def heartbeat_loop():
        while not heartbeat_stop.wait(.25):
            try: tick(heartbeat_stage[0])
            except Exception as e:
                heartbeat_errors.append({'type': type(e).__name__, 'message': str(e)}); return
    def wait_tick(seconds, stage):
        heartbeat_stage[0] = stage
        time.sleep(seconds)
    def guarded(label, utility, budget):
        p = {'label': label, 'startedAt': utc(), 'command': ['/usr/bin/caffeinate', '-i', '-s'] + utility, 'signals': [], 'driverExit': None,
             'pidLayout': 'Observed utility retains Popen launcherPID; caffeinate direct-child guard must be verified, never assumed'}
        r['phases'].append(p); save('power-lifecycle.private.json', r)
        stdout = open(runtime / (label + '.stdout.private.log'), 'xb'); stderr = open(runtime / (label + '.stderr.private.log'), 'xb')
        os.chmod(stdout.name, 0o600); os.chmod(stderr.name, 0o600)
        env = dict(os.environ, WILLYOU_TEST_CACHE_DIR=str(TARGET / 'cache'), NODE_COMPILE_CACHE=str(TARGET / 'cache/node'))
        child = None; guard = None; driver = None
        try:
            child = subprocess.Popen(p['command'], cwd=TARGET, env=env, stdout=stdout, stderr=stderr)
            p['launcherPid'] = child.pid; save('power-lifecycle.private.json', r)
            until = time.monotonic() + 5
            while time.monotonic() < until and child.poll() is None:
                candidate = ps_one(child.pid)
                if candidate and candidate['ppid'] == os.getpid() and candidate['uid'] == os.getuid() and candidate['argv'] == utility and Path(candidate['comm']).resolve() == Path(NODE).resolve():
                    driver = candidate; p['utilityIdentity'] = driver; r['knownIdentities'].append(driver); break
                wait_tick(.1, label + ':bind-utility')
            assert driver, 'Exact Node utility PID/PPID/exe/argv not observed'
            until = time.monotonic() + 5
            while time.monotonic() < until and child.poll() is None:
                guard = find_guard(driver, utility)
                if guard: break
                wait_tick(.1, label + ':bind-guard')
            assert guard, 'Exact direct-child caffeinate guard not observed'
            p['guardIdentity'] = guard; r['knownIdentities'].append(guard); p['startOwnAssertions'] = own_assertions([guard['pid']])
            assert p['startOwnAssertions']['allRequestedOwnAssertionsObserved'], 'Own -i/-s assertions not both observed'
            save('power-lifecycle.private.json', r)
            deadline = time.monotonic() + budget
            while child.poll() is None and time.monotonic() < deadline:
                wait_tick(.25, label + ':running')
            if child.poll() is None:
                p['timedOut'] = True; signal_exact(driver, signal.SIGTERM, p['signals'], 'phase-budget-exceeded')
                until = time.monotonic() + 60
                while child.poll() is None and time.monotonic() < until: wait_tick(.25, label + ':term-grace')
                if child.poll() is None: signal_exact(driver, signal.SIGKILL, p['signals'], 'exact-own-driver-still-running-after-grace')
            try: p['driverExit'] = child.wait(timeout=10)
            except subprocess.TimeoutExpired: p['exitUnobserved'] = True
        except Exception as e:
            p['error'] = {'type': type(e).__name__, 'message': str(e)}
        finally:
            if child is not None and child.poll() is None and driver is not None:
                signal_exact(driver, signal.SIGTERM, p['signals'], 'known-own-phase-cleanup')
                until = time.monotonic() + 5
                while child.poll() is None and time.monotonic() < until: wait_tick(.25, label + ':cleanup-grace')
                if child.poll() is None: signal_exact(driver, signal.SIGKILL, p['signals'], 'known-own-phase-cleanup-after-grace')
                try: p['driverExit'] = child.wait(timeout=5)
                except subprocess.TimeoutExpired: p['exitUnobserved'] = True
            if child is not None and p['driverExit'] is None and child.poll() is not None: p['driverExit'] = child.returncode
            if guard:
                until = time.monotonic() + 5
                while same_identity(guard, ps_one(guard['pid'])) and time.monotonic() < until: wait_tick(.25, label + ':guard-exit')
                if same_identity(guard, ps_one(guard['pid'])):
                    signal_exact(guard, signal.SIGTERM, p['signals'], 'exact-own-residual-power-guard')
                    wait_tick(.5, label + ':guard-term')
                p['guardAbsentAtPhaseEnd'] = not same_identity(guard, ps_one(guard['pid']))
                p['endOwnAssertions'] = own_assertions([guard['pid']])
            stdout.close(); stderr.close(); p['finishedAt'] = utc(); save('power-lifecycle.private.json', r)
        return p
    heartbeat_thread = threading.Thread(target=heartbeat_loop, name='wrapper-wall-mono-heartbeat', daemon=True); heartbeat_thread.start()
    driver = {'driverExit': None}; cleanup = {'driverExit': None}
    try:
        r['ACPowerBeforeDriver'] = current_ac_power(); save('power-lifecycle.private.json', r)
        assert r['ACPowerBeforeDriver']['ACPower'], 'AC precondition not observed; no driver launched'
        try:
            driver = guarded('driver', commands['driver'], binding['driverBudgetSeconds'])
        except Exception as e:
            r['errors'].append({'phase': 'driver-wrapper', 'type': type(e).__name__, 'message': str(e)})
        finally:
            # Original cleanup is attempted even if the driver or power observer failed.
            try: cleanup = guarded('cleanup', commands['cleanup'], binding['cleanupBudgetSeconds'])
            except Exception as e: r['errors'].append({'phase': 'cleanup-wrapper', 'type': type(e).__name__, 'message': str(e)})
        env = dict(os.environ, WILLYOU_TEST_CACHE_DIR=str(TARGET / 'cache'), NODE_COMPILE_CACHE=str(TARGET / 'cache/node'))
        with open(runtime / 'judge.stdout.private.log', 'xb') as out, open(runtime / 'judge.stderr.private.log', 'xb') as err:
            os.chmod(out.name, 0o600); os.chmod(err.name, 0o600)
            heartbeat_stage[0] = 'pure-target-judge'
            judge = subprocess.Popen(commands['judge'], cwd=TARGET, env=env, stdout=out, stderr=err)
            r['judgePid'] = judge.pid
            try: r['judgeExit'] = judge.wait(timeout=60)
            except subprocess.TimeoutExpired:
                judge.kill(); r['judgeExit'] = judge.wait(timeout=5); r['judgeTimeout'] = True
        raw = read_json(TARGET / 'raw.private.json'); clean = read_json(TARGET / 'cleanup-verification.json'); judged = read_json(TARGET / 'judgement.json')
        normal = raw.get('appExit', {}).get('code') == 0 and raw.get('appExit', {}).get('signal') is None and raw.get('observedProcess', {}).get('signals') == []
        original_green = raw.get('status') == 't09-cm-executed-unjudged' and not raw.get('cleanupErrors') and not raw.get('persistenceErrors') and bool(judged.get('prechecks')) and all(x.get('passed') for x in judged['prechecks']) and judged.get('decision', {}).get('passed') == 7 and judged.get('decision', {}).get('total') == 7 and len(judged.get('decision', {}).get('checks', [])) == 7 and all(c.get('passed') for c in judged['decision']['checks'])
        r['targetAppNormalObserved'] = normal; r['targetIndependentCleanupAllClear'] = clean.get('allClear') is True and bool(clean.get('checks')) and all(x.get('clear') for x in clean['checks'])
        power = all(p.get('startOwnAssertions', {}).get('allRequestedOwnAssertionsObserved') and p.get('guardAbsentAtPhaseEnd') and p.get('endOwnAssertions', {}).get('allOwnAssertionsAbsent') and not p.get('signals') and not p.get('error') and not p.get('timedOut') for p in r['phases'])
        r['conditionsVerifiedBeforeWrapperExit'] = driver.get('driverExit') == 0 and cleanup.get('driverExit') == 0 and r['judgeExit'] == 0 and normal and original_green and r['targetIndependentCleanupAllClear'] and power
        r['targetEvidenceSHA'] = {n: sha((TARGET/n).read_bytes()) for n in ['raw.private.json', 'cleanup-verification.json', 'judgement.json']}
    except Exception as e:
        r['errors'].append({'type': type(e).__name__, 'message': str(e)}); r['conditionsVerifiedBeforeWrapperExit'] = False
    finally:
        heartbeat_stop.set(); heartbeat_thread.join(timeout=2); tick('wrapper-finishing'); heartbeat.close(); r['heartbeatErrors'] = heartbeat_errors; r['heartbeat'] = {'layer': 'Python wrapper only', 'intervalRequestedMs': 250, 'samples': heartbeat_count, 'maxWallGapMs': max_wall_gap, 'maxMonoGapMs': max_mono_gap,
            'environmentGapReviewRequired': max_wall_gap > 750 or max_mono_gap > 750, 'noProofAgainstAllSleepOrNodePause': True}
        if heartbeat_errors: r['conditionsVerifiedBeforeWrapperExit'] = False
        r['finishedAt'] = utc(); r['postTerminalVerificationRequired'] = True; r['resourcesHeld'] = True
        save('power-lifecycle.private.json', r)
        print(json.dumps({'phase': 'wrapper-terminal-pending-external-exit-verifier', 'wrapperPid': os.getpid(), 'conditionsVerifiedBeforeWrapperExit': r.get('conditionsVerifiedBeforeWrapperExit', False), 'postTerminalVerificationRequired': True, 'formalCaseIncrement': 0}))
    return 0 if r.get('conditionsVerifiedBeforeWrapperExit') else 1

def verify_after_terminal():
    assert os.environ.get('WILLYOU_M12_NATIVE_LEASE_CONFIRMED') == '1'
    r = read_json(ROOT / 'power-lifecycle.private.json'); checks = []
    for identity in r['knownIdentities']:
        assert identity['pid'] != os.getpid(), 'Verifier is not a historical subject; no self-allClear cycle'
        current = ps_one(identity['pid']); checks.append({'pid': identity['pid'], 'expected': identity, 'presentSameIdentity': same_identity(identity, current), 'clear': not same_identity(identity, current)})
    known_pids = {x['pid'] for x in r['knownIdentities']}
    for pid in [p['launcherPid'] for p in r['phases'] if p.get('launcherPid')] + ([r['judgePid']] if r.get('judgePid') else []):
        if pid not in known_pids:
            assert pid != os.getpid()
            current = ps_one(pid); checks.append({'pid': pid, 'expected': {'source': 'own Popen PID; detailed birth not observed'}, 'clear': current is None, 'noSignalOnUnknownIdentity': True})
    guards = [p['guardIdentity']['pid'] for p in r['phases'] if p.get('guardIdentity')]
    power = own_assertions(guards); guard_bindings_complete = bool(r['phases']) and all(p.get('guardIdentity') for p in r['phases'] if p.get('launcherPid')); extra_clear = bool(checks) and guard_bindings_complete and all(c['clear'] for c in checks) and power['allOwnAssertionsAbsent']
    target_clear = r.get('targetIndependentCleanupAllClear') is True
    out = {'at': utc(), 'checks': checks, 'ownAssertionEnd': power, 'allExtraOwnedProcessesAndAssertionsClear': extra_clear,
           'targetOriginalIndependentCleanupAllClear': target_clear, 'safeToReleaseResources': extra_clear and target_clear,
           'conditionsVerified': extra_clear and target_clear and r.get('conditionsVerifiedBeforeWrapperExit') is True and not r.get('heartbeat', {}).get('environmentGapReviewRequired', True),
           'originalBusinessAndLifecycleConditionsVerified': r.get('conditionsVerifiedBeforeWrapperExit') is True, 'allLaunchedGuardBindingsComplete': guard_bindings_complete,
           'heartbeatEnvironmentReviewRequired': r.get('heartbeat', {}).get('environmentGapReviewRequired', True),
           'formalCaseIncrement': 0, 'currentVerifierNotIncludedAsHistoricalSubject': True}
    save('wrapper-exit-verification-001.json', out)
    print(json.dumps({k: out[k] for k in ['safeToReleaseResources', 'conditionsVerified', 'heartbeatEnvironmentReviewRequired', 'formalCaseIncrement']}))
    return 0 if out['safeToReleaseResources'] else 1

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); parser.add_argument('--execute', action='store_true'); parser.add_argument('--verify-wrapper-exit', action='store_true'); args = parser.parse_args()
    assert sum([args.check, args.execute, args.verify_wrapper_exit]) == 1
    if args.check:
        binding, commands = check_inputs(); print(json.dumps({'targetRoot': str(TARGET), 'targetInputCount': 256, 'originalCommandsUnchanged': True, 'Native': 0, 'runtimeStarted': False, 'commands': commands})); sys.exit(0)
    sys.exit(execute() if args.execute else verify_after_terminal())
