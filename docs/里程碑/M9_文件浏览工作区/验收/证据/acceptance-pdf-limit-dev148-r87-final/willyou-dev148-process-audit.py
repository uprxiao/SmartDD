from pathlib import Path
import json,subprocess,datetime
p=Path('/private/tmp/willyou-pdf-limit-A-OcKZDX');d=json.loads((p/'result.json').read_text());raw=subprocess.check_output(['ps','-axww','-o','pid=,command='],text=True);rows=[]
for line in raw.splitlines():
 parts=line.strip().split(None,1)
 if len(parts)>1 and(str(p)in parts[1]or int(parts[0])==d['pid']and'/WillYou.app/'in parts[1]):rows.append({'pid':int(parts[0]),'ownedMatch':True})
assert not rows;r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runDirectory':str(p),'pid':d['pid'],'normalExit':d['exit'],'remainingProcesses':rows,'boundary':'Exact isolated directory and original App PID/executable only; no unrelated App operation.'};Path('/private/tmp/willyou-dev148-process-audit.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
