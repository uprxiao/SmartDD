# 补验 D · R2：登录检测与环境变量冲突（隔离目录、断网、诱饵值；不读取、不改动用户真实登录）
import os, json, subprocess, tempfile, time, shutil, re, sys
root = tempfile.mkdtemp(prefix='m13-r2-', dir=os.environ.get('TMPDIR', '/tmp'))
OFF = {'HTTPS_PROXY': 'http://127.0.0.1:1', 'HTTP_PROXY': 'http://127.0.0.1:1', 'ALL_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': '127.0.0.1,localhost', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}
BASE = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'TMPDIR': os.environ.get('TMPDIR', '/tmp'), **OFF}
DECOY = 'decoy-r2-0000000000'
def run(cmd, env, stdin=None, timeout=60):
    t = time.time(); p = subprocess.run(cmd, env=env, input=stdin, capture_output=True, text=True, timeout=timeout)
    red = lambda s: s.replace(DECOY, '<DECOY>')
    return {'cmd': ' '.join(cmd), 'exit': p.returncode, 'ms': round((time.time() - t) * 1000), 'stdout': red(p.stdout.strip())[:1500], 'stderr': red(p.stderr.strip())[-600:]}
out = {'claudeVersion': subprocess.run(['claude', '--version'], capture_output=True, text=True).stdout.strip(), 'codexVersion': subprocess.run(['codex', '--version'], capture_output=True, text=True).stdout.strip(), 'claude': {}, 'codex': {}}
# ---- Claude Code：每个场景一个全新的 CLAUDE_CONFIG_DIR
def cdir(name, settings=None):
    d = os.path.join(root, 'cc-' + name); os.makedirs(d)
    if settings: json.dump(settings, open(os.path.join(d, 'settings.json'), 'w'))
    return d
cases = [
    ('none', {}, None),
    ('ANTHROPIC_API_KEY', {'ANTHROPIC_API_KEY': DECOY}, None),
    ('ANTHROPIC_AUTH_TOKEN', {'ANTHROPIC_AUTH_TOKEN': DECOY}, None),
    ('CLAUDE_CODE_OAUTH_TOKEN', {'CLAUDE_CODE_OAUTH_TOKEN': DECOY}, None),
    ('apiKeyHelper', {}, {'apiKeyHelper': 'echo ' + DECOY}),
    ('API_KEY+BASE_URL', {'ANTHROPIC_API_KEY': DECOY, 'ANTHROPIC_BASE_URL': 'http://127.0.0.1:9'}, None),
    ('settings.env.API_KEY', {}, {'env': {'ANTHROPIC_API_KEY': DECOY}}),
]
for name, extra, settings in cases:
    env = {**BASE, 'CLAUDE_CONFIG_DIR': cdir(name, settings), **extra}
    r = run(['claude', 'auth', 'status'], env)
    try: r['json'] = json.loads(r['stdout'])
    except Exception: pass
    r['text'] = run(['claude', 'auth', 'status', '--text'], env)['stdout']
    out['claude'][name] = r
# ---- Codex：每个场景一个全新的 CODEX_HOME
def xdir(name):
    d = os.path.join(root, 'cx-' + name); os.makedirs(d); return d
x = {}
env = {**BASE, 'CODEX_HOME': xdir('none')}; x['none'] = run(['codex', 'login', 'status'], env)
env = {**BASE, 'CODEX_HOME': xdir('OPENAI_API_KEY'), 'OPENAI_API_KEY': DECOY}; x['OPENAI_API_KEY_env'] = run(['codex', 'login', 'status'], env)
env = {**BASE, 'CODEX_HOME': xdir('CODEX_API_KEY'), 'CODEX_API_KEY': DECOY}; x['CODEX_API_KEY_env'] = run(['codex', 'login', 'status'], env)
h = xdir('with-api-key'); env = {**BASE, 'CODEX_HOME': h}
x['login_with_api_key'] = run(['codex', 'login', '--with-api-key'], env, stdin=DECOY + '\n')
x['after_api_key_login'] = run(['codex', 'login', 'status'], env)
x['auth_json_keys'] = sorted(json.load(open(os.path.join(h, 'auth.json'))).keys()) if os.path.exists(os.path.join(h, 'auth.json')) else None
try: x['auth_json_mode'] = json.load(open(os.path.join(h, 'auth.json'))).get('auth_mode')
except Exception: pass
env2 = {**env, 'OPENAI_API_KEY': 'decoy-other-1111'}; x['api_key_login+OPENAI_API_KEY_env'] = run(['codex', 'login', 'status'], env2)
out['codex'] = x
shutil.rmtree(root, ignore_errors=True)
print(json.dumps(out, ensure_ascii=False, indent=1))
