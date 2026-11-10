import os, pty, time, select, re, sys, json, hashlib, tempfile, subprocess, threading, http.server, socketserver
root=tempfile.mkdtemp(prefix='m13-tui-'); ch=os.path.join(root,'ch'); home=os.path.join(root,'home'); cwd=os.path.join(root,'proj')
for d in (ch,home,cwd): os.makedirs(d)
open(os.path.join(ch,'config.toml'),'w').write('model = "cfg-default"\n')
reqs=[]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        n=int(self.headers.get('content-length',0)); b=json.loads(self.rfile.read(n) or b'{}'); reqs.append(b.get('model'))
        self.send_response(200); self.send_header('content-type','text/event-stream'); self.send_header('connection','close'); self.end_headers()
        i={'id':'m','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':'OK','annotations':[]}]}
        for t,d in [('response.created',{'response':{'id':'r','status':'in_progress','output':[]}}),('response.output_item.done',{'output_index':0,'item':i}),('response.completed',{'response':{'id':'r','status':'completed','output':[i],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}})]:
            self.wfile.write(f'event: {t}\ndata: {json.dumps({"type":t,**d})}\n\n'.encode())
srv=socketserver.TCPServer(('127.0.0.1',0),H); port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
env={'PATH':os.environ['PATH'],'HOME':home,'CODEX_HOME':ch,'TERM':'xterm-256color','WY_T_KEY':'k','HTTPS_PROXY':'http://127.0.0.1:1','HTTP_PROXY':'http://127.0.0.1:1','NO_PROXY':'127.0.0.1,localhost'}
args=['/Users/liubu/.local/bin/codex','--no-alt-screen','-c','analytics.enabled=false','-c','model_provider="wy"','-c',f'model_providers.wy={{name="wy",base_url="http://127.0.0.1:{port}/v1",wire_api="responses",env_key="WY_T_KEY"}}','-m','model-a']
pid,fd=pty.fork()
if pid==0:
    os.chdir(cwd); os.execve(args[0],args,env)
import fcntl, termios, struct
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
buf=b''
def read(t):
    global buf; end=time.time()+t
    while time.time()<end:
        r,_,_=select.select([fd],[],[],0.2)
        if r:
            try: buf+=os.read(fd,65536)
            except OSError: return
def text(): return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]','',buf.decode('utf8','replace'))
def send(s,t=2): os.write(fd,s.encode()); read(t)
read(8)
log={'root':root}
t=text(); log['startTail']=t[-600:]
if 'trust' in t.lower() or 'Do you trust' in t: send('\r',4)
send('/model',1); send('\r',4); log['pickerTail']=text()[-2500:]
send('\x1b[B',1); send('\r',3); log['afterPick1']=text()[-1500:]
send('\r',3); log['afterPick2']=text()[-1500:]
log['config']=open(os.path.join(ch,'config.toml')).read()
send('hi\r',6); log['reqModels']=list(reqs)
os.kill(pid,9); os.waitpid(pid,0); srv.shutdown()
print(json.dumps(log,ensure_ascii=False,indent=1))
