from pathlib import Path
from datetime import datetime,timezone
import subprocess,json
p=Path('/private/tmp/m10-native-omissions-bc-20261022');t=p/'candidate2';args=['pnpm','test','src/main/core/applications/__tests__/task-capability-launcher.test.ts','--maxWorkers=1','--testTimeout=15000','-t','resumes Codex with original Mail|permits scoped Mail new and resume','--reporter=verbose','--reporter=json','--outputFile='+str(p/'history-retest-report.json')];start=datetime.now(timezone.utc).isoformat()
with(p/'history-retest.txt').open('w')as out:r=subprocess.run(args,cwd=t,stdout=out,stderr=subprocess.STDOUT)
(p/'history-retest-result.json').write_text(json.dumps({'command':args,'cwd':str(t),'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode,'sourceUnchanged':True},indent=2)+'\n');print('history retest exit',r.returncode,flush=True);raise SystemExit(r.returncode)
