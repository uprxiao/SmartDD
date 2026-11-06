import pathlib,json,os,subprocess,datetime,time
R=pathlib.Path('/private/tmp/willyou-m12-t130-U-gap-closeout-001')
cmd=['/Users/liubu/.hermes/node/bin/node','/private/tmp/willyou-m12-t130-native-u-root-001/work/node_modules/vitest/vitest.mjs','run','--config',str(R/'vitest.private.config.mjs'),'--configLoader','runner','--maxWorkers','1','--no-file-parallelism']
env={**os.environ,'WILLYOU_TEST_CACHE_DIR':str(R/'cache'),'NODE_COMPILE_CACHE':str(R/'cache/node'),'TMPDIR':str(R/'tmp')}
cwd='/private/tmp/willyou-m12-t130-native-u-root-001/work';start=time.monotonic()
with (R/'output/attempt-002.stdout.log').open('w') as out,(R/'output/attempt-002.stderr.log').open('w') as err:
 p=subprocess.Popen(cmd,cwd=cwd,env=env,stdout=out,stderr=err)
 row={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'driverPID':os.getpid(),'testPID':p.pid,'command':cmd,'cwd':cwd,'cache':str(R/'cache/vitest'),'maxWorkers':1}
 (R/'attempt-002-started.json').write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row),flush=True)
 code=p.wait();row.update(exitCode=code,seconds=time.monotonic()-start);(R/'attempt-002-exit.json').write_text(json.dumps(row,indent=2)+'\n');print(json.dumps({'exitCode':code,'testPID':p.pid,'seconds':row['seconds']}),flush=True)
 raise SystemExit(code)
