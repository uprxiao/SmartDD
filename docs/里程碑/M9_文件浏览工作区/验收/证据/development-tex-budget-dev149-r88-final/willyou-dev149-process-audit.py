from pathlib import Path
import json,subprocess,datetime
p=Path('/private/tmp/willyou-pdf-limit-A-qirUeK');d=json.loads((p/'result.json').read_text());raw=subprocess.check_output(['ps','-axww','-o','pid=,command='],text=True);remaining=[]
for line in raw.splitlines():
 parts=line.strip().split(None,1)
 if len(parts)>1 and(str(p)in parts[1]or int(parts[0])==d['pid']and'/WillYou.app/'in parts[1]):remaining.append({'pid':int(parts[0]),'ownedMatch':True})
assert not remaining;r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runDirectory':str(p),'pid':d['pid'],'normalExit':d['exit'],'remainingProcesses':remaining,'boundary':'Only exact ownApp/profile path andoriginalPID/executable; no otherApp operation.'};Path('/private/tmp/willyou-dev149-process-audit.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
