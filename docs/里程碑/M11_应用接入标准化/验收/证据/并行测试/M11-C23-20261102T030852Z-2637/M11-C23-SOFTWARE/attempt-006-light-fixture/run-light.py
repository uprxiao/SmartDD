import json, os, signal, subprocess, time
from pathlib import Path
root=Path('/private/tmp/willyou-m11-c23-2637/software-evidence/attempt-006-light-fixture')
source='/private/tmp/willyou-m11-c23-2637/software-source-fixtures-attempt-003'
args=['pnpm','test','src/renderer/features/files/office/preview.test.tsx','src/main/core/files/office/range-input-transaction-acceptance.test.ts','--maxWorkers=1','--reporter=json','--outputFile='+str(root/'vitest.json'),'--reporter=verbose']
env=dict(os.environ,COREPACK_ENABLE_NETWORK='0',WILLYOU_TEST_CACHE_DIR='/private/tmp/willyou-m11-c23-2637/software-cache-fixture-light')
started=time.time()
with open(root/'test.log','wb') as log:
 p=subprocess.Popen(args,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 meta={'schema':'m11-c23-light-execution-v1','driverPid':os.getpid(),'testPid':p.pid,'pgid':p.pid,'argv':args,'cwd':source,'cache':env['WILLYOU_TEST_CACHE_DIR'],'corepackNetwork':'disabled','startedAt':started,'outerLimitSeconds':180}
 (root/'execution.json').write_text(json.dumps(meta,indent=2)+'\n')
 print(json.dumps({'driverPid':os.getpid(),'testPid':p.pid,'pgid':p.pid,'stage':'running-2-light-U-files'}),flush=True)
 try:p.wait(timeout=180)
 except subprocess.TimeoutExpired:
  meta['outerTimeout']=True;os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
 meta.update(exitCode=p.returncode,finishedAt=time.time(),elapsedSeconds=time.time()-started)
 (root/'execution.json').write_text(json.dumps(meta,indent=2)+'\n')
 print(json.dumps({'testPid':p.pid,'exitCode':p.returncode,'elapsedSeconds':meta['elapsedSeconds']}),flush=True)
raise SystemExit(p.returncode)
