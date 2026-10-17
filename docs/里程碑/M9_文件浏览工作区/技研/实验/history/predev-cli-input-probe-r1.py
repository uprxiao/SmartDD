#!/usr/bin/env python3
"""Isolated installed Claude Code TUI. No model submission, no credentials.
--bare explicitly skips OAuth/keychain/hooks; OS policy denies ALL network.
Only a synthetic local input can be inserted; this is not a Codex probe.
"""
import fcntl, hashlib, json, os, pathlib, pty, re, select, signal, struct, subprocess, sys, tempfile, termios, time
output=pathlib.Path(sys.argv[1]);mode=sys.argv[2] if len(sys.argv)>2 else 'inspect'
if output.exists():raise RuntimeError('new report path required')
script=pathlib.Path(__file__).resolve();cli='/Users/liubu/.local/bin/claude'
report={'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'scope':'isolated genuine Claude Code TUI; no model messages; no Codex; no user credentials','mode':mode,'version':subprocess.check_output([cli,'--version']).decode().strip(),'networkPolicy':'(version 1)(allow default)(deny network*)','scriptSha256':hashlib.sha256(script.read_bytes()).hexdigest(),'inputEvents':[]}
with tempfile.TemporaryDirectory(prefix='m9-cli-predev-') as tmp:
    root=pathlib.Path(tmp);(root/'config').mkdir()
    env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','TERM':'xterm-256color','LANG':'en_US.UTF-8','HOME':tmp,'TMPDIR':tmp,'CLAUDE_CONFIG_DIR':str(root/'config'),'ANTHROPIC_API_KEY':'m9-synthetic-invalid-no-network','ANTHROPIC_BASE_URL':'http://127.0.0.1:1','DISABLE_AUTOUPDATER':'1'}
    args=[cli,'--bare','--setting-sources','','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-chrome']
    master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
    proc=subprocess.Popen(['/usr/bin/sandbox-exec','-p',report['networkPolicy'],*args],stdin=slave,stdout=slave,stderr=slave,cwd=tmp,env=env,start_new_session=True);os.close(slave);raw=b''
    def pump(seconds):
        global raw
        end=time.monotonic()+seconds
        while time.monotonic()<end and proc.poll() is None:
            if not select.select([master],[],[],0.1)[0]:continue
            try:d=os.read(master,65536)
            except OSError:break
            raw+=d
            if b'\x1b[6n' in d:os.write(master,b'\x1b[1;1R')
            if b'\x1b[c' in d:os.write(master,b'\x1b[?1;2c')
    try:
        pump(8)
        report['initialOutput']=raw.decode('utf8','replace')
        report['outcome']='startup-observed'
    finally:
        try:os.killpg(proc.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:proc.wait(timeout=3)
        except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
        os.close(master)
    report['exitCode']=proc.returncode;report['modelSubmission']=False;report['temporaryProfileRemovedOnExit']=True
report['completedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'version':report['version'],'outcome':report['outcome'],'output':re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',report['initialOutput'])[-7000:]},ensure_ascii=False))
