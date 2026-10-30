#!/usr/bin/env python3
"""Bounded CC preflight against the real native root; never prints credentials."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import threading
import time
import uuid

SELF = Path(__file__).resolve()
ROOT = SELF.parents[7]
OUT = SELF.parent
ART = ROOT / 'release/m10-research/runtime-preflight-20261019/claude-user-config'
CLI = '/Users/liubu/.local/bin/claude'
NATIVE = Path('/Users/liubu/.claude')
USER_CONFIG = Path('/Users/liubu/.claude.json')
PROFILE = OUT.parent / 'claude/probe.py'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    path.chmod(0o600)


def now():
    return datetime.now(timezone.utc).isoformat()


def config_snapshot():
    paths = [NATIVE / 'settings.json', NATIVE / 'settings.local.json', USER_CONFIG,
             ROOT / '.claude/settings.json', ROOT / '.claude/settings.local.json', ROOT / '.mcp.json']
    files = {}
    for path in paths:
        if not path.exists():
            continue
        d = json.loads(path.read_text())
        # Record digests of semantic values, never their contents.
        keys = {k: hashlib.sha256(json.dumps(v, sort_keys=True).encode()).hexdigest() for k, v in d.items()}
        files[str(path)] = {'sha256': sha(path), 'topLevelValueHashes': keys}
    return files


def prepare():
    ART.mkdir(parents=True, exist_ok=True)
    path = ART / 'fixture.json'
    if path.exists():
        return json.loads(path.read_text())
    plugin = ART / 'packages/1.0.0/plugin'
    skill = plugin / 'skills/version-check'
    (skill / 'references').mkdir(parents=True, exist_ok=True)
    nonce = uuid.uuid4().hex
    save(plugin / '.claude-plugin/plugin.json', {'name': 'wy-native-preflight', 'version': '1.0.0'})
    (skill / 'SKILL.md').write_text('---\nname: version-check\ndescription: Synthetic WillYou native-root version test.\n---\n\n'
        f'Use Read on this exact reference: {skill / "references/check.json"}.\n'
        'Then call mcp__wy_native_preflight__version_check once using its reference_nonce. '
        'Report version and nonceMatch. Do not use any other skill or MCP. Do not run commands or inspect other files.\n')
    save(skill / 'references/check.json', {'reference_nonce': nonce, 'version': '1.0.0'})
    (ART / 'project-a').mkdir(exist_ok=True)
    fixture = {'sessionId': str(uuid.uuid4()), 'plugin': str(plugin), 'nonce': nonce}
    save(path, fixture)
    return fixture


def bridge():
    marker, nonce, log = sys.argv[2:5]
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        if 'id' not in req:
            continue
        method = req.get('method')
        if method == 'initialize':
            result = {'protocolVersion': req.get('params', {}).get('protocolVersion', '2025-06-18'),
                      'capabilities': {'tools': {}}, 'serverInfo': {'name': 'wy-native-preflight', 'version': '1.0.0'}}
        elif method == 'tools/list':
            result = {'tools': [{'name': 'version_check', 'description': marker,
                'inputSchema': {'type': 'object', 'properties': {'reference_nonce': {'type': 'string'}}, 'required': ['reference_nonce'], 'additionalProperties': False},
                'annotations': {'readOnlyHint': True, 'destructiveHint': False, 'idempotentHint': True, 'openWorldHint': False}}]}
        elif method == 'tools/call':
            params = req.get('params', {})
            record = {'version': '1.0.0', 'marker': marker, 'nonceMatch': params.get('arguments', {}).get('reference_nonce') == nonce,
                      'tool': params.get('name')}
            with open(log, 'a') as f:
                f.write(json.dumps(record) + '\n')
            result = {'content': [{'type': 'text', 'text': json.dumps(record)}], 'isError': not record['nonceMatch']}
        elif method == 'ping':
            result = {}
        else:
            print(json.dumps({'jsonrpc': '2.0', 'id': req['id'], 'error': {'code': -32601, 'message': 'Unsupported'}}), flush=True)
            continue
        print(json.dumps({'jsonrpc': '2.0', 'id': req['id'], 'result': result}), flush=True)


class Client:
    def __init__(self, label, args, env):
        self.label, self.events, self.q = label, [], queue.Queue()
        self.raw = (ART / f'{label}.jsonl').open('w')
        self.err = (ART / f'{label}.stderr').open('w')
        self.p = subprocess.Popen([CLI, *args], cwd=ART / 'project-a', env=env, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=self.err, text=True, bufsize=1, start_new_session=True)
        self.thread = threading.Thread(target=self.read, daemon=True)
        self.thread.start()

    def read(self):
        for line in self.p.stdout:
            self.raw.write(line)
            self.raw.flush()
            try:
                x = json.loads(line)
            except ValueError:
                continue
            self.events.append(x)
            self.q.put(x)

    def send(self, x):
        self.p.stdin.write(json.dumps(x) + '\n')
        self.p.stdin.flush()

    def wait(self, predicate, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                x = self.q.get(timeout=min(0.5, max(0.001, deadline - time.monotonic())))
            except queue.Empty:
                if self.p.poll() is not None:
                    return None
                continue
            if predicate(x):
                return x
        return None

    def control(self, subtype):
        ident = uuid.uuid4().hex
        self.send({'type': 'control_request', 'request_id': ident, 'request': {'subtype': subtype}})
        return self.wait(lambda x: x.get('type') == 'control_response' and x.get('response', {}).get('request_id') == ident, 25)

    def close(self):
        # Only this probe's process group; default native session history is retained.
        if self.p.poll() is None:
            os.killpg(self.p.pid, signal.SIGTERM)
            try:
                self.p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(self.p.pid, signal.SIGKILL)
                self.p.wait()
        self.thread.join(timeout=2)
        self.raw.close()
        self.err.close()


def run(mode):
    fixture = prepare()
    config = json.loads(USER_CONFIG.read_text())
    user_mcp = sorted(config.get('mcpServers', {}))
    env = dict(os.environ)
    env.pop('CLAUDE_CONFIG_DIR', None)
    env.pop('CLAUDECODE', None)
    spec = importlib.util.spec_from_file_location('existing_profile', PROFILE)
    profile = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(profile)
    profile.apply_cdsh(env)
    env.update({'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_AUTOUPDATER': '1',
                'CLAUDE_CODE_MAX_RETRIES': '0', 'API_TIMEOUT_MS': '60000'})
    label = mode + '-' + datetime.now(timezone.utc).strftime('%H%M%S')
    log = ART / (label + '-calls.jsonl')
    log.write_text('')
    managed = {'command': sys.executable, 'args': [str(SELF), 'bridge', 'WY_NATIVE_MANAGED', fixture['nonce'], str(log)]}
    mcp = {'mcpServers': {'wy_native_preflight': managed}}
    plugin_dirs = [fixture['plugin']]
    conflict = None
    if mode == 'collision':
        baseline = json.loads((OUT / 'inventory-result.json').read_text())
        namespaced = next(c for c in baseline['commands'] if ':' in c['name'] and c['name'].split(':')[0] in ['memex', 'understand-anything'])
        namespace, skill_name = namespaced['name'].split(':', 1)
        collision_plugin = ART / 'collision-plugin'
        save(collision_plugin / '.claude-plugin/plugin.json', {'name': namespace, 'version': '9.9.9'})
        skill_path = collision_plugin / 'skills' / skill_name / 'SKILL.md'
        skill_path.parent.mkdir(parents=True, exist_ok=True)
        skill_path.write_text(f'---\nname: {skill_name}\ndescription: WY_EXACT_COLLISION_SENTINEL synthetic fixture never invoke.\n---\n\nNever run this discovery fixture.\n')
        plugin_dirs.append(str(collision_plugin))
        collision_mcp = 'chatlog' if 'chatlog' in user_mcp else user_mcp[0]
        mcp['mcpServers'][collision_mcp] = {'command': sys.executable, 'args': [str(SELF), 'bridge', 'WY_MCP_COLLISION_SENTINEL', fixture['nonce'], str(log)]}
        conflict = {'skillFullName': namespaced['name'], 'originalDescriptionHash': namespaced['descriptionHash'], 'mcpServerName': collision_mcp}
    mcp_path = ART / (label + '-mcp.json')
    save(mcp_path, mcp)
    args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--permission-mode', 'dontAsk', '--max-turns', '7', '--max-budget-usd', '1.00',
        '--settings', json.dumps({'disableAllHooks': True}), '--model', env['ANTHROPIC_MODEL'],
        '--tools', 'Skill,Read', '--allowedTools', 'Skill', 'Read', 'mcp__wy_native_preflight__version_check',
        '--disallowedTools', *['mcp__' + name + '__*' for name in user_mcp]]
    if mode != 'baseline':
        args += ['--mcp-config', str(mcp_path)]
        for path in plugin_dirs:
            args.extend(['--plugin-dir', path])
    if mode in ['inventory', 'collision', 'baseline']:
        args.append('--no-session-persistence')
    else:
        args += ['--resume' if mode == 'real-resume' else '--session-id', fixture['sessionId']]
    before = config_snapshot()
    report = {'schema': 'm10-cc-real-user-config-preflight-v1', 'mode': mode, 'label': label, 'startedAt': now(),
        'cliVersion': subprocess.check_output([CLI, '--version'], text=True).strip(), 'binarySha256': sha(CLI),
        'scriptSha256': sha(SELF), 'profileExtractorSha256': sha(PROFILE), 'model': env['ANTHROPIC_MODEL'],
        'nativeRoot': str(NATIVE), 'HOME': env.get('HOME'), 'CLAUDE_CONFIG_DIR': env.get('CLAUDE_CONFIG_DIR'),
        'cwd': str(ART / 'project-a'), 'normalSettingSources': True, 'strictMcpConfig': False,
        'hooksDisabledForProbe': True, 'userMcpNames': user_mcp, 'expectedSessionId': fixture['sessionId'],
        'collision': conflict, 'configBefore': before, 'argv': args, 'realModel': mode.startswith('real-')}
    client = None
    try:
        client = Client(label, args, env)
        init = client.control('initialize')
        payload = (init or {}).get('response', {}).get('response', {})
        commands = payload.get('commands', [])
        report['initializeSucceeded'] = (init or {}).get('response', {}).get('subtype') == 'success'
        report['commands'] = [{'name': c.get('name'), 'descriptionHash': hashlib.sha256(c.get('description', '').encode()).hexdigest(),
                               'syntheticCollisionMarker': 'WY_EXACT_COLLISION_SENTINEL' in c.get('description', '')} for c in commands]
        report['mcpChecks'] = []
        servers = []
        for attempt in range(8):
            status = client.control('mcp_status')
            servers = (status or {}).get('response', {}).get('response', {}).get('mcpServers', [])
            report['mcpChecks'].append([{'name': s.get('name'), 'status': s.get('status')} for s in servers])
            if servers and all(s.get('status') != 'pending' for s in servers):
                break
            time.sleep(0.4)
        report['mcpServers'] = [{'name': s.get('name'), 'status': s.get('status'), 'scope': s.get('scope'),
            'source': s.get('source'), 'toolNames': [t.get('name') for t in s.get('tools', [])] if isinstance(s.get('tools'), list) else list(s.get('tools', {}))} for s in servers]
        if mode.startswith('real-'):
            prompt = ('This is an authorized synthetic compatibility probe. Run only /wy-native-preflight:version-check. '
                'Use Skill then explicitly Read its exact reference file again, and invoke only mcp__wy_native_preflight__version_check exactly once. '
                'Do not use previous answers as the nonce source. Do not call any other MCP, any other Skill, any other Read, or shell. Return its tool result.')
            client.send({'type': 'user', 'session_id': fixture['sessionId'], 'message': {'role': 'user', 'content': prompt}, 'parent_tool_use_id': None})
            result = client.wait(lambda x: x.get('type') == 'result', 80)
            report['resultSubtype'] = (result or {}).get('subtype')
            report['resultIsError'] = (result or {}).get('is_error', True)
            report['timedOut'] = result is None
            report['actualSessionId'] = (result or {}).get('session_id')
            uses = [c for e in client.events for c in e.get('message', {}).get('content', []) if isinstance(c, dict) and c.get('type') == 'tool_use']
            report['toolNames'] = [c.get('name') for c in uses]
            report['referenceRead'] = any(c.get('name') == 'Read' and c.get('input', {}).get('file_path') == str(Path(fixture['plugin']) / 'skills/version-check/references/check.json') for c in uses)
            report['onlyProbeToolUses'] = all(c.get('name') in ['Skill', 'Read', 'mcp__wy_native_preflight__version_check'] for c in uses)
            report['mcpCalls'] = [json.loads(l) for l in log.read_text().splitlines()]
            report['nativeSessionFile'] = next((str(p) for p in (NATIVE / 'projects').glob('*/' + fixture['sessionId'] + '.jsonl')), None)
            report['passed'] = (report['initializeSucceeded'] and not report['resultIsError'] and report['actualSessionId'] == fixture['sessionId']
                and report['referenceRead'] and report['onlyProbeToolUses'] and len(report['mcpCalls']) == 1 and report['mcpCalls'][0]['nonceMatch'])
        else:
            report['passed'] = report['initializeSucceeded'] and all(n in [s['name'] for s in report['mcpServers']] for n in user_mcp)
    except Exception as exc:
        report['passed'] = False
        report['exceptionType'] = type(exc).__name__
        # Do not print arbitrary exception text; it can include settings or response data.
    finally:
        if client:
            client.close()
            report['childExited'] = client.p.poll() is not None
            report['rawEventCount'] = len(client.events)
        after = config_snapshot()
        report['configAfter'] = after
        report['configChanges'] = [{'path': p, 'bytesUnchanged': b['sha256'] == after.get(p, {}).get('sha256'),
            'changedTopLevelKeys': sorted(k for k in set(b['topLevelValueHashes']) | set(after.get(p, {}).get('topLevelValueHashes', {}))
                if b['topLevelValueHashes'].get(k) != after.get(p, {}).get('topLevelValueHashes', {}).get(k))} for p, b in before.items()]
        report['rawArtifacts'] = [{'path': str(p.relative_to(ROOT)), 'sha256': sha(p)} for p in [ART / f'{label}.jsonl', ART / f'{label}.stderr', log] if p.exists()]
        report['endedAt'] = now()
        save(OUT / (mode + '-result.json'), report)
        print(json.dumps({'mode': mode, 'passed': report['passed'], 'commandCount': len(report.get('commands', [])),
            'mcp': [{'name': s['name'], 'status': s['status'], 'toolCount': len(s['toolNames'])} for s in report.get('mcpServers', [])],
            'realResultSubtype': report.get('resultSubtype'), 'configChanges': report['configChanges'],
            'report': str(OUT / (mode + '-result.json'))}, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'bridge':
        bridge()
    else:
        parser = argparse.ArgumentParser()
        parser.add_argument('mode', choices=['baseline', 'inventory', 'collision', 'real-new', 'real-resume'])
        run(parser.parse_args().mode)
