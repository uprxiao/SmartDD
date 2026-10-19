import json,os,subprocess,sys,time
from pathlib import Path
base=Path('/private/tmp');env={**os.environ,'WILLYOU_FILES_APP':'/private/tmp/willyou-m9-acceptance-batch-r57-build/mac-arm64/WillYou.app/Contents/MacOS/WillYou'}
runs=[]
for name,driver in [('name-limit','scripts/files/name-limit-ui.mjs'),('fuzzy','scripts/files/fuzzy-ranking-ui.mjs'),('names','scripts/files/name-search-ui.mjs'),('search','scripts/files/search-race-ui.mjs')]:
 log=base/('willyou-dev104-'+name+'-final-r57.log');started=time.time()
 with log.open('w') as out:result=subprocess.run(['node',driver],env=env,stdout=out,stderr=subprocess.STDOUT)
 row={'name':name,'driver':driver,'exitCode':result.returncode,'log':str(log),'elapsedSeconds':round(time.time()-started,3)}
 for line in log.read_text().splitlines():
  try:value=json.loads(line)
  except Exception:continue
  if isinstance(value,dict)and'artifacts'in value:row['result']=value
 runs.append(row);print(json.dumps(row),flush=True)
 (base/'willyou-dev104-app-final.json').write_text(json.dumps({'runs':runs},indent=2)+'\n')
 if result.returncode!=0 or row.get('result',{}).get('status')!='passed':sys.exit(1)
sys.exit(0 if all(r['exitCode']==0 and r.get('result',{}).get('status')=='passed'for r in runs)else 1)
