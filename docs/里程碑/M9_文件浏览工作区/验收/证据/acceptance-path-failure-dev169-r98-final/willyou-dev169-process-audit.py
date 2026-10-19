from pathlib import Path
import datetime,json,subprocess
folders=[*Path('/private/tmp').glob('willyou-path-failure-A-*'),*Path('/private/tmp').glob('willyou-path-failure-P-*'),*[Path('/private/tmp')/n for n in['willyou-path-drop-P-38FFGI','willyou-path-drop-P-jQRgbW','willyou-path-drop-P-7JQDhC']]];rows=[]
for folder in sorted(folders):
 x=json.loads((folder/'result.json').read_text());pids=[x['pid']]
 for p in folder.glob('T*/sessions/*/identity.json'):pids.append(json.loads(p.read_text())['pid'])
 for pid in pids:
  r=subprocess.run(['ps','-p',str(pid),'-o','pid=,command='],capture_output=True,text=True);assert not r.stdout.strip(),(pid,r.stdout)
 rows.append({'folder':str(folder),'pids':pids,'allAbsent':True,'status':x['status'],'exit':x.get('exit')})
r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','knownOwnApps':len(rows),'knownOwnProcesses':sum(len(x['pids'])for x in rows),'rows':rows};Path('/private/tmp/willyou-dev169-process-audit.json').write_text(json.dumps(r,indent=2)+'\n');print({k:v for k,v in r.items()if k!='rows'})
