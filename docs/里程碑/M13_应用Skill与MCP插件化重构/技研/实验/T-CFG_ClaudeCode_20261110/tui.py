import os, pty, time, select, re, sys, json, hashlib, tempfile, threading, http.server, socketserver, fcntl, termios, struct
root=tempfile.mkdtemp(prefix='m13-cc-tui-',dir='/tmp'); cfg=os.path.join(root,'cfg'); proj=os.path.join(root,'proj')
os.makedirs(cfg); os.makedirs(proj); proj=os.path.realpath(proj)
json.dump({'model':'opus'},open(os.path.join(cfg,'settings.json'),'w'))
json.dump({'hasCompletedOnboarding':True,'theme':'dark','lastOnboardingVersion':'2.1.321','projects':{proj:{'hasTrustDialogAccepted':True,'hasCompletedProjectOnboarding':True}}},open(os.path.join(cfg,'.claude.json'),'w'))
reqs=[]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_HEAD(self): self.send_response(200); self.end_headers()
    def do_GET(self): self.send_response(404); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get('content-length',0)); b=json.loads(self.rfile.read(n) or b'{}')
        if not self.path.startswith('/v1/messages') or 'count_tokens' in self.path:
            self.send_response(404); self.end_headers(); return
        reqs.append({'model':b.get('model'),'testToken':self.headers.get('authorization')=='Bearer tok'})
        self.send_response(200); self.send_header('content-type','text/event-stream'); self.end_headers()
        m={'id':'m','type':'message','role':'assistant','model':b.get('model'),'content':[],'stop_reason':None,'usage':{'input_tokens':1,'output_tokens':0}}
        for t,d in [('message_start',{'message':m}),('content_block_start',{'index':0,'content_block':{'type':'text','text':''}}),('content_block_delta',{'index':0,'delta':{'type':'text_delta','text':'OK'}}),('content_block_stop',{'index':0}),('message_delta',{'delta':{'stop_reason':'end_turn'},'usage':{'output_tokens':1}}),('message_stop',{})]:
            self.wfile.write(f'event: {t}\ndata: {json.dumps({"type":t,**d})}\n\n'.encode())
srv=socketserver.ThreadingTCPServer(('127.0.0.1',0),H); srv.daemon_threads=True; port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
env={'PATH':os.environ['PATH'],'HOME':os.environ['HOME'],'CLAUDE_CONFIG_DIR':cfg,'TERM':'xterm-256color','ANTHROPIC_BASE_URL':f'http://127.0.0.1:{port}','ANTHROPIC_AUTH_TOKEN':'tok',
 'HTTPS_PROXY':'http://127.0.0.1:1','HTTP_PROXY':'http://127.0.0.1:1','ALL_PROXY':'http://127.0.0.1:1','NO_PROXY':'127.0.0.1,localhost','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1',
 'ANTHROPIC_DEFAULT_OPUS_MODEL':'map-opus-x','ANTHROPIC_DEFAULT_SONNET_MODEL':'map-sonnet-y','ANTHROPIC_DEFAULT_HAIKU_MODEL':'map-haiku-z','ANTHROPIC_CUSTOM_MODEL_OPTION':'custom-kimi'}
pid,fd=pty.fork()
if pid==0:
    os.chdir(proj); os.execvpe('claude',['claude'],env)
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',45,150,0,0))
buf=b''
def read(t):
    global buf; end=time.time()+t
    while time.time()<end:
        r,_,_=select.select([fd],[],[],0.2)
        if r:
            try: buf+=os.read(fd,65536)
            except OSError: return
def screen(n=1500): return re.sub(r'\s+',' ',re.sub(r'\x1b\[[0-9;?<>=]*[a-zA-Z~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>MP78]','',buf.decode('utf8','replace')))[-n:]
def send(s,t=2): os.write(fd,s.encode()); read(t)
def cfgset(): return open(os.path.join(cfg,'settings.json')).read()
log={}
read(10); log['start']=screen(700)
step=os.environ.get('STEP','explore')
send('/model',1.5); send('\r',3); log['picker']=screen(2500)
if step in('pick','custom'):
    if step=='pick':
        send('\x1b[B',1); log['afterDown']=screen(800); send('\r',3)
    else:
        send('\x1b',1); send('/model my-free-model',1.5); send('\r',3)
    log['afterPick']=screen(800); log['settings']=cfgset()
    send('hi',1); send('\r',10); log['reqs']=list(reqs); log['afterHi']=screen(600)
else:
    send('\x1b',1); log['settings']=cfgset()
os.kill(pid,9); os.waitpid(pid,0); srv.shutdown()
print(json.dumps(log,ensure_ascii=False,indent=1))
