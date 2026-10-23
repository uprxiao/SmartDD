from pathlib import Path
from datetime import datetime,timezone
import subprocess,json
r=Path('/private/tmp/m10-native-mail-context-bj-20261023');args=['pnpm','test','src/main/core/applications/__tests__/mail-send-data.test.ts','--maxWorkers=1','--testTimeout=15000','-t','ordered authenticated earlier mail context|resolves the immediately preceding genuine','--reporter=verbose','--reporter=json','--outputFile='+str(r/'red-report.json')];at=datetime.now(timezone.utc).isoformat()
with(r/'red.txt').open('w')as out:p=subprocess.run(args,cwd=r/'candidate',stdout=out,stderr=subprocess.STDOUT)
(r/'red-result.json').write_text(json.dumps({'command':args,'startedAt':at,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':p.returncode,'layer':'software real local host/SQLite/bundles+loopback SMTP/synthetic native user records;not real Agent or App'},indent=2)+'\n');print('red exit',p.returncode,flush=True);raise SystemExit(p.returncode)
