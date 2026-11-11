# 补验 E · E6：Codex 0.167.1 接第三方（模拟）供应商时各权限组合的实际行为（隔离 CODEX_HOME、零费用、结果可重复）。
# 模拟模型依次请求：①项目内写 ②项目外写（默认沙箱）③项目外写（require_escalated）④联网（require_escalated）⑤联网（默认沙箱），然后结束。
# 自动审查请求按输入中的“>>> APPROVAL REQUEST START”识别（attempt1 按工具识别有误），按 GUARDIAN 回应：allow / deny / error（500）/ invalid（非 JSON）；其余为主线程。
# 用法：python3 -I e6-run.py <输出目录> <项目外根目录> <组合名,...>
import os, sys, json, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mockresp import start
out = sys.argv[1]; outside_root = sys.argv[2]; names = sys.argv[3].split(',')
GUARD = os.environ.get('GUARDIAN', 'allow')
COMBOS = {
    'workspace-write': ['-s', 'workspace-write'],
    'approve-for-me': ['--approve-for-me'],
    'danger-full-access': ['-s', 'danger-full-access'],
    'bypass': ['--dangerously-bypass-approvals-and-sandbox'],
    'read-only': ['-s', 'read-only'],
}
results = {}
for name in names:
    tag = name + '-guardian-' + GUARD
    home = os.path.join(out, 'home-' + tag); proj = os.path.realpath(os.path.join(out, 'proj-' + tag)); outside = os.path.join(outside_root, 'e6-' + tag)
    for d in (home, proj, outside): os.makedirs(d, exist_ok=True)
    steps = [
        {'cmd': f'printf a > {proj}/in-cwd.txt && echo ok-in'},
        {'cmd': f'printf c > {outside}/outside-default.txt && echo ok-out'},
        {'cmd': f'printf c > {outside}/outside-escalated.txt && echo ok-out-esc', 'sandbox_permissions': 'require_escalated', 'justification': 'Write a test file outside the workspace?'},
        {'cmd': 'curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://example.com', 'sandbox_permissions': 'require_escalated', 'justification': 'Access example.com for a connectivity test?'},
        {'cmd': 'curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://example.com; echo " curl-exit=$?"'},
    ]
    raws = []
    def script(b, st, rec):
        raws.append({k: b.get(k) for k in ('model', 'instructions', 'input', 'tools') if k in b})
        texts = [c.get('text', '') for m in (b.get('input') or []) if isinstance(m, dict) for c in (m.get('content') or []) if isinstance(c, dict)]
        if any('>>> APPROVAL REQUEST START' in x for x in texts):
            rec['kind'] = 'guardian'
            return {'allow': ('text', '{"outcome":"allow"}'), 'deny': ('text', '{"risk_level":"high","user_authorization":"unknown","outcome":"deny","rationale":"mock deny"}'),
                    'error': ('error', 500), 'invalid': ('text', 'looks fine to me')}[GUARD]
        rec['kind'] = 'main'; k = rec['nOutputs']
        if k < len(steps): return ('call', 'exec_command', {**steps[k], 'yield_time_ms': 3000})
        return ('text', 'done')
    srv, port, st = start(script)
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'TMPDIR': os.environ.get('TMPDIR', '/tmp'), 'CODEX_HOME': home, 'MOCK_KEY': 'k'}
    prov = f'model_providers.mock={{name="mock",base_url="http://127.0.0.1:{port}/v1",wire_api="responses",env_key="MOCK_KEY"}}'
    args = ['codex', 'exec', '--skip-git-repo-check', '--json', '-C', proj, '-c', 'model_provider="mock"', '-c', prov, '-m', 'mock-model', '-c', 'check_for_update_on_startup=false', *COMBOS[name], 'run the steps']
    t = time.time(); r = subprocess.run(args, env=env, capture_output=True, text=True, timeout=240, stdin=subprocess.DEVNULL)
    srv.shutdown()
    evs = []
    for l in r.stdout.splitlines():
        try: evs.append(json.loads(l))
        except Exception: pass
    cmds = [{'cmd': e['item'].get('command', '')[-90:], 'exit': e['item'].get('exit_code'), 'status': e['item'].get('status'), 'out': (e['item'].get('aggregated_output') or '')[:160]} for e in evs if e.get('type') == 'item.completed' and (e.get('item') or {}).get('type') == 'command_execution']
    results[tag] = {'args': args[:4] + ['…mock provider…'] + COMBOS[name], 'exit': r.returncode, 'sec': round(time.time() - t, 1),
                    'files': {'inCwd': os.path.exists(f'{proj}/in-cwd.txt'), 'outsideDefault': os.path.exists(f'{outside}/outside-default.txt'), 'outsideEscalated': os.path.exists(f'{outside}/outside-escalated.txt')},
                    'commands': cmds, 'functionOutputs': [q.get('lastOutput') for q in st['reqs'] if q.get('kind') == 'main' and q.get('lastOutput')],
                    'requests': [{k: q.get(k) for k in ('kind', 'tools', 'nOutputs', 'reply', 'instrHead')} for q in st['reqs']],
                    'stderrTail': r.stderr.strip()[-500:]}
    json.dump(raws, open(os.path.join(out, f'raw-{tag}.json'), 'w'), ensure_ascii=False, indent=1)
    print(tag, json.dumps(results[tag]['files']), 'exit', r.returncode, 'reqs', [q.get('kind') for q in st['reqs']], file=sys.stderr)
    json.dump(results[tag], open(os.path.join(out, f'e6-result-{tag}.json'), 'w'), ensure_ascii=False, indent=1)
