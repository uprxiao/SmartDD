from pathlib import Path
from datetime import datetime,timezone
import subprocess,json,sys
p=Path('/private/tmp/m10-native-diagnostics-bi-20261023');kind=sys.argv[1];files=json.loads((p/'selected-files.json').read_text());args=['pnpm','test',*files,'--maxWorkers=1','--testTimeout=15000','-t','host-only exact Skill configuration source diagnostics|immutable versioned per-capability preparation display evidence|visible per-capability preparation and exact conflict locations|actual host preparation records independent native diagnostics|application conflict source disclosure uses this run only|bounded host source attribution lookup','--reporter=default','--reporter=json','--outputFile='+str(p/(kind+'-report.json'))];start=datetime.now(timezone.utc).isoformat()
with(p/(kind+'.txt')).open('w')as out:r=subprocess.run(args,cwd=p/'candidate',stdout=out,stderr=subprocess.STDOUT)
(p/(kind+'-result.json')).write_text(json.dumps({'command':args,'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode},indent=2)+'\n');print(kind,'exit',r.returncode,flush=True)
