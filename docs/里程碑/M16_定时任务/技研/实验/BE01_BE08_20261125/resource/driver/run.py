#!/usr/bin/env python3
"""Launch exactly one isolated synthetic experimental run. No user App use."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha256(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def group_members(pgid):
    """Record only numeric members of the exact NEW process group we created."""
    reply = subprocess.run(['/bin/ps', '-axo', 'pid=,pgid='], capture_output=True, text=True, timeout=4, check=True)
    return sorted(int(row.split()[0]) for row in reply.stdout.splitlines()
                  if len(row.split()) == 2 and row.split()[1].isdigit() and int(row.split()[1]) == pgid)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--electron', type=Path, required=True,
                   help='Pinned Electron 42.11.14 executable in isolated baseline dependency')
    p.add_argument('--mode', choices=['keep', 'idle'], required=True)
    p.add_argument('--length', choices=['short', 'long'], required=True)
    args = p.parse_args()
    electron = args.electron.resolve(strict=True)
    if (not electron.is_file() or not os.access(electron, os.X_OK) or electron.name != 'Electron'
            or 'node_modules' not in electron.parts or 'Electron.app' not in electron.parts):
        p.error('--electron must be the local Electron dependency executable, not an installed user App')
    # Explicit invocation selects a pinned executable; do not launch existing App,
    # open URLs, activate windows, copy production profiles, or inherit credentials.
    probe = Path(__file__).resolve().with_name('resource-probe.cjs')
    analyzer = probe.with_name('analyze.py')
    root = Path(tempfile.mkdtemp(prefix='willyou-f36-resource-run-', dir='/private/tmp')).resolve()
    for dirname in ('home', 'tmp', 'xdg-config', 'xdg-cache', 'xdg-data'):
        (root / dirname).mkdir()
    env = dict(PATH='/usr/bin:/bin:/usr/sbin:/sbin', LANG='en_US.UTF-8',
               HOME=str(root / 'home'), TMPDIR=str(root / 'tmp'),
               XDG_CONFIG_HOME=str(root / 'xdg-config'), XDG_CACHE_HOME=str(root / 'xdg-cache'),
               XDG_DATA_HOME=str(root / 'xdg-data'),
               WY_F36_RESOURCE_ROOT=str(root), WY_F36_RESOURCE_MODE=args.mode,
               WY_F36_RESOURCE_LENGTH=args.length)
    trial_probe = root / 'resource-probe.cjs'
    trial_probe.write_bytes(probe.read_bytes())
    (root / 'analyze.py').write_bytes(analyzer.read_bytes())
    manifest = dict(kind='synthetic BE08 technical probe; not a production T111 execution',
                    createdUtc=utc(), root=str(root), mode=args.mode, length=args.length,
                    electron=str(electron), electronExecutableSha256=sha256(electron),
                    probeSha256=sha256(trial_probe), analyzerSha256=sha256(root / 'analyze.py'),
                    command=[str(electron), str(trial_probe)], profileIsolation=True,
                    startNewSession=True)
    (root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'BE08_RESOURCE_RUN={root}', flush=True)
    result = dict(startUtc=utc(), timeout=False, forcedTermination=[], processGroupMembersAfterExit=None)
    duration = 1800 if args.length == 'long' else 30
    with (root / 'stdout.log').open('wb') as stdout, (root / 'stderr.log').open('wb') as stderr:
        child = subprocess.Popen(manifest['command'], cwd=root, env=env, stdout=stdout,
                                 stderr=stderr, start_new_session=True)
        group_id = child.pid
        try:
            observed_group=os.getpgid(child.pid)
        except ProcessLookupError:
            observed_group=None  # preserve startup failure rather than assume identity
        result.update(pid=child.pid, expectedProcessGroup=group_id, observedProcessGroup=observed_group)
        (root / 'launch.json').write_text(json.dumps(result, indent=2) + '\n')
        try:
            result['exitCode'] = child.wait(timeout=duration + 180)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
            # Do not touch any user application or guessed PID. The only forced
            # fallback is the exact child object just started by this runner.
            result['timeout'] = isinstance(error, subprocess.TimeoutExpired)
            result['interrupted'] = isinstance(error, KeyboardInterrupt)
            result['forcedTermination'].append('terminate exact launched child after deadline/interruption')
            child.terminate()
            try:
                result['exitCode'] = child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                result['forcedTermination'].append('kill exact launched child after 15s')
                child.kill()
                result['exitCode'] = child.wait(timeout=10)
    try:
        deadline = time.monotonic() + 8
        while True:
            result['processGroupMembersAfterExit'] = group_members(group_id)
            if not result['processGroupMembersAfterExit'] or time.monotonic() >= deadline:
                break
            time.sleep(.2)
    except (OSError, subprocess.SubprocessError) as exc:
        result['groupObservationError'] = repr(exc)
    result['endUtc'] = utc()
    (root / 'run-result.json').write_text(json.dumps(result, indent=2) + '\n')
    # Analyze in the invoking shell's Python, after the process has exited. This
    # avoids PNG decoding / statistics affecting the measured app's CPU/RSS.
    assessment = subprocess.run([sys.executable, str(root / 'analyze.py'), str(root)])
    print(f'BE08_RESOURCE_SUMMARY={root / "summary.json"}', flush=True)
    raise SystemExit(assessment.returncode or (0 if result['exitCode'] == 0 else 1))


if __name__ == '__main__':
    main()
