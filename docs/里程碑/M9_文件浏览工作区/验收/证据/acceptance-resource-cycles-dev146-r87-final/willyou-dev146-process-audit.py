from pathlib import Path
import json,subprocess,datetime
paths=sorted(Path('/private/tmp').glob('willyou-resource-cycle-A-*'));runs=[];pids=set()
for p in paths:
 d=json.loads((p/'result.json').read_text());runs.append({'directory':str(p),'pid':d.get('pid'),'status':d['status'],'normalExit':d.get('exit'),'checks':len(d['checks'])});pids.add(d['pid'])
raw=subprocess.check_output(['ps','-axww','-o','pid=,command='],text=True);remaining=[]
for line in raw.splitlines():
 parts=line.strip().split(None,1)
 if len(parts)<2:continue
 pid=int(parts[0]);cmd=parts[1]
 if any(str(p)in cmd for p in paths) or pid in pids and '/WillYou.app/'in cmd:remaining.append({'pid':pid,'matchedOwnedRun':True})
a={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runs':runs,'remainingProcesses':remaining,'boundary':'Only exact owned run directories or recorded original App PIDs/executable, no termination of unrelated Apps. Final two normal quits0/null; initial driver failure cleanup separate.'};assert not remaining;Path('/private/tmp/willyou-dev146-process-audit.json').write_text(json.dumps(a,indent=2)+'\n');print(json.dumps(a))
