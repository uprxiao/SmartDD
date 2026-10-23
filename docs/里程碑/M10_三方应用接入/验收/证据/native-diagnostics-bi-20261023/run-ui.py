from pathlib import Path
from datetime import datetime,timezone
import subprocess,json
p=Path('/private/tmp/m10-native-diagnostics-bi-20261023');args=['pnpm','test','src/renderer/features/applications/session-applications.test.tsx','--maxWorkers=1','--testTimeout=15000','--reporter=default','--reporter=json','--outputFile='+str(p/'ui-full-report.json')];start=datetime.now(timezone.utc).isoformat()
with(p/'ui-full.txt').open('w')as out:r=subprocess.run(args,cwd=p/'candidate',stdout=out,stderr=subprocess.STDOUT)
(p/'ui-full-result.json').write_text(json.dumps({'command':args,'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode},indent=2)+'\n');print('UI full exit',r.returncode)
