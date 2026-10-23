from pathlib import Path
from datetime import datetime,timezone
import subprocess,json
r=Path('/private/tmp/m10-native-mail-context-bj-20261023');args=['pnpm','test',*json.loads((r/'full-files.json').read_text()),'--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(r/'full-report.json')];at=datetime.now(timezone.utc).isoformat()
with(r/'full.txt').open('w')as out:p=subprocess.run(args,cwd=r/'candidate',stdout=out,stderr=subprocess.STDOUT)
(r/'full-result.json').write_text(json.dumps({'command':args,'startedAt':at,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':p.returncode,'layer':'software actual local host/SQLite/bundles+loopback SMTP;synthetic native user records,no actual Agent or App'},indent=2)+'\n');print('full exit',p.returncode,flush=True);raise SystemExit(p.returncode)
