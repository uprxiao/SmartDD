# 补验 E · E7：Claude Code 2.1.322 交互界面下各权限模式的实际表现（本机模拟 Anthropic 服务、隔离配置目录、断网代理；零费用）。
# 模拟模型依次请求：Write 项目内文件 → Write 项目外文件 → 文本结束。出现询问框时按 Esc 拒绝并记录。
# bypassPermissions：启动警告框选择 “Yes, I accept”，然后第二次启动同一配置目录，看警告是否再次出现。
# 用法：python3 -I e7-claude-tui.py <输出目录> <模式,...>
import os, pty, time, select, re, sys, json, threading, http.server, socketserver, fcntl, termios, struct
out_dir = sys.argv[1]; modes = sys.argv[2].split(','); os.makedirs(out_dir, exist_ok=True)
STATE = {'plan': [], 'reqs': []}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_HEAD(self): self.send_response(200); self.end_headers()
    def do_GET(self): self.send_response(404); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); b = json.loads(self.rfile.read(n) or b'{}')
        tools = [t.get('name') for t in (b.get('tools') or [])]
        results = [c for m in (b.get('messages') or []) if m.get('role') == 'user' and isinstance(m.get('content'), list) for c in m['content'] if c.get('type') == 'tool_result']
        if not self.path.startswith('/v1/messages') or 'count_tokens' in self.path:
            self.send_response(404); self.end_headers(); return
        sysv = b.get('system'); sys_head = (sysv if isinstance(sysv, str) else ' '.join(x.get('text', '') for x in (sysv or []) if isinstance(x, dict)))[:200]
        k = len(results); rec = {'toolResults': k, 'last': (str(results[-1].get('content'))[:140] if results else None), 'tools': len(tools), 'hasWrite': 'Write' in tools, 'sysHead': sys_head, 'path': self.path}
        if 'Write' in tools and k < len(STATE['plan']):
            name, inp = STATE['plan'][k]; rec['reply'] = 'tool_use ' + name
            blocks = [('content_block_start', {'index': 0, 'content_block': {'type': 'tool_use', 'id': f'toolu_{k}', 'name': name, 'input': {}}}),
                      ('content_block_delta', {'index': 0, 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(inp)}}), ('content_block_stop', {'index': 0})]; stop = 'tool_use'
        else:
            rec['reply'] = 'text'
            blocks = [('content_block_start', {'index': 0, 'content_block': {'type': 'text', 'text': ''}}), ('content_block_delta', {'index': 0, 'delta': {'type': 'text_delta', 'text': 'all done'}}), ('content_block_stop', {'index': 0})]; stop = 'end_turn'
        STATE['reqs'].append(rec)
        self.send_response(200); self.send_header('content-type', 'text/event-stream'); self.end_headers()
        m = {'id': 'msg', 'type': 'message', 'role': 'assistant', 'model': b.get('model'), 'content': [], 'stop_reason': None, 'usage': {'input_tokens': 1, 'output_tokens': 0}}
        for t, d in [('message_start', {'message': m}), *blocks, ('message_delta', {'delta': {'stop_reason': stop}, 'usage': {'output_tokens': 1}}), ('message_stop', {})]:
            self.wfile.write(f'event: {t}\ndata: {json.dumps({"type": t, **d})}\n\n'.encode()); self.wfile.flush()
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H); srv.daemon_threads = True; port = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()
strip = lambda b: re.sub(r'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?', '', b.decode('utf8', 'replace'))
ASK = re.compile(r'Do you want to (create|make this edit|proceed)|❯ ?1\. ?Yes', re.I)
WARN = re.compile(r'Bypass\s*Permissions\s*mode', re.I)

def session(mode, cfg, proj, outside, accept_warning, send_prompt=True):
    STATE['plan'] = [('Write', {'file_path': os.path.join(proj, 'in-cwd.txt'), 'content': 'a\n'}), ('Write', {'file_path': os.path.join(outside, 'outside.txt'), 'content': 'c\n'})]; STATE['reqs'] = []
    tiers = {k: 'm-default' for k in ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']}
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'TMPDIR': os.environ.get('TMPDIR', '/tmp'), 'CLAUDE_CONFIG_DIR': cfg, 'TERM': 'xterm-256color', 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{port}', 'ANTHROPIC_AUTH_TOKEN': 'tok',
           'HTTPS_PROXY': 'http://127.0.0.1:1', 'HTTP_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': '127.0.0.1,localhost', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_AUTOUPDATER': '1', 'CLAUDE_CODE_DISABLE_1M_CONTEXT': '1', **tiers}
    args = ['claude', '--setting-sources', 'user', '--strict-mcp-config', '--permission-mode', mode]
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(proj); os.execvpe(args[0], args, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
    raw = [b'']; ev = []; t0 = time.time()
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
    pump(5)
    warn = bool(WARN.search(strip(raw[0])))
    if warn:
        ev.append({'t': round(time.time() - t0, 1), 'event': 'startup Bypass warning shown'})
        if accept_warning:
            os.write(fd, b'\x1b[B'); pump(0.6); os.write(fd, b'\r'); pump(3); ev.append({'t': round(time.time() - t0, 1), 'event': 'chose Yes, I accept'})
        else:
            os.write(fd, b'\r'); pump(2); ev.append({'t': round(time.time() - t0, 1), 'event': 'chose No, exit'})
    if send_prompt and (not warn or accept_warning):
        os.write(fd, b'go'); pump(0.5); os.write(fd, b'\r')
        asks = 0; mark = len(raw[0]); end = time.time() + 40
        while time.time() < end:
            if not pump(0.5): break
            tail = strip(raw[0][mark:])
            if ASK.search(tail):
                asks += 1; ev.append({'t': round(time.time() - t0, 1), 'event': f'permission dialog #{asks} → Esc（拒绝）', 'excerpt': ' '.join(tail.split())[-220:]})
                os.write(fd, b'\x1b'); pump(1.5); mark = len(raw[0])
            if any(r.get('reply') == 'text' and r.get('hasWrite') for r in STATE['reqs']): pump(1.5); break
    for _ in range(3):
        try: os.write(fd, b'\x03'); pump(0.6)
        except OSError: break
    try: os.kill(pid, 9)
    except Exception: pass
    return {'events': ev, 'warning': warn, 'files': {'inCwd': os.path.exists(os.path.join(proj, 'in-cwd.txt')), 'outside': os.path.exists(os.path.join(outside, 'outside.txt'))},
            'requests': list(STATE['reqs']), 'tail': ' '.join(strip(raw[0]).split())[-600:], 'full': ' '.join(strip(raw[0]).split())[-6000:]}

res = {}
for mode in modes:
    cfg = os.path.join(out_dir, 'cfg-' + mode); os.makedirs(cfg, exist_ok=True)
    def fresh(tag):
        proj = os.path.realpath(os.path.join(out_dir, f'proj-{mode}-{tag}')); outside = os.path.realpath(os.path.join(out_dir, f'outside-{mode}-{tag}'))
        os.makedirs(proj, exist_ok=True); os.makedirs(outside, exist_ok=True)
        cj = os.path.join(cfg, '.claude.json'); d = json.load(open(cj)) if os.path.exists(cj) else {'hasCompletedOnboarding': True, 'theme': 'dark', 'lastOnboardingVersion': '2.1.322', 'projects': {}}
        d['projects'][proj] = {'hasTrustDialogAccepted': True, 'hasCompletedProjectOnboarding': True}; json.dump(d, open(cj, 'w'))
        return proj, outside
    p1, o1 = fresh('1'); res[mode] = {'first': session(mode, cfg, p1, o1, accept_warning=True)}
    if mode == 'bypassPermissions':
        p2, o2 = fresh('2'); res[mode]['second'] = session(mode, cfg, p2, o2, accept_warning=False, send_prompt=False)
        sj = os.path.join(cfg, 'settings.json'); res[mode]['settingsAfter'] = json.load(open(sj)) if os.path.exists(sj) else None
    print(mode, json.dumps({k: (v['files'], [e['event'] for e in v['events']]) for k, v in res[mode].items() if isinstance(v, dict) and 'files' in v}, ensure_ascii=False), file=sys.stderr)
    json.dump(res, open(os.path.join(out_dir, os.environ.get('RESULT', 'e7-result.json')), 'w'), ensure_ascii=False, indent=1)
srv.shutdown()
