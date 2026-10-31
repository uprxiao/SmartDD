from pathlib import Path
from datetime import datetime,timezone
import subprocess,json,sys
r=Path('/private/tmp/m10-native-mail-literal-bk-20261023');label=sys.argv[1];args=['pnpm','test','src/main/core/applications/__tests__/mail-send-data.test.ts','--maxWorkers=1','--testTimeout=15000','-t','authenticated literal mail fields|resolves the immediately preceding genuine','--reporter=verbose','--reporter=json','--outputFile='+str(r/(label+'-report.json'))];at=datetime.now(timezone.utc).isoformat()
with(r/(label+'.txt')).open('w')as out:p=subprocess.run(args,cwd=r/'candidate',stdout=out,stderr=subprocess.STDOUT)
(r/(label+'-result.json')).write_text(json.dumps({'command':args,'startedAt':at,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':p.returncode,'layer':'software local host/SQLite/bundles+loopback SMTP;synthetic native user records;not actual Agent/App'},indent=2)+'\n');print(label,'exit',p.returncode,flush=True);raise SystemExit(p.returncode)
