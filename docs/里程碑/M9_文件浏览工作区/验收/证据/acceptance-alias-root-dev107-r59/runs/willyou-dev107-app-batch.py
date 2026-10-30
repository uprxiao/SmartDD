from pathlib import Path
import json,os,subprocess
base=dict(os.environ,WILLYOU_FILES_APP='/private/tmp/willyou-m9-acceptance-batch-r59-build/mac-arm64/WillYou.app/Contents/MacOS/WillYou');runs=[]
for name,driver,options in [('alias','alias-draft-restore-ui.mjs',{}),('root','active-root-retry-ui.mjs',{}),('root-loss','root-loss-ui.mjs',{}),('restore','tab-restore-ui.mjs',{'WILLYOU_RESTORE_ONLY_D17':'1'})]:
 log=Path('/private/tmp/willyou-dev107-app-'+name+'-r59.log')
 with log.open('w')as out: code=subprocess.run(['node','scripts/files/'+driver],env={**base,**options},stdout=out,stderr=subprocess.STDOUT,timeout=180).returncode
 result=json.loads(log.read_text().strip().splitlines()[-1]);runs.append({'name':name,'exitCode':code,'log':str(log),'result':result});print(json.dumps(runs[-1]),flush=True)
Path('/private/tmp/willyou-dev107-app-batch.json').write_text(json.dumps({'runs':runs},indent=2)+'\n');assert all(x['exitCode']==0 and x['result']['status']=='passed'for x in runs)
