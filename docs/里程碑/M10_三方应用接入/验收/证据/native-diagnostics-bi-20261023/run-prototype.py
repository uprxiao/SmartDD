from pathlib import Path
from datetime import datetime,timezone
import subprocess,json,os,hashlib
p=Path('/private/tmp/m10-native-diagnostics-bi-20261023');w=p/'candidate/prototypes/m6-codex';files=sorted(str(f.relative_to(w))for f in (w/'tests').glob('*integration*.test.mjs'));assert files;commands=[['node','--test',*files],['npm','run','build']];results=[]
for name,args in zip(['prototype-model','prototype-build'],commands):
 start=datetime.now(timezone.utc).isoformat()
 with(p/(name+'.txt')).open('w')as out:r=subprocess.run(args,cwd=w,stdout=out,stderr=subprocess.STDOUT,env={**os.environ,'npm_config_cache':str(p/'npm-cache')})
 result={'command':args,'cwd':str(w),'startedAt':start,'endedAt':datetime.now(timezone.utc).isoformat(),'exitCode':r.returncode};(p/(name+'-result.json')).write_text(json.dumps(result,indent=2)+'\n');print(name,'exit',r.returncode,flush=True);results.append(result)
 if r.returncode:raise SystemExit(r.returncode)
manifest=json.loads((p/'prototype-inputs.json').read_text())['files']
for r in manifest:assert hashlib.sha256((p/'candidate'/r['path']).read_bytes()).hexdigest()==r['candidateSha256'],r['path']
print('prototype full source hashes unchanged;build generated only private dist',flush=True)
