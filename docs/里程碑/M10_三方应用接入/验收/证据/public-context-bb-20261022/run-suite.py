from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,sys
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-public-context-bb-20261022');kind=sys.argv[1]
files=['src/main/core/applications/__tests__/task-capability-launcher.test.ts'] if kind=='main' else json.loads((e/'related-files.json').read_text())
args=['pnpm','test',*files,'--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(e/(kind+'-full-report.json'))];start=datetime.now(timezone.utc).isoformat()
with (e/(kind+'-full.txt')).open('w') as out:r=subprocess.run(args,cwd=w,stdout=out,stderr=subprocess.STDOUT)
(e/(kind+'-full-result.json')).write_text(json.dumps({'command':args,'cwd':str(w),'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode},indent=2)+'\n');print(kind,'exit',r.returncode,flush=True);raise SystemExit(r.returncode)
