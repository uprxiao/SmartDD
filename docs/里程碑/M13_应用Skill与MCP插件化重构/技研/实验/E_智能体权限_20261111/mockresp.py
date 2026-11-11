# 补验 E：本机模拟 OpenAI Responses 供应商（零费用）。按脚本返回函数调用，记录每个请求的摘要（工具名、是否审查请求、最后一个函数输出）。
# 用法：from mockresp import start; port, state = start(script_fn)；script_fn(body, state) 返回 ('text', str) 或 ('call', name, args_dict) 或 ('error', status)
import json, threading, http.server, socketserver

def start(script_fn):
    state = {'reqs': [], 'raw_first': None}
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            state['reqs'].append({'method': 'GET', 'path': self.path})
            if self.path.rstrip('/').endswith('/models'):
                body = json.dumps({'data': [{'id': 'mock-model', 'object': 'model'}]}).encode()
                self.send_response(200); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(body))); self.end_headers(); self.wfile.write(body); return
            self.send_response(404); self.end_headers()
        def do_POST(self):
            n = int(self.headers.get('content-length', 0)); raw = self.rfile.read(n) or b'{}'
            try: b = json.loads(raw)
            except Exception: b = {}
            if state['raw_first'] is None and self.path.endswith('/responses'): state['raw_first'] = b
            tools = [t.get('name') or t.get('type') for t in (b.get('tools') or [])]
            inp = b.get('input') or []
            outs = [i for i in inp if isinstance(i, dict) and i.get('type') == 'function_call_output']
            instr = (b.get('instructions') or '')
            rec = {'path': self.path, 'model': b.get('model'), 'tools': tools, 'nInput': len(inp), 'nOutputs': len(outs),
                   'lastOutput': (str(outs[-1].get('output'))[:300] if outs else None), 'instrHead': instr[:160]}
            if not self.path.endswith('/responses'):
                rec['reply'] = '404'; state['reqs'].append(rec); self.send_response(404); self.end_headers(); return
            act = script_fn(b, state, rec)
            rec['reply'] = act[0] + (':' + act[1] if act[0] == 'call' else '')
            state['reqs'].append(rec)
            if act[0] == 'error':
                self.send_response(act[1]); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(b'{"error":{"message":"mock failure"}}'); return
            rid = f'resp_{len(state["reqs"])}'
            if act[0] == 'call':
                item = {'type': 'function_call', 'id': f'fc_{len(state["reqs"])}', 'call_id': f'call_{len(state["reqs"])}', 'name': act[1], 'arguments': json.dumps(act[2]), 'status': 'completed'}
            else:
                item = {'type': 'message', 'id': f'msg_{len(state["reqs"])}', 'role': 'assistant', 'status': 'completed', 'content': [{'type': 'output_text', 'text': act[1], 'annotations': []}]}
            self.send_response(200); self.send_header('content-type', 'text/event-stream'); self.end_headers()
            resp = {'id': rid, 'object': 'response', 'status': 'in_progress', 'model': b.get('model'), 'output': []}
            evs = [('response.created', {'response': resp}),
                   ('response.output_item.added', {'output_index': 0, 'item': {**item, 'status': 'in_progress'}}),
                   ('response.output_item.done', {'output_index': 0, 'item': item}),
                   ('response.completed', {'response': {**resp, 'status': 'completed', 'output': [item], 'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2, 'input_tokens_details': {'cached_tokens': 0}, 'output_tokens_details': {'reasoning_tokens': 0}}}})]
            for t, d in evs:
                self.wfile.write(f'event: {t}\ndata: {json.dumps({"type": t, **d})}\n\n'.encode()); self.wfile.flush()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1], state
