from pathlib import Path
import json,subprocess,datetime
paths=[*Path('/private/tmp').glob('willyou-parse-cancel-A-*'),Path('/private/tmp/willyou-pdf-lifecycle-I-Ne0Ued')];rows=[]
for p in paths:
 d=json.loads((p/'result.json').read_text());rows.append({'directory':str(p),'pid':d.get('pid'),'status':d['status'],'normalExit':d.get('exit'),'checks':len(d['checks'])})
raw=subprocess.check_output(['ps','-axww','-o','pid=,command='],text=True);remaining=[]
for line in raw.splitlines():
 parts=line.strip().split(None,1)
 if len(parts)<2:continue
 pid=int(parts[0]);cmd=parts[1]
 if any(str(p)in cmd for p in paths)or any(x['pid']==pid for x in rows)and '/WillYou.app/'in cmd:remaining.append({'pid':pid,'ownedMatch':True})
assert not remaining;d={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runs':rows,'remainingProcesses':remaining,'boundary':'Exact owned test directories/main PIDs only; final A and I normal quit0/null, initial driver failure cleanup separate. Contract hidden BrowserWindow destroyed in I result.'};Path('/private/tmp/willyou-dev147-process-audit.json').write_text(json.dumps(d,indent=2)+'\n');print(json.dumps(d))
