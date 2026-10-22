from pathlib import Path
from datetime import datetime,timezone
import subprocess,json,time
p=Path('/private/tmp/m10-native-omissions-bc-20261022');t=p/'candidate2';args=['pnpm','test','src/main/core/applications/__tests__/task-capability-launcher.test.ts','--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(p/'candidate2-final-main-report.json')];start=datetime.now(timezone.utc).isoformat();samples=[];lastwall=time.time();lastmono=time.monotonic()
with(p/'candidate2-final-main.txt').open('w')as out:
 proc=subprocess.Popen(args,cwd=t,stdout=out,stderr=subprocess.STDOUT)
 while proc.poll() is None:
  try:proc.wait(timeout=1)
  except subprocess.TimeoutExpired:pass
  wall=time.time();mono=time.monotonic();wd=wall-lastwall;md=mono-lastmono
  if wd>5 or md>5:samples.append({'at':datetime.now(timezone.utc).isoformat(),'wallGap':wd,'monotonicGap':md})
  lastwall=wall;lastmono=mono
(p/'candidate2-final-main-result.json').write_text(json.dumps({'command':args,'cwd':str(t),'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':proc.returncode,'sourceAndAssertionsUnchanged':True,'observerSchedulingGapsOver5s':samples,'observerLimitation':'External Python observer only;does not identify test-event-loop stalls or prove prior delay cause'},indent=2)+'\n');print('final main exit',proc.returncode,flush=True);raise SystemExit(proc.returncode)
