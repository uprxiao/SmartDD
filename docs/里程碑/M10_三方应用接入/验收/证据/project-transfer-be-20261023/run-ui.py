from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,sys
p=Path('/private/tmp/m10-project-transfer-be-20261023');w=p/'candidate';kind=sys.argv[1];args=['pnpm','test','src/renderer/views/projects/project-transfer.test.tsx','--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(p/(kind+'-report.json'))];start=datetime.now(timezone.utc).isoformat()
with(p/(kind+'.txt')).open('w')as out:r=subprocess.run(args,cwd=w,stdout=out,stderr=subprocess.STDOUT)
(p/(kind+'-result.json')).write_text(json.dumps({'command':args,'cwd':str(w),'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode},indent=2)+'\n');print(kind,'exit',r.returncode,flush=True);raise SystemExit(r.returncode)
