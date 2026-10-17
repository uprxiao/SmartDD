#!/usr/bin/env python3
"""Run installed LO only on the isolated generated sample directory."""
import argparse,hashlib,json,pathlib,subprocess,tempfile,time,os,signal
p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args();root=pathlib.Path(a.root).resolve();report={'scope':'Synthetic Office rendering by real LibreOffice; not Microsoft Office acceptance','cases':[],'budget':{'timeoutSeconds':20,'cancelSeconds':5},'scriptSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
for name in ['rich-edited.pptx','rich-cloned.pptx','rich-clone-removed.pptx','rich-rename-final.xlsx','rich-delete-final.xlsx']:
 source=root/name;dest=root/('render-'+source.stem);dest.mkdir(exist_ok=True)
 args=['/usr/bin/time','-l','/Applications/LibreOffice.app/Contents/MacOS/soffice','-env:UserInstallation='+(dest/'profile').as_uri(),'--headless','--norestore','--nodefault','--convert-to','pdf','--outdir',str(dest),str(source)]
 t=time.monotonic();proc=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 try:stdout,stderr=proc.communicate(timeout=20)
 except subprocess.TimeoutExpired:
  os.killpg(proc.pid,signal.SIGKILL);stdout,stderr=proc.communicate();report['cases'].append({'file':name,'status':'failed','reason':'20s timeout'});continue
 (dest/'stdout.txt').write_bytes(stdout);(dest/'stderr.txt').write_bytes(stderr);pdf=dest/(source.stem+'.pdf')
 facts={'file':name,'durationMs':round((time.monotonic()-t)*1000,2),'exitCode':proc.returncode,'pdfExists':pdf.exists(),'command':args}
 if pdf.exists():
  text=subprocess.run(['pdftotext','-layout',str(pdf),'-'],capture_output=True,check=True).stdout.decode();(dest/'text.txt').write_text(text);facts.update({'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'pdfBytes':pdf.stat().st_size,'text':text})
  if name.endswith('.pptx'):facts['status']='passed' if all(v in text for v in ['TABLE_EDITED','UNCHANGED_CELL','MASTER_TITLE','OTHER_SLIDE']) else 'failed'
  else:facts['status']='observed-limitation' if '#NAME?' in text else 'passed'
 else:facts['status']='failed'
 report['cases'].append(facts)
(root/'render-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps([{k:v for k,v in c.items() if k not in ['command','text']} for c in report['cases']],ensure_ascii=False,indent=2))
