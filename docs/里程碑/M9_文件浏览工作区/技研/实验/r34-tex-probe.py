#!/usr/bin/env python3
"""Fixed real Tectonic + minimal official offline assets; macOS synthetic probe only.
Prerequisites are explicitly downloaded/verified outside compilation, never auto-installed.
Usage: python3 r34-tex-probe.py /private/tmp/m9-r34-tex <evidence-directory>
"""
import hashlib, json, os, pathlib, resource, shutil, signal, subprocess, sys, time
from datetime import datetime, timezone
from pypdf import PdfReader

root = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True)
engine = root / 'tectonic'
bundle = root / 'minimal-plain-bundle.zip'
checks = []
expected = 'a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667'
assert hashlib.sha256((root/'tectonic-0.17.0-aarch64-apple-darwin.tar.gz').read_bytes()).hexdigest() == expected
outside = root / 'outside-secret.tex'
outside.write_text('PRIVATE-CANARY-M9-DO-NOT-READ\n')

def policy(job, executable=engine):
    # Root directory read permits current macOS dyld ignition. No broad /Users,
    # /System/Volumes/Data, /private/tmp, home, or global metadata permission.
    system = ['/usr/lib', '/System/Library', '/System/Volumes/Preboot', '/private/var/db/dyld']
    filters = ''.join('(subpath '+json.dumps(p)+')' for p in system)
    filters += '(literal "/")(literal "/dev/null")(literal "/dev/random")(literal "/dev/urandom")(literal '+json.dumps(str(executable))+')(literal '+json.dumps(str(bundle))+')(subpath '+json.dumps(str(job))+')'
    writes = ''.join('(subpath '+json.dumps(str(job/name))+')' for name in ['out','home','cache','tmp'])
    return '(version 1)(deny default)(allow process-exec (literal '+json.dumps(str(executable))+'))(allow process-info* (target self))(allow sysctl-read)(allow file-read* '+filters+')(allow file-write* '+writes+')'

def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (3, 4))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16*1024*1024, 16*1024*1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

def compile_case(name, source, timeout=15, cancel_after=None, extra=(), link=False):
    job=root/('case-'+name)
    if job.exists(): shutil.rmtree(job)
    for child in ['out','home','cache','tmp']:(job/child).mkdir(parents=True,exist_ok=True)
    # A cache created by the same pinned binary may be reused; no network cache fills.
    cache=root/'normal'/'cache'
    if cache.exists():shutil.copytree(cache,job/'cache',dirs_exist_ok=True)
    (job/'main.tex').write_text(source)
    (job/'inner.tex').write_text('Authorized local include.\\par\n')
    if link:(job/'link.tex').symlink_to(outside)
    (job/'policy.sb').write_text(policy(job))
    args=['/usr/bin/sandbox-exec','-f',str(job/'policy.sb'),str(engine),'-X','compile','--untrusted','--only-cached','--bundle',str(bundle),'--format','plain','--keep-logs','--outdir',str(job/'out'),*extra,'main.tex']
    env={'PATH':'/usr/bin:/bin','HOME':str(job/'home'),'TMPDIR':str(job/'tmp'),'XDG_CACHE_HOME':str(job/'cache'),'XDG_CONFIG_HOME':str(job/'home'),'TECTONIC_UNTRUSTED_MODE':'1'}
    stdout=job/'stdout.log';stderr=job/'stderr.log';started=time.monotonic();stopped=None;peak=0
    with stdout.open('wb') as so,stderr.open('wb') as se:
        child=subprocess.Popen(args,cwd=job,env=env,stdout=so,stderr=se,start_new_session=True,preexec_fn=limits)
        while child.poll() is None:
            elapsed=time.monotonic()-started
            sample=subprocess.run(['/bin/ps','-o','rss=','-p',str(child.pid)],capture_output=True,text=True).stdout.strip()
            if sample.isdigit():peak=max(peak,int(sample))
            if cancel_after is not None and elapsed >= cancel_after:stopped='cancelled'
            elif elapsed >= timeout:stopped='timeout'
            elif peak > 256*1024:stopped='memory-limit'
            if stopped:
                os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=2);break
            time.sleep(.02)
    elapsed=time.monotonic()-started
    pdf=job/'out'/'main.pdf';content='';pages=0
    if pdf.exists():
        reader=PdfReader(pdf);pages=len(reader.pages);content=''.join(p.extract_text() or '' for p in reader.pages)
    result={'exit':child.returncode,'stop':stopped,'elapsedMs':round(elapsed*1000),'peakRssKiB':peak,'pdf':pdf.exists(),'pages':pages,'text':content,'stdout':stdout.read_text(errors='replace'),'stderr':stderr.read_text(errors='replace'),'sourceSHA256':hashlib.sha256(source.encode()).hexdigest()}
    if name=='normal' and pdf.exists():
        shutil.copyfile(pdf,out/'r34-tex-normal.pdf');result['pdfSHA256']=hashlib.sha256(pdf.read_bytes()).hexdigest()
    return result

def check(identifier,title,result,passed):
    checks.append({'id':identifier,'title':title,'status':'passed' if passed else 'failed','detail':result})

normal=compile_case('normal','Hello WillYou.\\par\\input inner.tex\\bye\n')
check('TEX34-01','真实离线 Plain TeX 编译产生可解析 PDF，根内 include 可用',normal,normal['exit']==0 and normal['pages']==1 and 'Hello WillYou' in normal['text'] and 'Authorized local include' in normal['text'])
math=compile_case('missing-font','Hello $a^2+b^2=c^2$.\\bye\n')
check('TEX34-02','资源缺失显式失败，不联网补字体，保留源码',math,math['exit']!=0 and 'font' in math['stderr'] and not math['pdf'])
for index,(name,source,link) in enumerate([
    ('absolute-read',r'\input '+str(outside)+'\n\\bye\n',False),
    ('parent-read',r'\input ../outside-secret.tex'+'\n\\bye\n',False),
    ('symlink-read',r'\input link.tex'+'\n\\bye\n',True),
],3):
    result=compile_case(name,source,link=link)
    check('TEX34-'+str(index).zfill(2),'拒绝根外读取：'+name,result,result['exit']!=0 and 'PRIVATE-CANARY' not in result['text']+result['stdout']+result['stderr'])
target=root/'outside-write.txt'
target.write_text('KEEP-ORIGINAL\n')
write=compile_case('outside-write',r'\immediate\openout2='+str(target)+'\n'+r'\immediate\write2{REPLACED}\immediate\closeout2 done\bye'+'\n')
check('TEX34-06','根外写入不覆盖合成 canary',write,target.read_text()=='KEEP-ORIGINAL\n')
shell_marker=root/'shell-marker'
shell_marker.unlink(missing_ok=True)
shell=compile_case('shell',r'\immediate\write18{touch '+str(shell_marker)+r'} Shell disabled.\bye'+'\n',extra=('-Z','shell-escape'))
check('TEX34-07','--untrusted 即使收到 shell-escape 开关也不执行 shell',shell,not shell_marker.exists() and shell['exit']==0 and 'Shell disabled' in shell['text'])
bad=compile_case('syntax',r'\UnknownM9Command\bye'+'\n')
check('TEX34-08','编译语法失败保留明确错误与源码',bad,bad['exit']!=0 and 'Undefined control sequence' in bad['stderr']+bad['stdout'])
loop=r'\newcount\n \loop\advance\n by 1\iftrue\repeat'+'\n'
timed=compile_case('timeout',loop,timeout=.7)
check('TEX34-09','真实编译死循环由宿主限时终止',timed,timed['stop']=='timeout' and timed['exit']==-signal.SIGKILL and not timed['pdf'] and timed['elapsedMs']<2500)
cancelled=compile_case('cancel',loop,cancel_after=.15)
check('TEX34-10','真实编译任务可取消且没有成功产物',cancelled,cancelled['stop']=='cancelled' and cancelled['exit']==-signal.SIGKILL and not cancelled['pdf'] and cancelled['elapsedMs']<2000)

# Direct OS policy negative controls use system curl/true, not fake compilers.
netjob=root/'policy-network';netjob.mkdir(exist_ok=True)
for child in ['out','home','cache','tmp']:(netjob/child).mkdir(exist_ok=True)
(netjob/'policy.sb').write_text(policy(netjob,pathlib.Path('/usr/bin/curl')))
network=subprocess.run(['/usr/bin/sandbox-exec','-f',str(netjob/'policy.sb'),'/usr/bin/curl','--noproxy','*','--connect-timeout','1','http://127.0.0.1:4176/'],cwd=netjob,capture_output=True,text=True,timeout=3,env={'PATH':'/usr/bin:/bin'})
check('TEX34-11','同一 OS 策略禁止 socket（只试本机既有原型端口）',{'exit':network.returncode,'stdout':network.stdout,'stderr':network.stderr},network.returncode!=0 and ('Operation not permitted' in network.stderr or 'not permitted' in network.stderr))
execjob=root/'policy-exec';execjob.mkdir(exist_ok=True)
for child in ['out','home','cache','tmp']:(execjob/child).mkdir(exist_ok=True)
(execjob/'policy.sb').write_text(policy(execjob))
execute=subprocess.run(['/usr/bin/sandbox-exec','-f',str(execjob/'policy.sb'),'/usr/bin/true'],capture_output=True,text=True,timeout=3)
check('TEX34-12','编译策略拒绝执行其他程序',{'exit':execute.returncode,'stderr':execute.stderr},execute.returncode!=0)

report={'revision':'R3.4-20261017','timestamp':datetime.now(timezone.utc).isoformat(),'engine':{'version':'0.17.0','archiveSHA256':expected,'binarySHA256':hashlib.sha256(engine.read_bytes()).hexdigest(),'bundleSHA256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'bundleSourceCommit':'8c0126a9653239a2e6e0a5274af9b8510f643030','bundleScope':'74 official test assets + derived SHA256SUM, minimal Plain TeX; not a full LaTeX distribution'},'environment':{'system':os.uname().sysname,'release':os.uname().release,'arch':os.uname().machine},'policy':policy(root/'case-normal'),'limits':{'wallDefaultSeconds':15,'cpuSeconds':[3,4],'rssKillKiB':256*1024,'outputFileBytes':16*1024*1024,'openFiles':64},'checks':checks,'summary':{'passed':sum(c['status']=='passed' for c in checks),'failed':sum(c['status']=='failed' for c in checks)},'boundary':'Real Plain TeX and real macOS sandbox only. Full LaTeX packages/fonts, Chinese/Office-equivalent fidelity, production broker, App Sandbox distribution, Windows/Linux and safe output commit remain unverified.'}
(out/'r34-tex-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report['summary']));sys.exit(0 if report['summary']['failed']==0 else 1)
