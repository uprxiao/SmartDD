from pathlib import Path
from datetime import datetime,timezone
import subprocess,json
p=Path('/private/tmp/m10-legacy-guard-bd-20261022');w=p/'candidate';args=['pnpm','test','src/main/core/applications/__tests__/task-capability-launcher.test.ts','--maxWorkers=1','--testTimeout=15000','-t','registered legacy H damage retains ordinary native work','--reporter=verbose','--reporter=json','--outputFile='+str(p/'fix1-report.json')];start=datetime.now(timezone.utc).isoformat()
with(p/'fix1.txt').open('w')as out:r=subprocess.run(args,cwd=w,stdout=out,stderr=subprocess.STDOUT)
(p/'fix1-result.json').write_text(json.dumps({'command':args,'cwd':str(w),'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode},indent=2)+'\n');print('legacy fix1 exit',r.returncode,flush=True);raise SystemExit(r.returncode)
