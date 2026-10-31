from pathlib import Path
from datetime import datetime,timezone
import subprocess,json,sys,time
p=Path('/private/tmp/m10-native-diagnostics-bi-20261023');w=p/'candidate';kind=sys.argv[1];files=['src/main/core/applications/__tests__/task-capability-launcher.test.ts']if kind=='main'else json.loads((p/'related-files.json').read_text());args=['pnpm','test',*files,'--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(p/(kind+'-full-report.json'))];start=datetime.now(timezone.utc).isoformat();gaps=[];wall=time.time();mono=time.monotonic()
with(p/(kind+'-full.txt')).open('w')as out:
 proc=subprocess.Popen(args,cwd=w,stdout=out,stderr=subprocess.STDOUT)
 while proc.poll()is None:
  try:proc.wait(timeout=1)
  except subprocess.TimeoutExpired:pass
  nw=time.time();nm=time.monotonic()
  if nw-wall>5 or nm-mono>5:gaps.append({'at':datetime.now(timezone.utc).isoformat(),'wallGap':nw-wall,'monotonicGap':nm-mono})
  wall=nw;mono=nm
(p/(kind+'-full-result.json')).write_text(json.dumps({'command':args,'cwd':str(w),'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':proc.returncode,'observerGapsOver5s':gaps,'observerLimitation':'separate Python process,not a test event loop observer'},indent=2)+'\n');print(kind,'full exit',proc.returncode,flush=True);raise SystemExit(proc.returncode)
