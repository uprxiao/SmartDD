from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,sys
p=Path('/private/tmp/m10-maintenance-bf-20261023');kind=sys.argv[1];args=['pnpm','test','src/main/core/applications/__tests__/discovery-catalog.test.ts','src/main/core/applications/__tests__/task-capability-launcher.test.ts','--maxWorkers=1','--testTimeout=15000','-t','ordinary native work while actual H publication waits|authenticated native guard admission while H maintenance waits','--reporter=json','--reporter=default','--outputFile='+str(p/(kind+'-report.json'))];start=datetime.now(timezone.utc).isoformat()
with(p/(kind+'.txt')).open('w')as out:r=subprocess.run(args,cwd=p/'candidate',stdout=out,stderr=subprocess.STDOUT)
(p/(kind+'-result.json')).write_text(json.dumps({'command':args,'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode},indent=2)+'\n');print(kind,'exit',r.returncode,flush=True)
