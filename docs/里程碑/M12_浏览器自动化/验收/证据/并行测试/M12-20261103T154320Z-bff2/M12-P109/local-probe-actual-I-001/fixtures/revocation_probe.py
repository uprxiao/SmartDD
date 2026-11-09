#!/usr/bin/env python3
"""Explicit detached lifetime fixture, not a product stop-cleanup claim.
Only real stockCLI calls; original run credential stays solely in worker memory/env.
"""
import hashlib,json,os,pathlib,re,stat,subprocess,sys,time
D=pathlib.Path(__file__).resolve().parent

def private_json(path):
    s=path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o777!=0o600:raise RuntimeError('Private metadata required')
    return json.loads(path.read_text())
def write(path,value):
    temp=path.with_name(path.name+'.tmp-'+str(os.getpid()));fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:os.write(fd,(json.dumps(value,separators=(',',':'))+'\n').encode())
    finally:os.close(fd)
    os.replace(temp,path)
def cli_summary(output,returncode):
    try:v=json.loads(output)
    except Exception:return {'protocolParsed':False,'returncode':returncode}
    if not isinstance(v,dict):return {'protocolParsed':False,'returncode':returncode}
    error=v.get('error') if isinstance(v.get('error'),dict) else {};operation=v.get('operation') if isinstance(v.get('operation'),dict) else {};request=v.get('requestId') or operation.get('requestId');request_valid=isinstance(request,str) and bool(re.fullmatch(r'[a-f0-9-]{36}',request))
    return {'protocolParsed':True,'returncode':returncode,'success':v.get('schema')=='willyou-app-result-v2' and v.get('status')=='ok' and v.get('capabilityId')=='browser.tab.list' and operation.get('effectState')=='read-only','capabilityId':v.get('capabilityId'),'operationId':operation.get('id'),'requestId':request,'errorCode':error.get('code'),'effectState':operation.get('effectState') or error.get('effectState'),'hostAuthRejected':error.get('code')=='AUTH_REQUIRED' and request_valid,'businessOperationIdRequiredForDenial':False}
def pinned(path,expected):
    p=pathlib.Path(path)
    if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected or p.stat().st_mode&0o777!=0o755:raise RuntimeError('Pinned executable changed')
def identity(cfg,pid):
    pinned(cfg['identityHelper'],cfg['identityHelperSha256']);p=subprocess.run([cfg['identityHelper'],str(pid)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=3,check=False)
    v=json.loads(p.stdout)
    if p.returncode!=0 or v.get('state')!='running' or v.get('pid')!=pid or not re.fullmatch(r'darwin-proc-v1:[1-9][0-9]*:[0-9]+',v.get('startedAt','')):raise RuntimeError('Exact owned process birth unavailable')
    return {'pid':pid,'startedAt':v['startedAt']}
def bridge_stat(endpoint):
    s=os.lstat(endpoint)
    if not stat.S_ISSOCK(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o777!=0o600:raise RuntimeError('Own live private bridge socket required')
    return {'device':s.st_dev,'inode':s.st_ino,'uid':s.st_uid}
def worker(cfg):
    if os.getsid(0)!=os.getpid() or os.getpgid(0)!=os.getpid():raise RuntimeError('Explicit detached test group required')
    if hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()!=cfg['probeSha256']:raise RuntimeError('Reviewed fixture changed')
    token=os.environ.get('WILLYOU_RUN_TOKEN');endpoint=os.environ.get('WILLYOU_ENDPOINT')
    if not token or not re.fullmatch(r'[a-f0-9]{64}',token) or not endpoint or not endpoint.startswith('/private/tmp/wy-cli-'):raise RuntimeError('Own managed credential absent')
    # No secret values or hashes are written, printed or sent in arguments.
    env=dict(os.environ);anchor=identity(cfg,os.getpid());before_bridge=bridge_stat(endpoint);known=[];data={'fixture':'explicit-detached-post-stop-probe','worker':anchor,'sessionId':os.getsid(0),'processGroup':os.getpgid(0),'parentPidBefore':os.getppid(),'stockCli':cfg['stockCli'],'stockCliSha256':cfg['stockCliSha256'],'taskId':cfg['taskId'],'runId':cfg['runId'],'marker':cfg['marker'],'credentialPresence':True,'bridgeBefore':before_bridge,'credentialStorage':'worker-memory-and-env-only','sameCredentialUsed':False,'sameEndpointUsed':False,'knownChildren':known}
    write(D/'probe.worker.private.json',data)
    def invoke(tag):
        if env.get('WILLYOU_RUN_TOKEN')!=token or env.get('WILLYOU_ENDPOINT')!=endpoint:raise RuntimeError('Original immutable credential changed')
        pinned(cfg['stockCli'],cfg['stockCliSha256']);p=subprocess.Popen([cfg['stockCli'],'browser','tab','list','--stdin','task'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,cwd=cfg['project'],start_new_session=False,close_fds=True)
        entry={'pid':p.pid,'tag':tag};known.append(entry);write(D/'probe.worker.private.json',data)
        try:
            # The stock CLI is waiting for its ordinary stdin argument. No protocol response is intercepted.
            entry['identity']=identity(cfg,p.pid);write(D/'probe.worker.private.json',data)
            stdout,stderr=p.communicate((cfg['taskId']+'\n').encode(),timeout=140)
        except Exception:
            p.kill();stdout,stderr=p.communicate(timeout=5);entry['forcedFixtureCleanup']=True;entry['returncode']=p.returncode;write(D/'probe.worker.private.json',data);raise
        entry['returncode']=p.returncode;entry['completedMonotonicNs']=time.monotonic_ns();entry['stdoutSha256']=hashlib.sha256(stdout).hexdigest()
        # Complete actual CLI responses remain private. They never contain the credential env.
        for suffix,b in [('stdout',stdout),('stderr',stderr)]:
            fd=os.open(D/(tag+'.'+suffix+'.private'),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            try:os.write(fd,b)
            finally:os.close(fd)
        entry['summary']=cli_summary(stdout,p.returncode);write(D/'probe.worker.private.json',data);return entry
    try:
        gate=pathlib.Path(cfg['controller'])/'probe-gate.json';until=time.monotonic()+180
        while not gate.exists():
            if time.monotonic()>until:raise RuntimeError('Second actual model CLI not confirmed; no probe sent')
            time.sleep(0.1)
        g=private_json(gate)
        if (g['runId'],g['taskId'],g['marker'])!=(cfg['runId'],cfg['taskId'],cfg['marker']):raise RuntimeError('Wrong confirmed run')
        pre=invoke('probe-pre')
        if not pre['summary'].get('success'):raise RuntimeError('Originally ineligible caller; stop-negative not valid')
        data['prePositiveAtWallNs']=time.time_ns();data['prePositiveMonotonicNs']=time.monotonic_ns();write(D/'probe.ready.private.json',data)
        stop=pathlib.Path(cfg['controller'])/'task-stopped.json';until=time.monotonic()+240
        while not stop.exists():
            if time.monotonic()>until:raise RuntimeError('Actual managed task stop not observed')
            time.sleep(0.1)
        stopped=private_json(stop)
        if (stopped['runId'],stopped['taskId'],stopped['marker'])!=(cfg['runId'],cfg['taskId'],cfg['marker']) or not stopped['ptyIsNull'] or not stopped['currentRunIsNull']:raise RuntimeError('No matching real task stop')
        if identity(cfg,os.getpid())!=anchor:raise RuntimeError('Controlled worker identity changed')
        data['parentPidAfter']=os.getppid();data['sameCredentialUsed']=env.get('WILLYOU_RUN_TOKEN')==token;data['sameEndpointUsed']=env.get('WILLYOU_ENDPOINT')==endpoint;data['bridgeAfter']=bridge_stat(endpoint);data['bridgeStillSame']=data['bridgeAfter']==before_bridge
        if not data['bridgeStillSame']:raise RuntimeError('Endpoint closed/replaced; not a revocation proof')
        post=invoke('probe-post');data['postHostAuthRejected']=post['summary'].get('hostAuthRejected',False);data['finishedAtWallNs']=time.time_ns();data['status']='post-host-auth-required' if data['postHostAuthRejected'] else 'failed-or-incomplete';write(D/'probe.done.private.json',data)
    except BaseException as error:
        # Fixed error class only, never repr of an environment/request object.
        data['status']='failed-or-incomplete';data['errorClass']=type(error).__name__;write(D/'probe.failed.private.json',data);raise
    finally:
        env.pop('WILLYOU_RUN_TOKEN',None);env.pop('WILLYOU_ENDPOINT',None);token=None;endpoint=None

def main():
    cfg=private_json(D/'runtime.public.json')
    if pathlib.Path.cwd().resolve()!=pathlib.Path(cfg['project']).resolve():raise RuntimeError('Synthetic project only')
    if sys.argv[1:] == ['--worker']:return worker(cfg)
    if sys.argv[1:] != ['--start']:raise RuntimeError('Explicit mode required')
    log=D/'probe.worker-log.private';fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:p=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).resolve()),'--worker'],cwd=cfg['project'],stdin=subprocess.DEVNULL,stdout=fd,stderr=fd,start_new_session=True,close_fds=True)
    finally:os.close(fd)
    parent={'parentPid':os.getpid(),'parentIdentity':identity(cfg,os.getpid()),'workerPid':p.pid,'parentGroup':os.getpgid(0),'explicitDetachedFixture':True};write(D/'probe.parent.private.json',parent)
    try:parent['worker']=identity(cfg,p.pid);write(D/'probe.parent.private.json',parent)
    except Exception:pass
    printed=False
    while p.poll() is None:
        ready=D/'probe.ready.private.json'
        if ready.exists() and not printed:
            v=private_json(ready);printed=True;print(json.dumps({'phase':'probe-ready','beforeStopPositive':True,'workerPid':v['worker']['pid'],'workerBirth':v['worker']['startedAt'],'credentialPrinted':False}),flush=True)
        time.sleep(0.2)
    if p.returncode!=0:raise RuntimeError('Controlled probe did not complete; original raw retained')
if __name__=='__main__':main()
