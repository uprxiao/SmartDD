#!/usr/bin/env python3
"""Bounded real-Claude mechanism probe; synthetic data, no business accounts.

Native state is isolated with CLAUDE_CONFIG_DIR; actual HOME stays unchanged.
Only the caller's existing Anthropic environment auth is inherited, never logged.
This is not proof of default-root user configuration compatibility.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import shlex
from pathlib import Path
import signal
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[7]
ART = ROOT / 'release/m10-research/runtime-preflight-20261019/claude'
SCRIPT = Path(__file__).resolve()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    path.chmod(0o600)


def bridge():
    version, nonce, log = sys.argv[2:5]
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        method, ident = req.get('method'), req.get('id')
        if ident is None:
            continue
        if method == 'initialize':
            result = {'protocolVersion': req.get('params', {}).get('protocolVersion', '2025-06-18'),
                      'capabilities': {'tools': {}}, 'serverInfo': {'name': 'wy-preflight', 'version': version}}
        elif method == 'tools/list':
            result = {'tools': [{'name': 'version_check', 'description': 'Read-only synthetic version and reference check.',
                       'inputSchema': {'type': 'object', 'properties': {'reference_nonce': {'type': 'string'}},
                                       'required': ['reference_nonce'], 'additionalProperties': False},
                       'annotations': {'readOnlyHint': True, 'destructiveHint': False}}]}
        elif method == 'tools/call':
            args = req.get('params', {}).get('arguments', {})
            ok = req.get('params', {}).get('name') == 'version_check' and args.get('reference_nonce') == nonce
            record = {'version': version, 'nonceMatch': ok, 'tool': req.get('params', {}).get('name')}
            with open(log, 'a') as out:
                out.write(json.dumps(record) + '\n')
            result = {'content': [{'type': 'text', 'text': json.dumps(record)}], 'isError': not ok}
        elif method == 'ping':
            result = {}
        else:
            print(json.dumps({'jsonrpc': '2.0', 'id': ident, 'error': {'code': -32601, 'message': 'Unsupported'}}), flush=True)
            continue
        print(json.dumps({'jsonrpc': '2.0', 'id': ident, 'result': result}), flush=True)


def prepare():
    ART.mkdir(parents=True, exist_ok=True)
    state_path = ART / 'fixtures.json'
    if state_path.exists():
        return json.loads(state_path.read_text())
    fixtures = {'sessions': {}, 'packages': {}}
    for name in ['project-a', 'project-b', 'native-state']:
        (ART / name).mkdir(parents=True, exist_ok=True)
    for version in ['1.0.0', '1.1.0']:
        plugin = ART / 'packages' / version / 'plugin'
        skill = plugin / 'skills' / 'version-check'
        (skill / 'references').mkdir(parents=True)
        nonce = uuid.uuid4().hex
        write_json(plugin / '.claude-plugin/plugin.json', {'name': 'wy-preflight', 'version': version,
                   'description': 'Synthetic WillYou preflight fixture'})
        (skill / 'SKILL.md').write_text('---\nname: version-check\ndescription: Run the WillYou synthetic version check.\n---\n\n'
            'For this check, use Read to open the absolute reference path below, then call '
            'mcp__wy_probe__version_check with reference_nonce from that file. '
            'Report its version and nonceMatch. Do not inspect unrelated files or run shell commands.\n\n'
            f'Reference: {skill / "references/check.json"}\n')
        write_json(skill / 'references/check.json', {'reference_nonce': nonce, 'package_version': version})
        fixtures['packages'][version] = {'plugin': str(plugin), 'nonce': nonce}
    for name, version in [('old', '1.0.0'), ('new', '1.1.0')]:
        fixtures['sessions'][name] = {'id': str(uuid.uuid4()), 'version': version}
    write_json(state_path, fixtures)
    return fixtures


def apply_cdsh(env):
    """Read only the explicitly requested profile; never print or persist values."""
    config = Path('/Users/liubu/.zshrc').read_text()
    branch = re.search(r'^\s*"deepseek"\|"dsh"\)\s*\n(.*?);;', config, re.M | re.S)
    if not branch:
        raise RuntimeError('cdsh deepseek profile branch not found')
    for key in list(env):
        if key.startswith('ANTHROPIC_') or key in ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_SUBAGENT_MODEL',
                'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
                'CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'API_TIMEOUT_MS']:
            env.pop(key, None)
    for line in branch.group(1).splitlines():
        match = re.match(r'\s*export\s+([A-Z_]+)=(.*)$', line)
        if not match:
            continue
        key, literal = match.groups()
        if not key.startswith(('ANTHROPIC_', 'CLAUDE_CODE_')) and key != 'API_TIMEOUT_MS':
            continue
        if '$' in literal or '`' in literal:
            raise RuntimeError('Dynamic profile value requires explicit adaptation')
        values = shlex.split(literal, comments=True)
        if len(values) == 1:
            env[key] = values[0]
    if not env.get('ANTHROPIC_AUTH_TOKEN') or not env.get('ANTHROPIC_MODEL'):
        raise RuntimeError('Requested profile lacks auth/model')


def run_one(name, resume=False, profile='inherited'):
    fixtures = prepare()
    if not resume:
        fixtures['sessions'][name]['id'] = str(uuid.uuid4())
        write_json(ART / 'fixtures.json', fixtures)
    item = fixtures['sessions'][name]
    version = item['version']
    package = fixtures['packages'][version]
    run_name = name + ('-resume' if resume else '-new') + ('-cdsh' if profile == 'cdsh' else '')
    tool_log = ART / (run_name + '-tools.jsonl')
    # Each probe attempt has its own protocol log; native identity remains stable.
    tool_log.write_text('')
    config = ART / (run_name + '-mcp.json')
    write_json(config, {'mcpServers': {'wy_probe': {'command': sys.executable,
               'args': [str(SCRIPT), 'bridge', version, package['nonce'], str(tool_log)]}}})
    env = {**os.environ, 'CLAUDE_CONFIG_DIR': str(ART / 'native-state'),
           'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_AUTOUPDATER': '1',
           'CLAUDE_CODE_MAX_RETRIES': '0'}
    # Avoid confusing parent-host nesting flags; no credential values are printed.
    env.pop('CLAUDECODE', None)
    if profile == 'cdsh':
        apply_cdsh(env)
        env['CLAUDE_CODE_MAX_RETRIES'] = '0'
        env['API_TIMEOUT_MS'] = '60000'
    settings = {'disableAllHooks': True, 'autoUpdatesChannel': 'stable'}
    args = ['/Users/liubu/.local/bin/claude', '--setting-sources', '',
            '--settings', json.dumps(settings), '--plugin-dir', package['plugin'],
            '--strict-mcp-config', '--mcp-config', str(config), '--tools', 'Skill,Read',
            '--allowedTools', 'Skill', 'Read', 'mcp__wy_probe__version_check',
            '--permission-mode', 'dontAsk', '--max-turns', '7', '--max-budget-usd', '1.00',
            '--output-format', 'stream-json', '--verbose', '--print']
    model_settings = Path('/Users/liubu/.claude/settings.json')
    if profile == 'cdsh':
        args += ['--model', env['ANTHROPIC_MODEL']]
    else:
        args += ['--bare']
    if profile != 'cdsh' and model_settings.exists():
        model = json.loads(model_settings.read_text()).get('model')
        if model:
            args += ['--model', model]
    args += ['--resume' if resume else '--session-id', item['id']]
    prompt = ('Run /wy-preflight:version-check. Use its Skill instructions, explicitly read its reference file, '
              'and call its MCP version_check tool exactly once. Return the tool result. '
              'Only use this synthetic fixture. Do not read credentials, other project files, or run Bash.')
    if resume:
        prompt = ('Continue this same session. Run /wy-preflight:version-check again; explicitly Read the '
                  'reference file again and invoke the MCP version_check tool exactly once. '
                  'Do not rely only on the previous answer. Return its result.')
    args += ['--', prompt]
    raw = ART / (run_name + '.jsonl')
    err = ART / (run_name + '.stderr')
    started_at = datetime.now(timezone.utc).isoformat()
    with raw.open('w') as stdout, err.open('w') as stderr:
        process = subprocess.Popen(args, cwd=ART / 'project-a', env=env, stdin=subprocess.DEVNULL,
                                   stdout=stdout, stderr=stderr, start_new_session=True)
        timed_out = False
        try:
            code = process.wait(timeout=75)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGTERM)
            try:
                code = process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                code = process.wait()
    events = []
    for line in raw.read_text().splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            pass
    init = next((e for e in events if e.get('type') == 'system' and e.get('subtype') == 'init'), {})
    uses = [c for e in events for c in e.get('message', {}).get('content', [])
            if isinstance(c, dict) and c.get('type') == 'tool_use']
    calls = [json.loads(l) for l in tool_log.read_text().splitlines()]
    report = {'case': run_name, 'profile': profile, 'model': env.get('ANTHROPIC_MODEL') if profile == 'cdsh' else 'existing-default',
              'startedAt': started_at, 'endedAt': datetime.now(timezone.utc).isoformat(),
              'probeSha256': hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
              'cliVersion': subprocess.check_output([args[0], '--version'], text=True).strip(),
              'exitCode': code, 'timedOut': timed_out, 'expectedVersion': version,
              'sessionIdentityMatches': init.get('session_id') == item['id'],
              'discoveredSkill': any('version-check' in x for x in init.get('skills', []) + init.get('slash_commands', [])),
              'userFixtureSkillPreserved': any('wy-user-owned' in x for x in init.get('skills', []) + init.get('slash_commands', [])),
              'skillToolUsed': any(c.get('name') == 'Skill' for c in uses),
              'referenceRead': any(c.get('name') == 'Read' and c.get('input', {}).get('file_path', '').endswith('/references/check.json') for c in uses),
              'mcpCalls': calls, 'toolNames': [c.get('name') for c in uses],
              'nativeStateIsolated': True, 'defaultHomeUnchanged': env.get('HOME') == os.environ.get('HOME'),
              'limitations': ['CLAUDE_CONFIG_DIR isolated; default native root/user-skill preservation not established.',
                              'Synthetic package/tool; not WillYou production acceptance.']}
    report['passed'] = code == 0 and report['sessionIdentityMatches'] and report['discoveredSkill'] and report['referenceRead'] and len(calls) == 1 and calls[0]['nonceMatch']
    result = next((e for e in reversed(events) if e.get('type') == 'result'), {})
    report['resultSubtype'] = result.get('subtype')
    report['resultIsError'] = result.get('is_error', False)
    report['authenticationError'] = any(e.get('error') == 'authentication_failed' for e in events)
    report['passed'] = report['passed'] and not report['resultIsError']
    report['errorCount'] = len(result.get('errors', []))
    write_json(ART / (run_name + '-result.json'), report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'bridge':
        bridge()
    else:
        parser = argparse.ArgumentParser()
        parser.add_argument('name', choices=['old', 'new', 'prepare'])
        parser.add_argument('--resume', action='store_true')
        parser.add_argument('--profile', choices=['inherited', 'cdsh'], default='inherited')
        opts = parser.parse_args()
        if opts.name == 'prepare':
            prepare()
            print('Prepared two synthetic Skill versions; no Agent launched.')
        else:
            run_one(opts.name, opts.resume, opts.profile)
