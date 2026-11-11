# 发现 Codex 发给供应商的工具定义（隔离 CODEX_HOME、模拟供应商只回文本）
import os, sys, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mockresp import start
out = sys.argv[1]; home = os.path.join(out, 'codex-home'); proj = os.path.realpath(os.path.join(out, 'proj')); os.makedirs(home, exist_ok=True); os.makedirs(proj, exist_ok=True)
srv, port, st = start(lambda b, s, r: ('text', 'ok'))
env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'TMPDIR': os.environ.get('TMPDIR', '/tmp'), 'CODEX_HOME': home, 'MOCK_KEY': 'k'}
prov = f'model_providers.mock={{name="mock",base_url="http://127.0.0.1:{port}/v1",wire_api="responses",env_key="MOCK_KEY"}}'
r = subprocess.run(['codex', 'exec', '--skip-git-repo-check', '--json', '-C', proj, '-c', 'model_provider="mock"', '-c', prov, '-m', 'mock-model', '-c', 'check_for_update_on_startup=false', 'hi'], env=env, capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
print('exit', r.returncode, r.stderr[-400:])
print(json.dumps(st['reqs'], ensure_ascii=False)[:1500])
json.dump(st['raw_first'], open(os.path.join(out, 'first-request.json'), 'w'), ensure_ascii=False, indent=1)
tools = (st['raw_first'] or {}).get('tools') or []
for t in tools:
    print('TOOL', t.get('type'), t.get('name'), json.dumps(t.get('parameters', {}).get('properties', {}) if isinstance(t.get('parameters'), dict) else '')[:600])
