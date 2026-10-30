#!/usr/bin/env python3
"""One bounded mixed-agent experiment: CC v1 and Codex v2, synthetic data only.

No default-root writes. The cdsh profile is read via the already-reviewed helper;
credentials stay in child environment. Codex uses a 0600 disposable auth copy,
with refresh token removed. Both processes are ready before either turn starts.
"""
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid

SELF = Path(__file__).resolve()


def bridge():
    name, version, nonce, log = sys.argv[2:6]
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        ident, method = req.get('id'), req.get('method')
        if ident is None:
            continue
        result = {}
        if method == 'initialize':
            result = {'protocolVersion': req['params']['protocolVersion'], 'capabilities': {'tools': {}},
                      'serverInfo': {'name': name, 'version': version}}
        elif method == 'tools/list':
            result = {'tools': [{'name': name, 'description': 'Read-only synthetic version and nonce verification.',
                       'inputSchema': {'type': 'object', 'properties': {'reference_nonce': {'type': 'string'}},
                                       'required': ['reference_nonce'], 'additionalProperties': False},
                       'annotations': {'readOnlyHint': True, 'destructiveHint': False,
                                       'idempotentHint': True, 'openWorldHint': False}}]}
        elif method == 'tools/call':
            record = {'tool': req['params']['name'], 'version': version,
                      'nonceMatch': req['params'].get('arguments', {}).get('reference_nonce') == nonce}
            with open(log, 'a') as stream:
                stream.write(json.dumps(record) + '\n')
            result = {'content': [{'type': 'text', 'text': json.dumps(record)}], 'isError': not record['nonceMatch']}
        print(json.dumps({'jsonrpc': '2.0', 'id': ident, 'result': result}), flush=True)


class Proc:
    def __init__(self, name, args, cwd, env):
        self.name, self.events, self.errors, self.methods = name, [], [], []
        self.p = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, bufsize=1, start_new_session=True)
        threading.Thread(target=self.reader, daemon=True).start()
        threading.Thread(target=self.errreader, daemon=True).start()

    def reader(self):
        for line in self.p.stdout:
            try:
                self.events.append(json.loads(line))
            except ValueError:
                pass

    def errreader(self):
        self.errors.extend(self.p.stderr.readlines())

    def send(self, value):
        self.p.stdin.write(json.dumps(value) + '\n')
        self.p.stdin.flush()

    def until(self, predicate, seconds=15):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            found = next((e for e in self.events if predicate(e)), None)
            if found is not None:
                return found
            if self.p.poll() is not None:
                raise RuntimeError(self.name + ' exited before expected protocol reply')
            time.sleep(0.025)
        raise TimeoutError(self.name + ' protocol reply timed out')

    def rpc(self, method, params):
        ident = len(self.methods) + 1
        self.methods.append(method)
        self.send({'id': ident, 'method': method, 'params': params})
        found = self.until(lambda e: e.get('id') == ident and not e.get('method'))
        if found.get('error'):
            raise RuntimeError(json.dumps(found['error']))
        return found['result']

    def control(self, subtype):
        ident = str(uuid.uuid4())
        self.methods.append(subtype)
        self.send({'type': 'control_request', 'request_id': ident, 'request': {'subtype': subtype}})
        return self.until(lambda e: e.get('type') == 'control_response' and
                          e.get('response', {}).get('request_id') == ident)['response']

    def close(self):
        if self.p.poll() is None:
            os.killpg(self.p.pid, signal.SIGTERM)
            try:
                self.p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(self.p.pid, signal.SIGKILL)
                self.p.wait()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    root = Path(tempfile.mkdtemp(prefix='m10-real-mixed-', dir='/private/tmp'))
    home, cwd = root / 'home', root / 'project'
    ch, ah = home / '.codex', home / '.claude'
    for p in [ch, ah, cwd / '.git']:
        p.mkdir(parents=True)
    report = {'schema': 'm10-real-mixed-preflight-v1', 'startedAt': datetime.now(timezone.utc).isoformat(),
              'environment': {'codex': subprocess.check_output(['codex', '--version'], text=True).strip(),
                              'claude': subprocess.check_output(['claude', '--version'], text=True).strip()},
              'isolation': {'sharedSyntheticHome': True, 'defaultRootsModified': False,
                            'userChatRead': False, 'cdshStaticProfileOnly': True,
                            'temporaryCodexAuth0600': True, 'codexRefreshTokenRemoved': True,
                            'maximumUserTurns': 2, 'turnDeadlineSeconds': 75, 'resumeTested': False},
              'cases': [], 'limitations': ['Synthetic HOME/config/skills/tools only; not production user-config compatibility.',
                                         'Two native harnesses with real providers, not packaged WillYou/TUI or business acceptance.']}
    procs = []
    auth_path = Path('/Users/liubu/.codex/auth.json')
    auth_hash = digest(auth_path)
    profile_helper = SELF.parent.parent / 'claude/probe.py'
    try:
        nonces = {v: uuid.uuid4().hex for v in ['v1', 'v2']}
        paths = {}
        for v in ['v1', 'v2']:
            path = home / '.agents/skills' / ('willyou-mixed-' + v) / 'SKILL.md'
            path.parent.mkdir(parents=True)
            path.write_text('---\nname: willyou-mixed-' + v + '\ndescription: Synthetic mixed-agent check.\n---\n\n'
                            'Call the m10_mixed app_version tool exactly once with reference_nonce=' + nonces[v] +
                            '. Return its result. Do not use other tools.\n')
            paths[v] = path
        for base, name in [(home / '.agents/skills', 'user-shared-fixture'), (ah / 'skills', 'user-cc-fixture')]:
            path = base / name / 'SKILL.md'
            path.parent.mkdir(parents=True)
            path.write_text('---\nname: ' + name + '\ndescription: User-owned synthetic skill.\n---\nMarker only.\n')
        plugin = root / 'packages/v1/plugin'
        (plugin / '.claude-plugin').mkdir(parents=True)
        (plugin / '.claude-plugin/plugin.json').write_text(json.dumps({'name': 'willyou-mixed', 'version': '1.0.0'}))
        cskill = plugin / 'skills/check'
        (cskill / 'references').mkdir(parents=True)
        reference = cskill / 'references/nonce.json'
        reference.write_text(json.dumps({'reference_nonce': nonces['v1'], 'version': 'v1'}))
        (cskill / 'SKILL.md').write_text('---\nname: check\ndescription: Run the synthetic mixed-agent check.\n---\n\n'
                                       'Use Read to open ' + str(reference) + '. Then call mcp__m10_mixed__app_version '
                                       'exactly once with reference_nonce from that file. Return the result. '
                                       'Do not inspect unrelated files or use other tools.\n')
        logs = {n: root / (n + '.jsonl') for n in ['codex', 'claude', 'user']}
        def mcp(name, version, nonce, log):
            return {'command': sys.executable, 'args': [str(SELF), '--bridge', name, version, nonce, str(log)]}
        user = mcp('user_marker', 'user', 'user-synthetic', logs['user'])
        (ah / '.claude.json').write_text(json.dumps({'mcpServers': {'user_cc_mcp': user}, 'hasCompletedOnboarding': True}))
        (ah / 'settings.json').write_text(json.dumps({'disableAllHooks': True}))
        (ch / 'config.toml').write_text('[mcp_servers.user_codex_mcp]\ncommand = ' + json.dumps(sys.executable) +
                                       '\nargs = ' + json.dumps(user['args']) + '\n')
        cc_mcp = root / 'managed-cc.json'
        cc_mcp.write_text(json.dumps({'mcpServers': {'m10_mixed': mcp('app_version', 'v1', nonces['v1'], logs['claude'])}}))
        auth = json.loads(auth_path.read_text())
        auth['tokens']['refresh_token'] = ''
        (ch / 'auth.json').write_text(json.dumps(auth))
        (ch / 'auth.json').chmod(0o600)
        base = {'PATH': os.environ['PATH'], 'HOME': str(home), 'CODEX_HOME': str(ch), 'CLAUDE_CONFIG_DIR': str(ah)}
        codex_mcp = mcp('app_version', 'v2', nonces['v2'], logs['codex'])
        args = ['codex', '--disable', 'apps', '--disable', 'remote_plugin', '--disable', 'multi_agent', '--disable', 'shell_tool',
                '--disable', 'shell_snapshot', '-c', 'model="gpt-6.1-sol"', '-c', 'model_reasoning_effort="low"',
                '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false', '-c', 'web_search="disabled"',
                '-c', 'skills.config=[{path=' + json.dumps(str(paths['v1'])) + ',enabled=false},{path=' +
                json.dumps(str(paths['v2'])) + ',enabled=true}]', '-c',
                'mcp_servers.m10_mixed={command=' + json.dumps(codex_mcp['command']) + ',args=' +
                json.dumps(codex_mcp['args']) + '}', 'app-server', '--stdio']
        codex = Proc('codex-v2', args, cwd, base)
        procs.append(codex)
        codex.rpc('initialize', {'clientInfo': {'name': 'm10_mixed_real', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
        codex.send({'method': 'initialized'})
        sd = codex.rpc('skills/list', {'cwds': [str(cwd)], 'forceReload': True})
        cs = codex.rpc('mcpServerStatus/list', {})
        cc_env = dict(base, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1', DISABLE_AUTOUPDATER='1', CLAUDE_CODE_MAX_RETRIES='0', API_TIMEOUT_MS='60000')
        spec = importlib.util.spec_from_file_location('m10_existing_profile_helper', profile_helper)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.apply_cdsh(cc_env)
        cc_env['CLAUDE_CODE_MAX_RETRIES'] = '0'
        cc_env['API_TIMEOUT_MS'] = '60000'
        report['environment']['claudeProfile'] = 'cdsh'
        report['environment']['claudeModel'] = cc_env['ANTHROPIC_MODEL']
        cc_args = ['claude', '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
                   '--no-session-persistence', '--plugin-dir', str(plugin), '--mcp-config', str(cc_mcp),
                   '--settings', json.dumps({'disableAllHooks': True}), '--tools', 'Skill,Read', '--allowedTools',
                   'Skill', 'Read', 'mcp__m10_mixed__app_version', '--permission-mode', 'dontAsk', '--max-turns', '6',
                   '--max-budget-usd', '1.00', '--model', cc_env['ANTHROPIC_MODEL']]
        claude = Proc('claude-v1', cc_args, cwd, cc_env)
        procs.append(claude)
        ci = claude.control('initialize')
        cm = claude.control('mcp_status')
        report['discovery'] = {
            'codexSkills': [{'name': x['name'], 'enabled': x['enabled']} for row in sd['data'] for x in row['skills'] if 'fixture' in x['name'] or 'willyou-' in x['name']],
            'codexMcpNames': [x['name'] for x in cs['data']],
            'claudeCommands': [x['name'] for x in ci.get('response', {}).get('commands', [])],
            'claudeMcp': [{'name': x['name'], 'status': x['status']} for x in cm.get('response', {}).get('mcpServers', [])],
            'bothProcessesReadyAndAlive': all(p.p.poll() is None for p in procs)}
        thread = codex.rpc('thread/start', {'cwd': str(cwd), 'ephemeral': True, 'sandbox': 'read-only', 'approvalPolicy': 'never'})
        thread_id = thread['thread']['id']
        # Begin both user turns only after both native clients have initialized.
        cturn = codex.rpc('turn/start', {'threadId': thread_id, 'effort': 'low', 'input': [
            {'type': 'text', 'text': 'Use the attached synthetic Skill. Call its single local app_version tool once with the nonce from the Skill. Return the result. Do not use other tools.'},
            {'type': 'skill', 'name': 'willyou-mixed-v2', 'path': str(paths['v2'])}]})
        claude.send({'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text':
                    'Run /willyou-mixed:check. Use Skill, explicitly Read its reference file, and call mcp__m10_mixed__app_version exactly once. Return the version and nonceMatch. Only use this synthetic fixture.'}]}})
        deadline = time.monotonic() + 75
        while time.monotonic() < deadline:
            co_done = next((e for e in codex.events if e.get('method') == 'turn/completed'), None)
            cc_done = next((e for e in claude.events if e.get('type') == 'result'), None)
            if co_done and cc_done:
                break
            time.sleep(0.05)
        else:
            report['deadlineReached'] = True
            if not co_done:
                try:
                    codex.rpc('turn/interrupt', {'threadId': thread_id, 'turnId': cturn['turn']['id']})
                except Exception:
                    pass
        calls = {name: [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else [] for name, p in logs.items()}
        co_items = [e['params']['item'] for e in codex.events if e.get('method') == 'item/completed']
        cc_uses = [x for e in claude.events for x in e.get('message', {}).get('content', []) if isinstance(x, dict) and x.get('type') == 'tool_use']
        co_ok = bool(co_done and co_done['params']['turn']['status'] == 'completed' and len(calls['codex']) == 1 and calls['codex'][0]['nonceMatch'])
        cc_ok = bool(cc_done and not cc_done.get('is_error') and any(x.get('name') == 'Skill' for x in cc_uses) and
                     any(x.get('name') == 'Read' and x.get('input', {}).get('file_path') == str(reference) for x in cc_uses) and
                     len(calls['claude']) == 1 and calls['claude'][0]['nonceMatch'])
        report['cases'] = [
            {'name': 'codex-v2-real-turn', 'status': 'passed' if co_ok else 'blocked', 'calls': calls['codex'],
             'turnStatus': co_done['params']['turn']['status'] if co_done else 'probe-timeout',
             'mcpEvents': [{'server': x.get('server'), 'tool': x.get('tool'), 'status': x.get('status')} for x in co_items if x.get('type') == 'mcpToolCall']},
            {'name': 'claude-v1-real-turn', 'status': 'passed' if cc_ok else 'blocked', 'calls': calls['claude'],
             'toolNames': [x.get('name') for x in cc_uses], 'referenceRead': any(x.get('name') == 'Read' and x.get('input', {}).get('file_path') == str(reference) for x in cc_uses),
             'resultSubtype': cc_done.get('subtype') if cc_done else 'probe-timeout', 'resultIsError': cc_done.get('is_error') if cc_done else None}]
        report['bothProcessesAliveAfterTurns'] = all(p.p.poll() is None for p in procs)
        report['userToolsNotCalled'] = not calls['user']
        report['status'] = 'passed-with-boundaries' if co_ok and cc_ok else 'partial'
    except Exception as err:
        report['status'], report['error'] = 'blocked', str(err)
    finally:
        for proc in procs:
            proc.close()
        report['processes'] = [{'name': p.name, 'methods': p.methods, 'stderrTail': ''.join(p.errors)[-2000:].replace(str(root), '<fixture>')} for p in procs]
        report['originalCodexAuthUnchanged'] = digest(auth_path) == auth_hash
        report['sourceHashes'] = {'real-mixed-probe.py': digest(SELF), '../claude/probe.py': digest(profile_helper)}
        shutil.rmtree(root)
        report['cleanup'] = {'temporaryRootRemoved': not root.exists(), 'allChildrenExited': all(p.p.poll() is not None for p in procs)}
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        path = SELF.with_name('real-mixed-result.json')
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2).replace(str(root), '<fixture>') + '\n')
        print(json.dumps({'status': report['status'], 'cases': report['cases'], 'output': str(path)}, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--bridge':
        bridge()
    else:
        main()
