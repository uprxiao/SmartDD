import os,pty,time,select,re,json,sys,subprocess,fcntl,termios,struct,tempfile,signal
root=os.path.realpath(tempfile.mkdtemp(prefix='m13-a1-tui-',dir='/tmp'));proj=os.path.join(root,'proj');os.makedirs(proj)
LOG=os.path.join(root,'probe.log');open(LOG,'w').close()
mock=subprocess.Popen(['node','/tmp/m13-a1/mocks.mjs',root]);
for _ in range(50):
    if os.path.exists(root+'/ports.json'): break
    time.sleep(0.1)
ports=json.load(open(root+'/ports.json'));res={}
def drive(label,argv,env,keys_after_prompt,prompt_re):
    pid,fd=pty.fork()
    if pid==0:
        os.chdir(proj);os.execvpe(argv[0],argv,env)
    fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',45,150,0,0));buf=b''
    def read(t):
        nonlocal buf;end=time.time()+t
        while time.time()<end:
            r,_,_=select.select([fd],[],[],0.2)
            if r:
                try: buf+=os.read(fd,65536)
                except OSError: return
    scr=lambda n=900:re.sub(r'\s+',' ',re.sub(r'\x1b\[[0-9;?<>=]*[a-zA-Z~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>MP78]','',buf.decode('utf8','replace')))[-n:]
    def send(s,t=1.5): os.write(fd,s.encode());read(t)
    steps=[]
    read(8);send('CALLWRITE please',1);send('\r',8)
    prompted=bool(re.search(prompt_re,scr(3000),re.I));shot=scr(1200)
    for k in keys_after_prompt:
        send(k,3);steps.append(scr(300))
    read(6);after=scr(700)
    os.kill(pid,signal.SIGKILL);os.waitpid(pid,0)
    calls=[json.loads(l) for l in open(LOG) if '"call"' in l]
    res[label]={'steps':steps,'approvalPromptShown':prompted,'promptScreen':shot,'afterScreen':after,'serverCalls':calls}
    open(LOG,'w').close()
base={'PATH':os.environ['PATH'],'TERM':'xterm-256color','HTTPS_PROXY':'http://127.0.0.1:1','HTTP_PROXY':'http://127.0.0.1:1','NO_PROXY':'127.0.0.1,localhost','WY_PROBE_LOG':LOG}
srv=['node','/tmp/m13-a1/probe-server.mjs','pa']
# Claude TUI: default permission ; decline with Esc
cfg=os.path.join(root,'cc');os.makedirs(cfg);json.dump({'hasCompletedOnboarding':True,'theme':'dark','projects':{proj:{'hasTrustDialogAccepted':True}}},open(cfg+'/.claude.json','w'))
mj=os.path.join(root,'mcp.json');json.dump({'mcpServers':{'pa':{'type':'stdio','command':'node','args':srv[1:],'env':{'WY_PROBE_LOG':LOG}}}},open(mj,'w'))
cc=['claude','--mcp-config',mj,'--strict-mcp-config','--model','m']
cenv={**base,'HOME':os.environ['HOME'],'CLAUDE_CONFIG_DIR':cfg,'ANTHROPIC_BASE_URL':'http://127.0.0.1:%d'%ports['anth'],'ANTHROPIC_AUTH_TOKEN':'tok','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1'}
ccd=cc+['--permission-mode','default']
drive('claude_permmode_default_Esc',ccd,cenv,['\x1b'],r'(proceed|allow)')
drive('claude_permmode_default_No3',ccd,cenv,['\x1b[B','\x1b[B','\r'],r'(proceed|allow)')
mock.kill()
txt=json.dumps(res,ensure_ascii=False,indent=1).replace(root,'<root>');open(root+'/result.json','w').write(txt);print(txt)
