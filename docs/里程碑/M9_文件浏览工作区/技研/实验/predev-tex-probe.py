#!/usr/bin/env python3
"""Real offline LaTeX / mathematics / Chinese / images resource candidate probe.

Only synthetic documents are compiled. Each compile uses a new private profile,
no network, no user font directories, no shell or global package installation.
Run outside the host filesystem sandbox when sandbox-exec is itself restricted.
"""
import hashlib,json,os,pathlib,resource,shutil,signal,subprocess,sys,time
from datetime import datetime,timezone
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DecodedStreamObject,NameObject
from PIL import Image,ImageDraw

ROOT=pathlib.Path(sys.argv[1]).resolve();OUT=pathlib.Path(sys.argv[2]).resolve();OUT.mkdir(parents=True,exist_ok=True)
ENGINE=pathlib.Path(sys.argv[3] if len(sys.argv)>3 else '/private/tmp/m9-r34-tex/tectonic').resolve()
BUNDLE=ROOT/'willyou-tex-v33-candidate.zip'
MANIFEST=json.loads((ROOT/'predev-tex-resource-manifest.json').read_text())
assert hashlib.sha256(BUNDLE.read_bytes()).hexdigest()==MANIFEST['candidateArchiveSHA256']
CHECKS=[]
# Engineering acceptance budgets fixed before first run, not tuned to results.
LIMITS={'coldWallSeconds':30,'warmWallSeconds':15,'cpuSeconds':[25,27],'rssKillKiB':768*1024,'outputFileBytes':40*1024*1024,'openFiles':128,'sourceBytes':10*1024*1024,'snapshotBytes':128*1024*1024,'pdfPages':2000,'cancelDeadlineMs':2000}

def sha(data):return hashlib.sha256(data).hexdigest()
def policy(job,executable=ENGINE):
    reads=['/usr/lib','/System/Library','/System/Volumes/Preboot','/private/var/db/dyld']
    filters=''.join('(subpath '+json.dumps(p,ensure_ascii=False)+')' for p in reads)
    filters+='(literal "/")(literal "/dev/null")(literal "/dev/random")(literal "/dev/urandom")'
    filters+=''.join('(literal '+json.dumps(str(p),ensure_ascii=False)+')' for p in [executable,BUNDLE])
    filters+='(subpath '+json.dumps(str(job),ensure_ascii=False)+')'
    writes=''.join('(subpath '+json.dumps(str(job/p),ensure_ascii=False)+')' for p in ['out','cache','home','tmp'])
    return '(version 1)(deny default)(allow process-exec (literal '+json.dumps(str(executable),ensure_ascii=False)+'))(allow process-info* (target self))(allow sysctl-read)(allow file-read* '+filters+')(allow file-write* '+writes+')'
def limits():
    resource.setrlimit(resource.RLIMIT_CPU,tuple(LIMITS['cpuSeconds']))
    resource.setrlimit(resource.RLIMIT_FSIZE,(LIMITS['outputFileBytes'],)*2)
    resource.setrlimit(resource.RLIMIT_NOFILE,(LIMITS['openFiles'],)*2)
def inspect_pdf(path):
    reader=PdfReader(path);fonts={};images=0;forms=0
    for page in reader.pages:
        res=page.get('/Resources',{}).get_object()
        for _,ref in res.get('/Font',{}).items():
            font=ref.get_object();descendants=font.get('/DescendantFonts') or [font]
            for ref2 in descendants:
                sub=ref2.get_object();desc=sub.get('/FontDescriptor')
                if desc:
                    desc=desc.get_object();fonts[str(font.get('/BaseFont'))]={'embedded':any(k in desc for k in ['/FontFile','/FontFile2','/FontFile3']),'unicodeMap':'/ToUnicode' in font}
        for _,ref in res.get('/XObject',{}).items():
            obj=ref.get_object();images+=obj.get('/Subtype')=='/Image';forms+=obj.get('/Subtype')=='/Form'
    # pypdf lacks a built-in Adobe-GB1 CMap fallback. Use the actual selected
    # product PDF.js parser + pinned local CMaps for text; retain pypdf result
    # rather than silently converting its CID codes into a false font failure.
    output=OUT/('predev-tex-'+path.parent.parent.name.removeprefix('probe-')+'-pdfjs.json')
    subprocess.run(['node',str(pathlib.Path(__file__).with_name('predev-tex-pdfjs-read.mjs')),str(path),str(output)],check=True,timeout=15)
    pdfjs=json.loads(output.read_text())
    return {'pages':len(reader.pages),'text':'\n'.join(page['text'] for page in pdfjs['pages']),'textReader':pdfjs['reader'],'pypdfText':'\n'.join(page.extract_text() or '' for page in reader.pages),'fonts':fonts,'images':images,'forms':forms,'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())}
def run(name,source,cold=False,cancel=None,timeout=None,extra=(),bundle=None,blank_pdf=False):
    job=ROOT/('probe-'+name)
    if job.exists():shutil.rmtree(job)
    for sub in ['out','home','cache','tmp','parts','images']:(job/sub).mkdir(parents=True,exist_ok=True)
    if not cold and (ROOT/'probe-latex-cold/cache').exists():shutil.copytree(ROOT/'probe-latex-cold/cache',job/'cache',dirs_exist_ok=True)
    (job/'main.tex').write_text(source)
    (job/'parts/section.tex').write_text('Nested local input succeeded.\\par\n')
    (job/'parts/中文章节.tex').write_text('本地章节内容。\\par\n')
    im=Image.new('RGB',(160,80),'#007d76');draw=ImageDraw.Draw(im);draw.rectangle((20,20,140,60),fill='#d3f4ec');im.save(job/'images/diagram.png')
    w=PdfWriter();page=w.add_blank_page(120,60)
    if blank_pdf:
        # Preserve the exact valid blank original. Only the private snapshot is
        # normalized: an absent Contents entry becomes a visually empty q/Q
        # stream so the fixed xdvipdfmx reader does not reject a null object.
        with (job/'images/original-blank.pdf').open('wb') as f:w.write(f)
        original_hash=sha((job/'images/original-blank.pdf').read_bytes())
    content=DecodedStreamObject();content.set_data(b'q\nQ\n' if blank_pdf else b'0 0.5 0.45 rg 5 5 110 50 re f\n')
    page[NameObject('/Contents')]=w._add_object(content)
    with (job/'images/vector.pdf').open('wb') as f:w.write(f)
    (job/'policy.sb').write_text(policy(job))
    args=['/usr/bin/sandbox-exec','-f',str(job/'policy.sb'),str(ENGINE),'-X','compile','--untrusted','--only-cached','--bundle',str(bundle or BUNDLE),'--keep-logs','--keep-intermediates','--outdir',str(job/'out'),*extra,'main.tex']
    env={'PATH':'/usr/bin:/bin','HOME':str(job/'home'),'TMPDIR':str(job/'tmp'),'XDG_CACHE_HOME':str(job/'cache'),'XDG_CONFIG_HOME':str(job/'home'),'TECTONIC_UNTRUSTED_MODE':'1'}
    started=time.monotonic();peak=0;stop=None
    with (job/'stdout.txt').open('wb') as so,(job/'stderr.txt').open('wb') as se:
        child=subprocess.Popen(args,cwd=job,env=env,stdout=so,stderr=se,start_new_session=True,preexec_fn=limits)
        while child.poll() is None:
            elapsed=time.monotonic()-started
            rss=subprocess.run(['/bin/ps','-o','rss=','-p',str(child.pid)],capture_output=True,text=True).stdout.strip()
            if rss.isdigit():peak=max(peak,int(rss))
            if cancel is not None and elapsed>=cancel:stop='cancelled'
            elif elapsed>=(timeout if timeout is not None else LIMITS['coldWallSeconds'] if cold else LIMITS['warmWallSeconds']):stop='timeout'
            elif peak>LIMITS['rssKillKiB']:stop='rss-limit'
            if stop:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=2);break
            time.sleep(.02)
    elapsed=round((time.monotonic()-started)*1000);pdf=job/'out/main.pdf';parsed=None
    if pdf.exists():parsed=inspect_pdf(pdf);shutil.copyfile(pdf,OUT/f'predev-tex-{name}.pdf')
    logs=(job/'stdout.txt').read_text(errors='replace')+(job/'stderr.txt').read_text(errors='replace')
    if (job/'out/main.log').exists():logs+='\n'+(job/'out/main.log').read_text(errors='replace')
    (OUT/f'predev-tex-{name}.tex').write_text(source)
    (OUT/f'predev-tex-{name}.log.txt').write_text(logs)
    result={'exit':child.returncode,'stop':stop,'elapsedMs':elapsed,'peakRssKiB':peak,'pdf':parsed,'sourceSHA256':sha(source.encode()),'logFile':f'predev-tex-{name}.log.txt','log':logs,'pid':child.pid,'cacheBytes':sum(p.stat().st_size for p in (job/'cache').rglob('*') if p.is_file())}
    if blank_pdf:result['blankPdfNormalization']={'originalSHA256':original_hash,'originalUnchanged':sha((job/'images/original-blank.pdf').read_bytes())==original_hash,'snapshotSHA256':sha((job/'images/vector.pdf').read_bytes()),'change':'Only absent Contents of synthetic blank page replaced with empty q/Q stream in private snapshot'}
    return result
def check(id,title,result,ok):
    if isinstance(result,dict):result=dict(result);result.pop('log',None)
    CHECKS.append({'id':id,'title':title,'status':'passed' if ok else 'failed','detail':result})
    print(id, 'passed' if ok else 'FAILED',flush=True)

basic=r'''\documentclass{article}
\usepackage{amsmath,amssymb,booktabs,graphicx,hyperref}
\title{WillYou LaTeX offline resource proof}\author{Synthetic fixture}\date{}
\begin{document}\maketitle\tableofcontents
\section{Mathematics}\label{sec:math}
\begin{align}a^2+b^2&=c^2\\ \int_0^1 x^2\,dx&=\frac13\end{align}
$\mathbb{R},\alpha,\sum_{k=1}^{n}k=\frac{n(n+1)}2$
\begin{tabular}{lr}\toprule Item&Value\\\midrule Offline&42\\\bottomrule\end{tabular}
\input{parts/section.tex}
\section{Images}\includegraphics[width=4cm]{images/diagram.png}
\includegraphics[width=3cm]{images/vector.pdf}
Reference resolves to Section~\ref{sec:math}.\end{document}
'''
r=run('latex-cold',basic,cold=True)
ok=r['exit']==0 and r['pdf'] and r['pdf']['pages']>=1 and 'Nested local input succeeded' in r['pdf']['text'] and 'Section 1' in r['pdf']['text'] and r['pdf']['images']>=1 and r['pdf']['forms']>=1 and all(f['embedded'] for f in r['pdf']['fonts'].values()) and 'Missing character' not in r['log']
check('PRETEX-01','冷启动：真实 LaTeX/数学/表格/PNG/PDF/include/交叉引用，全字体嵌入',r,ok)
cjk=r'''\documentclass[fontset=fandol]{ctexart}
\usepackage{amsmath,graphicx,booktabs}
\begin{document}\section{中文离线排版}
这是中文、English 与数学混排。\textbf{粗体中文}，\textit{楷体中文}。
\[\int_0^1 x^2\,dx=\frac13,\qquad a^2+b^2=c^2\]
\input{parts/中文章节.tex}
\includegraphics[width=4cm]{images/diagram.png}
\begin{tabular}{ll}\toprule 名称&状态\\\midrule 离线字体&可用\\\bottomrule\end{tabular}
\end{document}
'''
r=run('cjk-math-images',cjk)
ok=r['exit']==0 and r['pdf'] and '中文离线排版' in r['pdf']['text'] and '本地章节内容' in r['pdf']['text'] and any('Fandol' in f for f in r['pdf']['fonts']) and all(f['embedded'] for f in r['pdf']['fonts'].values()) and 'Missing character' not in r['log']
check('PRETEX-02','中文正向：内置 Fandol 字体，中英数学与图片、中文路径',r,ok)
unicode=r'''\documentclass{article}\usepackage{fontspec,unicode-math}
\setmainfont{texgyretermes-regular.otf}\setmathfont{latinmodern-math.otf}
\begin{document}WillYou Unicode mathematics: $\symbb{R},\sum_{i=1}^{n}i,\int_0^1x^2\,dx,\sqrt{2},\alpha+\beta$.\end{document}
'''
r=run('unicode-math',unicode)
check('PRETEX-03','OpenType 数学字体正向，不依赖用户安装字体',r,r['exit']==0 and bool(r['pdf']) and all(f['embedded'] for f in r['pdf']['fonts'].values()) and 'Missing character' not in r['log'])
multi=r'\documentclass[fontset=fandol]{ctexart}\usepackage{amsmath}\begin{document}'+'\n'.join(r'\section*{第 '+str(i)+r' 页} 固定离线资源。$a^2+b^2=c^2$'+(r'\newpage' if i<12 else '') for i in range(1,13))+r'\end{document}'
r=run('twelve-pages',multi)
check('PRETEX-04','12页中文数学文档全页可重读',r,r['exit']==0 and bool(r['pdf']) and r['pdf']['pages']==12 and all('固定离线资源' in page['text'] for page in json.loads((OUT/'predev-tex-twelve-pages-pdfjs.json').read_text())['pages']))
bad=run('missing-package',r'\documentclass{article}\usepackage{willYouMissingPackageCanary}\begin{document}No success\end{document}')
check('PRETEX-05','缺包单列失败，绝不联网补包或把残留产物作为成功',bad,bad['exit']!=0 and not bad['pdf'] and 'willYouMissingPackageCanary' in bad['log'])
outside=ROOT/'outside-secret.tex';outside.write_text('PRIVATE-PREDEV-CANARY\n')
bad=run('outside-read',r'\documentclass{article}\begin{document}\input{'+str(outside)+r'}\end{document}')
check('PRETEX-06','完整资源下仍拒绝根外读',bad,bad['exit']!=0 and (not bad['pdf'] or 'PRIVATE-PREDEV-CANARY' not in bad['pdf']['text']))
marker=ROOT/'shell-must-not-run';marker.unlink(missing_ok=True)
shell=run('shell-disabled',r'\documentclass{article}\begin{document}\immediate\write18{touch '+str(marker)+r'}Shell disabled.\end{document}',extra=('-Z','shell-escape'))
check('PRETEX-07','完整资源下 shell escape 仍禁用',shell,shell['exit']==0 and not marker.exists())
loop=r'\documentclass{article}\begin{document}\newcount\n\loop\advance\n by1\iftrue\repeat\end{document}'
c=run('cancel',loop,cancel=.2)
check('PRETEX-08','完整格式缓存下真实无限循环可取消',c,c['stop']=='cancelled' and c['exit']==-signal.SIGKILL and c['elapsedMs']<LIMITS['cancelDeadlineMs'] and not c['pdf'])
t=run('timeout',loop,timeout=.8)
check('PRETEX-09','完整格式缓存下真实无限循环超时被终止',t,t['stop']=='timeout' and t['exit']==-signal.SIGKILL and t['elapsedMs']<2500 and not t['pdf'])
net=ROOT/'probe-network'
for sub in ['out','cache','home','tmp']:(net/sub).mkdir(parents=True,exist_ok=True)
(net/'policy.sb').write_text(policy(net,pathlib.Path('/usr/bin/curl')))
result=subprocess.run(['/usr/bin/sandbox-exec','-f',str(net/'policy.sb'),'/usr/bin/curl','--noproxy','*','--connect-timeout','1','http://127.0.0.1:9/'],capture_output=True,text=True)
check('PRETEX-10','资源包编译策略禁止网络 socket',{'exit':result.returncode,'stderr':result.stderr},result.returncode!=0 and 'not permitted' in result.stderr)
r=run('blank-pdf-normalized',basic,blank_pdf=True)
check('PRETEX-11','有效空 PDF 图片：仅规范化私有快照的缺失 Contents，原件不改',r,r['exit']==0 and bool(r['pdf']) and r['pdf']['forms']>=1 and r['blankPdfNormalization']['originalUnchanged'])
report={'schema':'m9-predev-tex-offline-v1','timestamp':datetime.now(timezone.utc).isoformat(),'environment':{'system':os.uname().sysname,'release':os.uname().release,'arch':os.uname().machine},'engine':{'version':'0.17.0','binarySHA256':sha(ENGINE.read_bytes()),'bytes':ENGINE.stat().st_size},'resources':{k:v for k,v in MANIFEST.items() if k not in ['files','packages']},'limits':LIMITS,'policy':policy(ROOT/'probe-latex-cold'),'checks':CHECKS,'summary':{'passed':sum(c['status']=='passed' for c in CHECKS),'failed':sum(c['status']=='failed' for c in CHECKS)},'boundary':'Isolated native macOS arm64, real fixed resources and synthetic files. Not App integration, cross-platform validation, arbitrary packages, editable source fidelity or release license approval.'}
(OUT/'predev-tex-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report['summary']),flush=True)
sys.exit(0 if report['summary']['failed']==0 else 1)
