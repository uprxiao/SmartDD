from pathlib import Path
from datetime import datetime,timezone
import subprocess,json,sys
p=Path('/private/tmp/m10-native-diagnostics-bi-20261023');kind=sys.argv[1];args=['pnpm','test','src/main/core/applications/__tests__/native-diagnostic-cost.test.ts','--maxWorkers=1','--reporter=json','--reporter=default','--outputFile='+str(p/(kind+'-report.json'))];start=datetime.now(timezone.utc).isoformat()
with(p/(kind+'.txt')).open('w')as out:r=subprocess.run(args,cwd=p/'candidate',stdout=out,stderr=subprocess.STDOUT)
(p/(kind+'-result.json')).write_text(json.dumps({'command':args,'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode},indent=2)+'\n');print(kind,'exit',r.returncode)
