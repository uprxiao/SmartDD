from pathlib import Path
from datetime import datetime,timezone
import subprocess,json
p=Path('/private/tmp/m10-native-omissions-bc-20261022');w=p/'candidate2';args=['pnpm','test','src/main/core/applications/__tests__/task-capability-launcher.test.ts','--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(p/'candidate2-main-report.json')];start=datetime.now(timezone.utc).isoformat()
with(p/'candidate2-main.txt').open('w')as out:r=subprocess.run(args,cwd=w,stdout=out,stderr=subprocess.STDOUT)
(p/'candidate2-main-result.json').write_text(json.dumps({'command':args,'cwd':str(w),'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode},indent=2)+'\n');print('candidate2 main exit',r.returncode,flush=True);raise SystemExit(r.returncode)
