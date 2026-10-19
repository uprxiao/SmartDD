from pathlib import Path
import json,os,subprocess,time,sys
base=Path('/private/tmp');environment={**os.environ,'WILLYOU_FILES_APP':'/private/tmp/willyou-m9-acceptance-batch-r55-build/mac-arm64/WillYou.app/Contents/MacOS/WillYou'}
scenarios=[('atomic20over','scripts/files/large-input-ui.mjs',20971521),('atomic10','scripts/files/large-input-ui.mjs',10485760),('atomic10over','scripts/files/large-input-ui.mjs',10485761),('text-size','scripts/files/text-size-ui.mjs',None),('save-recovery','scripts/files/save-recovery-acceptance-ui.mjs',None)]
rows=[]
for name,driver,byte_count in scenarios:
 env=dict(environment)
 if byte_count:env['WILLYOU_LARGE_INPUT_BYTES']=str(byte_count)
 log=base/f'willyou-dev103-app-{name}-r55.log';started=time.time()
 with log.open('w')as f:r=subprocess.run(['node',driver],stdout=f,stderr=subprocess.STDOUT,env=env)
 row={'name':name,'driver':driver,'bytes':byte_count,'exitCode':r.returncode,'elapsedSeconds':round(time.time()-started,3),'log':str(log)}
 for line in log.read_text().splitlines():
  try:value=json.loads(line)
  except Exception:continue
  if isinstance(value,dict)and 'artifacts'in value:row['result']=value
 rows.append(row);(base/'willyou-dev103-app-batch.json').write_text(json.dumps({'runs':rows},ensure_ascii=False,indent=2)+'\n');print(json.dumps(row),flush=True)
 if r.returncode!=0 or row.get('result',{}).get('status')!='passed':sys.exit(1)
