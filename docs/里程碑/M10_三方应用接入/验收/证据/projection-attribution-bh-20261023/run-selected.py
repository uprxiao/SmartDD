from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,sys
p=Path('/private/tmp/m10-projection-attribution-bh-20261023');kind=sys.argv[1];args=['pnpm','test','src/main/core/applications/__tests__/discovery-catalog.test.ts','src/main/core/applications/__tests__/task-capability-launcher.test.ts','--maxWorkers=1','--testTimeout=15000','-t','read-only attribution of registered damaged H versus user occupation|classified original H content failure keeps healthy actual application work|registered H damage and independent native conflicts','--reporter=json','--reporter=default','--outputFile='+str(p/(kind+'-report.json'))];start=datetime.now(timezone.utc).isoformat()
with(p/(kind+'.txt')).open('w')as out:r=subprocess.run(args,cwd=p/'candidate',stdout=out,stderr=subprocess.STDOUT)
(p/(kind+'-result.json')).write_text(json.dumps({'command':args,'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode},indent=2)+'\n');print(kind,'exit',r.returncode,flush=True)
