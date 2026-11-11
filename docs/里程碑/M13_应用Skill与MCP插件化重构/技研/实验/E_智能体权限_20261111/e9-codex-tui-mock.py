# 补验 E · E9：Codex 交互界面接第三方（模拟）供应商时的权限表现（隔离 CODEX_HOME、零费用）。步骤与 E6 相同：
# ①项目内写 ②项目外写 ③项目外写（require_escalated）④联网（require_escalated）⑤直接联网。
# 自动审查请求按“>>> APPROVAL REQUEST START”识别，按 GUARDIAN 回应 allow / deny。出现给用户的批准框时按 ANSWER：esc（拒绝）或 yes（只批准这一次，按 Enter 选第一项）。
# 用法：GUARDIAN=allow ANSWER=esc python3 -I e9-codex-tui-mock.py <输出目录> <项目外根目录> <组合名,...>
import os, sys, json, time, pty, select, re, fcntl, termios, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mockresp import start
out = sys.argv[1]; outside_root = sys.argv[2]; names = sys.argv[3].split(',')
GUARD = os.environ.get('GUARDIAN', 'allow'); ANSWER = os.environ.get('ANSWER', 'esc')
COMBOS = {
    'approve-for-me': ['--approve-for-me'],
    'on-request-user': ['-s', 'workspace-write', '-a', 'on-request', '-c', 'approvals_reviewer="user"'],
    'read-only': ['-s', 'read-only'],
    'read-only-user': ['-s', 'read-only', '-a', 'on-request', '-c', 'approvals_reviewer="user"'],
}
strip = lambda b: re.sub(r'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?', '', b.decode('utf8', 'replace'))
APPROVAL = re.compile(r'Would you like to (run|make|allow)|Allow command|Yes, proceed|requires approval|Do you want to', re.I)
for name in names:
    tag = f'{name}-guardian-{GUARD}-answer-{ANSWER}'
    home = os.path.join(out, 'home-' + tag); proj = os.path.realpath(os.path.join(out, 'proj-' + tag)); outside = os.path.join(outside_root, 'e9-' + tag)
    for d in (home, proj, outside): os.makedirs(d, exist_ok=True)
    steps = [
        {'cmd': f'printf a > {proj}/in-cwd.txt && echo ok-in'},
        {'cmd': f'printf c > {outside}/outside-default.txt && echo ok-out'},
        {'cmd': f'printf c > {outside}/outside-escalated.txt && echo ok-out-esc', 'sandbox_permissions': 'require_escalated', 'justification': 'Write a test file outside the workspace?'},
        {'cmd': 'curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://example.com', 'sandbox_permissions': 'require_escalated', 'justification': 'Access example.com for a connectivity test?'},
        {'cmd': 'curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://example.com; echo " curl-exit=$?"'},
    ]
    def script(b, st, rec):
        texts = [c.get('text', '') for m in (b.get('input') or []) if isinstance(m, dict) for c in (m.get('content') or []) if isinstance(c, dict)]
        if any('>>> APPROVAL REQUEST START' in x for x in texts):
            rec['kind'] = 'guardian'
            return {'allow': ('text', '{"outcome":"allow"}'), 'deny': ('text', '{"risk_level":"high","user_authorization":"unknown","outcome":"deny","rationale":"mock deny"}')}[GUARD]
        if 'exec_command' not in (rec.get('tools') or []): rec['kind'] = 'side'; return ('text', 'ok')  # attempt2：TUI 另有不带 exec_command 的旁路请求
        rec['kind'] = 'main'; k = rec['nOutputs']
        if k < len(steps): return ('call', 'exec_command', {**steps[k], 'yield_time_ms': 3000})
        return ('text', 'all steps done')
    srv, port, st = start(script)
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'TMPDIR': os.environ.get('TMPDIR', '/tmp'), 'CODEX_HOME': home, 'MOCK_KEY': 'k', 'TERM': 'xterm-256color'}
    prov = f'model_providers.mock={{name="mock",base_url="http://127.0.0.1:{port}/v1",wire_api="responses",env_key="MOCK_KEY"}}'
    args = ['codex', '-C', proj, '--no-alt-screen', '-c', 'model_provider="mock"', '-c', prov, '-m', 'mock-model', '-c', 'check_for_update_on_startup=false',
            '-c', f'projects."{proj}".trust_level="trusted"', *COMBOS[name], 'run the steps']
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(proj); os.execvpe(args[0], args, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
    raw = [b'']; t0 = time.time(); events = []; mark = 0
    def pump(sec):
        end = time.time() + sec
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.1)
            if r:
                try: c = os.read(fd, 65536)
                except OSError: return False
                if not c: return False
                raw[0] += c
        return True
    done_at = None
    while time.time() - t0 < 120:
        if not pump(0.5): break
        full = strip(raw[0]); tail = full[mark:]
        ms = list(re.finditer(r'Press enter to confirm or esc to cancel', full))  # attempt3：按整屏批准框计数
        if len(ms) > len(events):
            m = ms[len(events)]; ex = ' '.join(full[max(0, m.start() - 600):m.end()].split())
            events.append({'t': round(time.time() - t0, 1), 'event': f'user approval prompt #{len(events) + 1} → {ANSWER}', 'excerpt': ex[-600:]})
            pump(0.6); os.write(fd, b'\r' if ANSWER == 'yes' else b'\x1b'); pump(1.5)
        if done_at is None and any(q.get('kind') == 'main' and q.get('reply', '').startswith('text') for q in st['reqs']): done_at = time.time()
        if done_at and time.time() - done_at > 3: break
        if not done_at and re.search(r'Worked for \d', tail[-2000:]) and time.time() - t0 > 15: pump(2); break
    for _ in range(2):
        try: os.write(fd, b'\x03'); pump(0.8)
        except OSError: break
    try: os.kill(pid, 9)
    except Exception: pass
    srv.shutdown(); text = strip(raw[0])
    keys = sorted(set(' '.join(m.group(0).split()) for m in re.finditer(r'(?i)(review[^\n]{0,100}|approved[^\n]{0,80}|denied[^\n]{0,80}|rejected[^\n]{0,80}|escalat[^\n]{0,80}|Would you like[^\n]{0,100})', text)))[:40]
    res = {'args': ['codex', '…mock provider…', *COMBOS[name]], 'sec': round(time.time() - t0, 1), 'events': events,
           'files': {'inCwd': os.path.exists(f'{proj}/in-cwd.txt'), 'outsideDefault': os.path.exists(f'{outside}/outside-default.txt'), 'outsideEscalated': os.path.exists(f'{outside}/outside-escalated.txt')},
           'functionOutputs': [q.get('lastOutput') for q in st['reqs'] if q.get('kind') == 'main' and q.get('lastOutput')],
           'requests': [{k: q.get(k) for k in ('kind', 'nOutputs', 'reply', 'tools')} for q in st['reqs'] if q.get('path', '').endswith('/responses')], 'keyLines': keys, 'tail': ' '.join(text.split())[-1500:]}
    open(os.path.join(out, f'e9-{tag}.txt'), 'w').write(text)
    json.dump(res, open(os.path.join(out, f'e9-result-{tag}.json'), 'w'), ensure_ascii=False, indent=1)
    print(tag, json.dumps(res['files']), [e['event'] for e in events], [q['kind'] for q in res['requests']], file=sys.stderr)
