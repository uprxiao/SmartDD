from pathlib import Path
import json,subprocess,datetime
paths=[Path('/private/tmp')/n/'result.json'for n in ['willyou-pptx-preview-A-RvOP1E','willyou-pptx-preview-A-HmLMMp','willyou-pptx-preview-A-CnnfgL','willyou-pptx-preview-P-q0ZRgV','willyou-pptx-preview-P-G9a5Ut']];rows=[]
for p in paths:
 x=json.loads(p.read_text());pid=x['pid'];r=subprocess.run(['ps','-p',str(pid),'-o','pid=,command='],capture_output=True,text=True);assert not r.stdout.strip(),(pid,r.stdout);rows.append({'result':str(p),'pid':pid,'status':x['status'],'parentAbsent':True,'exit':x.get('exit')})
print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','knownParentsAbsent':True,'rows':rows},indent=2))
