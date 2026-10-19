import json,os,subprocess
from pathlib import Path
env=dict(os.environ,WILLYOU_FILES_APP='/private/tmp/willyou-m9-acceptance-batch-r58-build/mac-arm64/WillYou.app/Contents/MacOS/WillYou');runs=[]
for name,driver in [('input','search-input-limit-ui.mjs'),('controls','content-search-controls-ui.mjs'),('cancel','content-cancel-ui.mjs'),('names','name-search-ui.mjs')]:
 log=Path('/private/tmp/willyou-dev106-app-'+name+'-r58.log')
 with log.open('w')as out:code=subprocess.run(['node','scripts/files/'+driver],env=env,stdout=out,stderr=subprocess.STDOUT,timeout=180).returncode
 result=json.loads(log.read_text().strip().splitlines()[-1]);runs.append({'name':name,'exitCode':code,'log':str(log),'result':result});print(json.dumps(runs[-1]),flush=True)
Path('/private/tmp/willyou-dev106-app-batch.json').write_text(json.dumps({'runs':runs},indent=2)+'\n');assert all(r['exitCode']==0 and r['result']['status']=='passed'for r in runs)
