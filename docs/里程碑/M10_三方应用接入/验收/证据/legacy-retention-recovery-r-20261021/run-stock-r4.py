from pathlib import Path
import subprocess,os,json,datetime,time
r=Path('/private/tmp/m10-legacy-recovery-r-20261021');work=r/'work-r4'
args=['/private/tmp/m10-legacy-plugin-q2-package-20261021/mac-arm64/WillYou.app/Contents/MacOS/WillYou',str(work/'node_modules/vitest/vitest.mjs'),'run','src/main/core/applications/__tests__/legacy-retention-recovery.test.ts','--maxWorkers=1','--config','vitest.cache-isolated-r4.config.ts']
env=dict(os.environ,ELECTRON_RUN_AS_NODE='1',SMARTDD_USER_DATA=str(r/'stock-r4-userData'))
start=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic()
(r/'stock-r4-command.json').write_text(json.dumps({'start':start,'args':args,'source':'binding-fix-source.json','frameworkStartupAdaptation':False,'dependencyBasis':'/private/tmp/m10-test-dependencies-r4-offline-20261021/ready.json'},indent=2)+'\n')
with (r/'recovery-stock-r4.txt').open('w') as out:p=subprocess.run(args,env=env,cwd=work,stdout=out,stderr=subprocess.STDOUT)
j={'start':start,'end':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode,'elapsedSeconds':time.monotonic()-t,'frameworkStartupAdaptation':False,'source':'binding-fix-source.json','log':'recovery-stock-r4.txt'}
(r/'recovery-stock-r4-result.json').write_text(json.dumps(j,indent=2)+'\n');print(json.dumps(j));print((r/'recovery-stock-r4.txt').read_text()[-12000:]);raise SystemExit(p.returncode)
