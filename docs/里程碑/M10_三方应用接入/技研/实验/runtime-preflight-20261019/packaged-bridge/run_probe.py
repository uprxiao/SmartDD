#!/usr/bin/env python3
"""Bounded A19 packaged-Electron bridge probe; writes only its research outputs."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import selectors
import signal
import subprocess
import sys
import time


HERE = Path(__file__).resolve().parent
REPO = next(parent for parent in HERE.parents if (parent / 'package.json').is_file())
DEFAULT_OUTPUT = REPO / 'release/m10-research/runtime-preflight-20261019/packaged-bridge'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def identify(app):
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    executable = app / 'Contents/MacOS' / info['CFBundleExecutable']
    artifacts = [
        executable,
        app / 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
        app / 'Contents/Resources/app.asar',
    ]
    return {
        'app': str(app),
        'bundleIdentifier': info.get('CFBundleIdentifier'),
        'bundleName': info.get('CFBundleDisplayName', info.get('CFBundleName')),
        'bundleVersion': info.get('CFBundleVersion'),
        'shortVersion': info.get('CFBundleShortVersionString'),
        'executable': str(executable),
        'artifacts': [
            {'path': str(p), 'size': p.stat().st_size, 'sha256': digest(p)}
            for p in artifacts if p.is_file()
        ],
        'fileDescription': subprocess.check_output(['file', str(executable)], text=True).strip(),
    }


class Bridge:
    def __init__(self, executable, marker, cwd, deadline):
        # No credential/config environment is forwarded. Do not change HOME or
        # any Agent home; the fixture does not access those directories at all.
        env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL', 'TZ') if k in os.environ}
        env['ELECTRON_RUN_AS_NODE'] = '1'
        env['TMPDIR'] = str(cwd)
        self.marker = marker
        self.deadline = deadline
        self.requests = []
        self.responses = []
        self.stdout = b''
        self.stderr = b''
        self.buffer = b''
        self.command = [str(executable), str(HERE / 'fixture-bridge.cjs'), marker]
        self.proc = subprocess.Popen(
            self.command, cwd=cwd, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True,
        )
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.proc.stdout, selectors.EVENT_READ, 'stdout')
        self.selector.register(self.proc.stderr, selectors.EVENT_READ, 'stderr')

    def send(self, value):
        self.requests.append(value)
        self.proc.stdin.write((json.dumps(value) + '\n').encode())
        self.proc.stdin.flush()

    def pump(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('probe-wide 20 second deadline reached')
        for key, _ in self.selector.select(min(remaining, 0.25)):
            data = os.read(key.fileobj.fileno(), 65536)
            if not data:
                self.selector.unregister(key.fileobj)
            elif key.data == 'stdout':
                self.stdout += data
                self.buffer += data
            else:
                self.stderr += data
        if len(self.stdout) + len(self.stderr) > 1024 * 1024:
            raise RuntimeError('fixture output exceeded 1 MiB')

    def receive(self, expected_id):
        while b'\n' not in self.buffer:
            self.pump()
            if self.proc.poll() is not None and not self.selector.get_map() and b'\n' not in self.buffer:
                raise RuntimeError(f'bridge exited before response {expected_id}')
        line, self.buffer = self.buffer.split(b'\n', 1)
        value = json.loads(line)
        assert value['jsonrpc'] == '2.0' and value['id'] == expected_id, value
        assert 'error' not in value, value
        self.responses.append(value)
        return value['result']

    def finish(self):
        self.proc.stdin.close()
        while self.proc.poll() is None or self.selector.get_map():
            self.pump()
        assert self.proc.returncode == 0, self.proc.returncode
        assert self.buffer == b'', 'unexpected additional stdout bytes'
        assert len(self.stdout.splitlines()) == 3, 'stdout must contain exactly three JSON responses'
        assert self.stderr.decode() == f'bridge fixture started: {self.marker}\n'

    def cleanup(self):
        # The fixture never spawns children. Terminate only this still-owned
        # Popen process; do not signal unrelated user processes or global groups.
        action = 'already-exited'
        if self.proc.poll() is None:
            self.proc.terminate()
            action = 'sigterm'
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=2)
                action = 'sigkill'
        self.selector.close()
        for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
            if not stream.closed:
                stream.close()
        return {'pid': self.proc.pid, 'action': action, 'returnCode': self.proc.returncode}

    def evidence(self):
        return {
            'marker': self.marker, 'pid': self.proc.pid, 'command': self.command,
            'requests': self.requests, 'responses': self.responses,
            'stdout': self.stdout.decode(errors='replace'),
            'stderr': self.stderr.decode(errors='replace'),
            'exitCode': self.proc.returncode,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=REPO / 'release/mac-arm64/SmartDD.app')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    app = args.app.resolve()
    output = args.output.resolve()
    if output != DEFAULT_OUTPUT and DEFAULT_OUTPUT not in output.parents:
        parser.error('output must remain within the assigned packaged-bridge research directory')
    output.mkdir(parents=True, exist_ok=True)
    work = output / 'work'
    work.mkdir(exist_ok=True)
    record = {
        'schema': 'willyou-a19-packaged-runtime-probe-v1',
        'startedAt': utc_now(), 'status': 'running',
        'scope': 'Existing packaged Electron runtime + analyst-owned harmless stdio bridge',
        'notCovered': [
            'Production M10 MCP bridge, packaging or packaged-app GUI lifecycle',
            'Agent discovery, model invocation, skill loading, resume or authorization',
            'Real ZenTao, Foxmail, SMTP, user data, credentials or business actions',
            'Windows, Linux, macOS x64, other Electron builds or future host upgrades',
            'Full MCP specification conformance or external client interoperability',
        ],
        'sourceHashes': {name: digest(HERE / name) for name in ('fixture-bridge.cjs', 'run_probe.py')},
        'artifactBefore': identify(app),
        'processEnvironment': {'mode': 'allowlist', 'forwardedKeys': [k for k in ('PATH', 'LANG', 'LC_ALL', 'TZ') if k in os.environ], 'setKeys': ['ELECTRON_RUN_AS_NODE=1', 'TMPDIR=<research work directory>']},
        'checks': [],
    }
    bridges = []
    cleanup = []
    deadline = time.monotonic() + 20

    def interrupted(signum, _frame):
        raise RuntimeError(f'probe interrupted by signal {signum}')

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        executable = Path(record['artifactBefore']['executable'])
        for marker in ('fixture-v1', 'fixture-v2'):
            bridges.append(Bridge(executable, marker, work, deadline))
        for bridge in bridges:
            bridge.send({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'a19-python-fixture-driver', 'version': '1.0.0'}}})
        for bridge in bridges:
            result = bridge.receive(1)
            assert result['serverInfo']['version'] == bridge.marker
            assert result['protocolVersion'] == '2024-11-05'
            bridge.send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
            bridge.send({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
        for bridge in bridges:
            result = bridge.receive(2)
            assert [t['name'] for t in result['tools']] == ['will_you_preflight_version']
            bridge.send({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'will_you_preflight_version', 'arguments': {}}})
        for bridge in bridges:
            result = bridge.receive(3)
            assert result['isError'] is False
            content = json.loads(result['content'][0]['text'])
            assert content['marker'] == bridge.marker
            assert content['runtime']['arch'] == 'arm64'
            assert content['runtime']['platform'] == 'darwin'
            assert content['runtime']['electron']
            assert Path(content['runtime']['execPath']).resolve() == executable.resolve()
        for bridge in bridges:
            bridge.finish()
        record['checks'] = [
            'Two concurrent processes used the selected packaged Electron executable',
            'initialize + notifications/initialized + tools/list + tools/call completed per bridge',
            'Each bridge returned only its supplied fixture version marker',
            'Runtime identified Darwin arm64 and real Electron/Node versions',
            'stdout contained exactly three JSON-RPC response lines per process; diagnostics only on stderr',
            'Both processes exited with code 0 after stdin EOF',
        ]
        record['status'] = 'passed'
    except Exception as error:
        record['status'] = 'failed'
        record['error'] = {'type': type(error).__name__, 'message': str(error)}
    finally:
        for bridge in bridges:
            cleanup.append(bridge.cleanup())
        record['runs'] = [bridge.evidence() for bridge in bridges]
        record['cleanup'] = cleanup
        record['artifactAfter'] = identify(app)
        record['artifactUnchanged'] = record['artifactBefore'] == record['artifactAfter']
        if not record['artifactUnchanged']:
            record['status'] = 'failed'
            record['error'] = {'type': 'ArtifactChanged', 'message': 'Selected packaged artifact identity changed during probe'}
        record['finishedAt'] = utc_now()
        (output / 'result.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        for bridge in bridges:
            (output / f'{bridge.marker}.stdout.jsonl').write_bytes(bridge.stdout)
            (output / f'{bridge.marker}.stderr.txt').write_bytes(bridge.stderr)
        print(json.dumps({'status': record['status'], 'output': str(output / 'result.json'), 'checks': len(record['checks']), 'processes': len(bridges), 'artifactUnchanged': record['artifactUnchanged'], 'error': record.get('error')}, ensure_ascii=False))
    return 0 if record['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
