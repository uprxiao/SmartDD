# 补验 D · R1：Claude Code 多模型呈现（本机模拟服务器、隔离配置目录、断网代理；零费用）
# 用法：CASE=<名称> python3 -I r1-picker.py ；输出 JSON
import os, pty, time, select, re, sys, json, tempfile, threading, http.server, socketserver, fcntl, termios, struct, shutil
CASE = os.environ.get('CASE', 'replace')
root = tempfile.mkdtemp(prefix='m13-r1-', dir=os.environ.get('TMPDIR', '/tmp')); cfg = os.path.join(root, 'cfg'); proj = os.path.realpath(os.path.join(root, 'proj'))
os.makedirs(cfg); os.makedirs(proj)
rows = [{'model': 'm-default', 'label': '默认 A（m-default）', 'description': '启动时的默认模型'}, {'model': 'm-b', 'label': '模型 B'}, {'model': 'm-c', 'label': '模型 C'}]
settings = {}
if CASE in ('replace', 'replace-pick-enter', 'behaves', 'window-env', 'enter-mc', 'default-row', 'nopick', 'nopick-nobeta'):
    settings['modelPicker'] = {'options': rows, 'replaceBuiltInOptions': True}
if CASE == 'append':
    settings['modelPicker'] = {'options': rows}
if CASE == 'behaves':
    settings['modelPicker']['options'] = [{**r, 'behavesAs': 'claude-sonnet-4-5'} for r in rows]
json.dump(settings, open(os.path.join(cfg, 'settings.json'), 'w'), ensure_ascii=False)
json.dump({'hasCompletedOnboarding': True, 'theme': 'dark', 'lastOnboardingVersion': '2.1.322', 'projects': {proj: {'hasTrustDialogAccepted': True, 'hasCompletedProjectOnboarding': True}}}, open(os.path.join(cfg, '.claude.json'), 'w'))
reqs = []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_HEAD(self): self.send_response(200); self.end_headers()
    def do_GET(self):
        reqs.append({'method': 'GET', 'path': self.path}); self.send_response(404); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); b = json.loads(self.rfile.read(n) or b'{}')
        reqs.append({'method': 'POST', 'path': self.path, 'model': b.get('model'), 'tools': len(b.get('tools') or []), 'maxTokens': b.get('max_tokens'), 'beta': self.headers.get('anthropic-beta'), 'hasThinking': 'thinking' in b, 'contextMgmt': 'context_management' in b})
        if not self.path.startswith('/v1/messages') or 'count_tokens' in self.path:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header('content-type', 'text/event-stream'); self.end_headers()
        m = {'id': 'm', 'type': 'message', 'role': 'assistant', 'model': b.get('model'), 'content': [], 'stop_reason': None, 'usage': {'input_tokens': 1, 'output_tokens': 0}}
        for t, d in [('message_start', {'message': m}), ('content_block_start', {'index': 0, 'content_block': {'type': 'text', 'text': ''}}), ('content_block_delta', {'index': 0, 'delta': {'type': 'text_delta', 'text': 'OK'}}), ('content_block_stop', {'index': 0}), ('message_delta', {'delta': {'stop_reason': 'end_turn'}, 'usage': {'output_tokens': 1}}), ('message_stop', {})]:
            self.wfile.write(f'event: {t}\ndata: {json.dumps({"type": t, **d})}\n\n'.encode())
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H); srv.daemon_threads = True; port = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()
tiers = {k: 'm-default' for k in ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']}
env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'CLAUDE_CONFIG_DIR': cfg, 'TERM': 'xterm-256color', 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{port}', 'ANTHROPIC_AUTH_TOKEN': 'tok',
       'HTTPS_PROXY': 'http://127.0.0.1:1', 'HTTP_PROXY': 'http://127.0.0.1:1', 'ALL_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': '127.0.0.1,localhost', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', **tiers}
if CASE == 'window-env': env['CLAUDE_CODE_AUTO_COMPACT_WINDOW'] = '128000'
if CASE == 'nopick-nobeta': env['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'] = '1'
args = ['claude', '--setting-sources', 'user']
pid, fd = pty.fork()
if pid == 0:
    os.chdir(proj); os.execvpe('claude', args, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
buf = b''
def read(t):
    global buf; end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try: buf += os.read(fd, 65536)
            except OSError: return
def screen(n=1500): return re.sub(r'\s+', ' ', re.sub(r'\x1b\[[0-9;?<>=]*[a-zA-Z~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>MP78]', '', buf.decode('utf8', 'replace')))[-n:]
def mark(): return len(buf)
def since(m, n=2000): return re.sub(r'\s+', ' ', re.sub(r'\x1b\[[0-9;?<>=]*[a-zA-Z~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>MP78]', '', buf[m:].decode('utf8', 'replace')))[-n:]
def send(s, t=2): os.write(fd, s.encode()); read(t)
log = {'case': CASE, 'settings': settings, 'args': args[1:]}
read(10); log['start'] = screen(900); log['reqsAtStart'] = list(reqs)
if CASE in ('nopick', 'nopick-nobeta'):
    n0 = len(reqs); send('hi', 1); send('\r', 10); log['reqsAfterHi'] = reqs[n0:]; log['picker'] = ''
else:
    m0 = mark(); send('/model', 1.5); send('\r', 3); log['picker'] = since(m0, 2600)
if CASE in ('replace', 'append', 'behaves', 'window-env'):
    send('\x1b[B', 0.8); send('\x1b[B', 0.8); m1 = mark(); send('s', 3); log['afterPickS'] = since(m1, 600)
    log['settingsAfterS'] = open(os.path.join(cfg, 'settings.json')).read()
    n0 = len(reqs); send('hi', 1); send('\r', 10); log['reqsAfterHi'] = reqs[n0:]
if CASE == 'enter-mc':
    send('\x1b[B', 0.8); send('\x1b[B', 0.8); m1 = mark(); send('\r', 3); log['afterPickEnter'] = since(m1, 600)
    log['settingsAfterEnter'] = json.load(open(os.path.join(cfg, 'settings.json')))
    n0 = len(reqs); send('hi', 1); send('\r', 10); log['reqsAfterHi'] = reqs[n0:]
if CASE == 'default-row':
    send('\x1b[A', 0.8); m1 = mark(); send('s', 3); log['afterPickS'] = since(m1, 400)
    n0 = len(reqs); send('hi', 1); send('\r', 10); log['reqsAfterHi'] = reqs[n0:]
if CASE == 'replace-pick-enter':
    send('\x1b[B', 0.8); send('\x1b[B', 0.8); send('\x1b[B', 0.8); m1 = mark(); send('\r', 3); log['afterPickEnter'] = since(m1, 600)
    log['settingsAfterEnter'] = open(os.path.join(cfg, 'settings.json')).read()
    n0 = len(reqs); send('hi', 1); send('\r', 10); log['reqsAfterHi'] = reqs[n0:]
log['allPaths'] = sorted({r['method'] + ' ' + r['path'].split('?')[0] for r in reqs})
log['unknownModelWarning'] = bool(re.search(r"doesn.t recognize the model|isn.t described", buf.decode('utf8', 'replace')))
os.kill(pid, 9); os.waitpid(pid, 0); srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
print(json.dumps(log, ensure_ascii=False, indent=1))
