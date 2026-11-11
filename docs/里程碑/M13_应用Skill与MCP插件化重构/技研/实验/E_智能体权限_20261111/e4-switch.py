# 补验 E · E4：会话中切换权限的入口（不发模型请求）。
# Claude Code：隔离配置目录、断网，启动后按 Shift+Tab 若干次，记录底部模式提示；分别不带与带 --allow-dangerously-skip-permissions。
# Codex：默认 CODEX_HOME，启动后输入 /permissions 回车，记录菜单，再 Esc、Ctrl-C；不选择任何项，前后比对 ~/.codex 哈希。
# 用法：python3 -I e4-switch.py <输出目录>
import os, pty, time, select, re, sys, json, hashlib, fcntl, termios, struct
out_dir = sys.argv[1]; os.makedirs(out_dir, exist_ok=True)
strip = lambda b: re.sub(r'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?', '', b.decode('utf8', 'replace'))
def run(args, env, cwd, actions):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd); os.execvpe(args[0], args, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
    buf = [b'']; snaps = []
    def pump(sec):
        end = time.time() + sec
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.1)
            if r:
                try: c = os.read(fd, 65536)
                except OSError: return
                if not c: return
                buf[0] += c
    pump(6)
    for label, data, wait in actions:
        mark = len(buf[0]); os.write(fd, data); pump(wait)
        snaps.append({'after': label, 'text': strip(buf[0][mark:])[-1500:]})
    for _ in range(3):
        try: os.write(fd, b'\x03'); pump(0.8)
        except OSError: break
    try: os.kill(pid, 9)
    except Exception: pass
    return snaps, strip(buf[0])
res = {}
# Claude Code
for case, extra in (() if os.environ.get('ONLY') == 'codex' else (('claude', []), ('claude-allow-bypass', ['--allow-dangerously-skip-permissions']))):
    cfg = os.path.join(out_dir, 'cfg-' + case); proj = os.path.realpath(os.path.join(out_dir, 'proj-' + case)); os.makedirs(cfg, exist_ok=True); os.makedirs(proj, exist_ok=True)
    json.dump({'hasCompletedOnboarding': True, 'theme': 'dark', 'lastOnboardingVersion': '2.1.322', 'projects': {proj: {'hasTrustDialogAccepted': True, 'hasCompletedProjectOnboarding': True}}}, open(os.path.join(cfg, '.claude.json'), 'w'))
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'CLAUDE_CONFIG_DIR': cfg, 'TERM': 'xterm-256color', 'ANTHROPIC_BASE_URL': 'http://127.0.0.1:9', 'ANTHROPIC_AUTH_TOKEN': 'tok',
           'HTTPS_PROXY': 'http://127.0.0.1:1', 'HTTP_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': '127.0.0.1,localhost', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_AUTOUPDATER': '1'}
    snaps, full = run(['claude', '--setting-sources', 'user', '--strict-mcp-config', '--permission-mode', 'default', *extra], env, proj, [(f'Shift+Tab #{i}', b'\x1b[Z', 1.5) for i in range(1, 7)])
    modes = [sorted(set(re.findall(r'(?i)(accept edits on|plan mode on|auto mode on|bypass permissions on|don.t ask on|manual mode on|default mode)', s['text']))) for s in snaps]
    res[case] = {'args': ['claude', '--permission-mode', 'default', *extra], 'cycle': [{'after': s['after'], 'modes': m} for s, m in zip(snaps, modes)]}
    open(os.path.join(out_dir, f'e4-{case}.txt'), 'w').write(full)
# Codex
h = lambda f: hashlib.sha256(open(f, 'rb').read()).hexdigest()[:16] if os.path.exists(f) else None
cx = os.path.join(os.environ['HOME'], '.codex'); before = {k: h(os.path.join(cx, k)) for k in ('config.toml', 'auth.json')}
proj = os.path.realpath(os.path.join(out_dir, 'proj-codex')); os.makedirs(proj, exist_ok=True)
env = {**{k: os.environ[k] for k in ('PATH', 'HOME', 'TMPDIR') if k in os.environ}, 'TERM': 'xterm-256color'}
snaps, full = run(['codex', '-C', proj, '--no-alt-screen', '-c', 'check_for_update_on_startup=false', '-c', f'projects."{proj}".trust_level="trusted"', '-s', 'workspace-write', '-a', 'on-request'], env, proj,
                  [('wait', b'', 4), ('type /permissions', b'/permissions', 1.5), ('Enter', b'\r', 2.5), ('Esc', b'\x1b', 1)])
after = {k: h(os.path.join(cx, k)) for k in ('config.toml', 'auth.json')}
res['codex'] = {'snaps': snaps, 'globalUnchanged': before == after}
open(os.path.join(out_dir, 'e4-codex.txt'), 'w').write(full)
json.dump(res, open(os.path.join(out_dir, 'e4-result' + ('-codex' if os.environ.get('ONLY') == 'codex' else '') + '.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: (v.get('cycle') if 'cycle' in v else v['globalUnchanged']) for k, v in res.items()}, ensure_ascii=False))
