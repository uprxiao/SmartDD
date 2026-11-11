# 补验 E · E1：Claude Code 各权限模式的放行范围（本机模拟 Anthropic 服务、隔离配置目录、断网代理；零费用）
# 模拟服务按顺序返回三个工具调用：Write 项目内文件 → Bash 写项目内文件 → Write 项目外文件，最后返回文本。
# 用 -p 与 --permission-prompts none：凡是交互时会询问的操作都被自动拒绝，所以“被拒绝”等于“交互时会询问”。
# 用法：python3 -I e1m-claude.py <输出目录> [模式,...]
import os, sys, json, threading, http.server, socketserver, subprocess, time
out_dir = sys.argv[1]; modes = (sys.argv[2] if len(sys.argv) > 2 else 'default,acceptEdits,auto,plan,dontAsk,bypassPermissions').split(',')
os.makedirs(out_dir, exist_ok=True)
STATE = {'reqs': []}

def steps(proj, outside):
    return [('Write', {'file_path': os.path.join(proj, 'in-cwd.txt'), 'content': 'a\n'}),
            ('Bash', {'command': f'echo b > {os.path.join(proj, "bash.txt")}', 'description': 'write bash.txt'}),
            ('Write', {'file_path': os.path.join(outside, 'outside.txt'), 'content': 'c\n'})]

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_HEAD(self): self.send_response(200); self.end_headers()
    def do_GET(self): self.send_response(404); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); b = json.loads(self.rfile.read(n) or b'{}')
        tools = [t.get('name') for t in (b.get('tools') or [])]
        msgs = b.get('messages') or []
        results = [c for m in msgs if m.get('role') == 'user' and isinstance(m.get('content'), list) for c in m['content'] if c.get('type') == 'tool_result']
        rec = {'path': self.path, 'tools': len(tools), 'hasWrite': 'Write' in tools, 'toolResults': len(results),
               'lastResult': (str(results[-1].get('content'))[:160] if results else None), 'isErr': (results[-1].get('is_error') if results else None)}
        if not self.path.startswith('/v1/messages') or 'count_tokens' in self.path:
            rec['reply'] = '404'; STATE['reqs'].append(rec); self.send_response(404); self.end_headers(); return
        plan = STATE['plan']; k = len(results)
        if 'Write' in tools and k < len(plan):
            name, inp = plan[k]; rec['reply'] = f'tool_use {name}'
            blocks = [('content_block_start', {'index': 0, 'content_block': {'type': 'tool_use', 'id': f'toolu_{k}', 'name': name, 'input': {}}}),
                      ('content_block_delta', {'index': 0, 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(inp)}}),
                      ('content_block_stop', {'index': 0})]; stop = 'tool_use'
        else:
            rec['reply'] = 'text'
            blocks = [('content_block_start', {'index': 0, 'content_block': {'type': 'text', 'text': ''}}),
                      ('content_block_delta', {'index': 0, 'delta': {'type': 'text_delta', 'text': 'done'}}),
                      ('content_block_stop', {'index': 0})]; stop = 'end_turn'
        STATE['reqs'].append(rec)
        self.send_response(200); self.send_header('content-type', 'text/event-stream'); self.end_headers()
        m = {'id': 'msg', 'type': 'message', 'role': 'assistant', 'model': b.get('model'), 'content': [], 'stop_reason': None, 'usage': {'input_tokens': 1, 'output_tokens': 0}}
        for t, d in [('message_start', {'message': m}), *blocks, ('message_delta', {'delta': {'stop_reason': stop}, 'usage': {'output_tokens': 1}}), ('message_stop', {})]:
            self.wfile.write(f'event: {t}\ndata: {json.dumps({"type": t, **d})}\n\n'.encode()); self.wfile.flush()

srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H); srv.daemon_threads = True; port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ver = subprocess.run(['claude', '--version'], capture_output=True, text=True).stdout.strip()
result = {'cli': ver, 'method': 'mock Anthropic server, -p --permission-prompts none', 'runs': {}}
for mode in modes:
    proj = os.path.realpath(os.path.join(out_dir, 'proj-' + mode)); outside = os.path.realpath(os.path.join(out_dir, 'outside-' + mode)); cfg = os.path.join(out_dir, 'cfg-' + mode)
    for d in (proj, outside, cfg): os.makedirs(d, exist_ok=True)
    STATE['plan'] = steps(proj, outside); STATE['reqs'] = []
    tiers = {k: 'm-default' for k in ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']}
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'TMPDIR': os.environ.get('TMPDIR', '/tmp'), 'CLAUDE_CONFIG_DIR': cfg,
           'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{port}', 'ANTHROPIC_AUTH_TOKEN': 'tok', 'HTTPS_PROXY': 'http://127.0.0.1:1', 'HTTP_PROXY': 'http://127.0.0.1:1',
           'ALL_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': '127.0.0.1,localhost', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_AUTOUPDATER': '1', 'CLAUDE_CODE_DISABLE_1M_CONTEXT': '1', **tiers}
    args = ['claude', '-p', '--setting-sources', 'user', '--strict-mcp-config', '--permission-mode', mode, '--permission-prompts', 'none', '--output-format', 'json', '--max-turns', '8', 'go']
    t = time.time(); r = subprocess.run(args, cwd=proj, env=env, capture_output=True, text=True, timeout=180)
    try: j = json.loads(r.stdout)
    except Exception: j = None
    run = {'exit': r.returncode, 'sec': round(time.time() - t, 1),
           'files': {'inCwd': os.path.exists(os.path.join(proj, 'in-cwd.txt')), 'bash': os.path.exists(os.path.join(proj, 'bash.txt')), 'outside': os.path.exists(os.path.join(outside, 'outside.txt'))},
           'denials': [{'tool': d.get('tool_name'), 'target': (d.get('tool_input') or {}).get('file_path') or (d.get('tool_input') or {}).get('command')} for d in ((j or {}).get('permission_denials') or [])],
           'result': ((j or {}).get('result') or '')[:300], 'isError': (j or {}).get('is_error'), 'stderr': r.stderr.strip()[-400:], 'requests': STATE['reqs']}
    if not j: run['stdout'] = r.stdout[:400]
    result['runs'][mode] = run
    print(mode, json.dumps(run['files']), 'denials', len(run['denials']), 'exit', r.returncode, file=sys.stderr)
    json.dump(result, open(os.path.join(out_dir, 'e1-result.json'), 'w'), ensure_ascii=False, indent=1)
srv.shutdown()
