from pathlib import Path
import json,os,subprocess,datetime,sys,time
root=Path(__file__).resolve().parent; src=root/'source'; manifest=json.loads((root/'manifest.json').read_text())
node=src/'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
vitest=src/'node_modules/vitest/vitest.mjs'
env={k:os.environ[k] for k in ['PATH','LANG','LC_ALL','LC_CTYPE','TZ'] if k in os.environ}
env.update({'HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'WILLYOU_TEST_CACHE_DIR':str(root/'cache'),'ELECTRON_RUN_AS_NODE':'1','CI':'1'})
args=[str(node),str(vitest),'run','--maxWorkers=2','--pool=forks','--reporter=verbose','src/main/core/browser/__tests__/service-budget.test.ts']
start=time.time(); print('F36_COMPAT_ROOT='+str(root),flush=True); print('TEST_COMMAND='+json.dumps(args),flush=True)
with (root/'logs'/'test-service-budget.txt').open('w') as log:
 try:r=subprocess.run(args,cwd=src,env=env,stdout=log,stderr=subprocess.STDOUT); code=r.returncode
 except Exception as e:log.write(str(e));code=126
(root/'logs'/'run-service-budget.json').write_text(json.dumps({'started_at':datetime.datetime.fromtimestamp(start,datetime.timezone.utc).isoformat(),'elapsed_seconds':time.time()-start,'code':code,'args':args,'private_paths':{k:env[k] for k in ['HOME','TMPDIR','WILLYOU_TEST_CACHE_DIR']},'electron_run_as_node':True},ensure_ascii=False,indent=2)+'\n')
print('exit',code,'log:',root/'logs'/'test-service-budget.txt',flush=True);sys.exit(code)
