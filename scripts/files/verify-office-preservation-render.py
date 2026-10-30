"""Separate existing LibreOffice CLI/profile readback of owned synthetic files.
Not the product sandbox, and never an original-source conversion in place.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, signal, subprocess, sys, time
from pypdf import PdfReader

b=Path(sys.argv[1]);app=Path(sys.argv[2]);r=json.loads((b/'result.json').read_text())
assert r['status']=='selected-normal-text-edits-and-approved-DOCX-readonly-passed;formal-Y10-pending'
lo=app/'Contents/Resources/native/libreoffice/LibreOffice.app/Contents/MacOS/soffice'
assert lo.is_file()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
out={'at':datetime.now(timezone.utc).isoformat(),'status':'running','AppReport':str(b/'result.json'),'runtime':str(lo),'checks':[],'boundary':'Separate pinned existing LibreOffice CLI, independent output/profile per synthetic source, default headless PDF conversion. Not product sandbox/App GUI proof or a repair of W26; independent45s reader budget only, product20/30s budgets unchanged. No install/download/macro code/default profile or source overwrite. DOCX is readonly only and does not fulfill original manual-edit step.'}
try:
    for c in r['checks']:
        name=c['theme']+'.'+c['kind'];source=Path(r['corpus'][name]['path'])
        target=b/('reader-'+c['theme']+'-'+c['kind']);target.mkdir(exist_ok=False)
        before=sha(source);stat=source.stat();beforeStat=(stat.st_ino,stat.st_mtime_ns)
        args=[str(lo),'-env:UserInstallation='+(target/'profile').as_uri(),'--headless','--norestore','--nodefault','--nofirststartwizard','--convert-to','pdf','--outdir',str(target),str(source)]
        p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True,env={'PATH':'/usr/bin:/bin','TMPDIR':'/private/tmp'})
        row={'source':str(source),'kind':c['kind'],'theme':c['theme'],'pid':p.pid,'args':args,'started':datetime.now(timezone.utc).isoformat()};out['checks'].append(row)
        print(json.dumps({'start':name,'pid':p.pid,'output':str(target)}),flush=True)
        try:stdout,stderr=p.communicate(timeout=45)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid,signal.SIGKILL);stdout,stderr=p.communicate(timeout=5);row['timedOut']=True
            raise RuntimeError('Independent reader timed out for '+name)
        finally:
            row['stdout']=locals().get('stdout','');row['stderr']=locals().get('stderr','');row['exit']=p.returncode
            (target/'command.json').write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n')
        assert p.returncode==0,(name,stdout,stderr)
        pdf=target/(source.stem+'.pdf');assert pdf.is_file()
        document=PdfReader(pdf);pageTexts=[page.extract_text()or''for page in document.pages];text='\n'.join(pageTexts)
        expected=r['corpus'][name]['fixture']['target'].get('newText','DOCX_READONLY_BASELINE')
        assert expected in text,(name,expected,text)
        (target/'text.txt').write_text(text)
        # Render the page carrying the actual new string, then inspect separately.
        pageNumber=next(i+1 for i,text in enumerate(pageTexts)if expected in text)
        png=target/'verified-page.png';render=subprocess.run(['/opt/homebrew/bin/pdftoppm','-f',str(pageNumber),'-l',str(pageNumber),'-singlefile','-scale-to','1400','-png',str(pdf),str(target/'verified-page')],capture_output=True,text=True,timeout=20)
        assert render.returncode==0,(render.stdout,render.stderr);assert png.is_file()
        after=source.stat();assert sha(source)==before and (after.st_ino,after.st_mtime_ns)==beforeStat
        row.update(pages=len(document.pages),verifiedPage=pageNumber,expectedText=expected,pdfSha256=sha(pdf),pngSha256=sha(png),sourceSha256=before,sourceStatUnchanged=True,pass_=True)
        print(json.dumps({'passed':name,'pages':row['pages'],'text':expected}),flush=True)
    out['status']='passed-separate-engine-readback;formal-Y10-pending'
except BaseException as error:
    out['status']='failed';out['error']=str(error)
    raise
finally:
    out['finishedAt']=datetime.now(timezone.utc).isoformat()
    (b/'independent-LibreOffice-render.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
