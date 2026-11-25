from pathlib import Path
import json, os, subprocess, tempfile
lab=Path('/private/tmp/willyou-f36-lab-tljocnfp')
source=lab/'candidate'; root=Path(tempfile.mkdtemp(prefix='registry-cold-',dir=lab))
for name in ['home','tmp']: (root/name).mkdir(mode=0o700)
env=dict(os.environ, HOME=str(root/'home'), TMPDIR=str(root/'tmp'), F36_COLD_ROOT=str(root), F36_COLD_SOURCE=str(source))
cmd=[str(source/'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),str(source/'registry-cold-probe.cjs')]
print('F36_COLD_RUN='+str(root),flush=True)
with (root/'stdout.log').open('w') as out,(root/'stderr.log').open('w') as err:
 run=subprocess.Popen(cmd,cwd=root,env=env,stdout=out,stderr=err)
 try: code=run.wait(timeout=120)
 except subprocess.TimeoutExpired:
  run.terminate()
  try: code=run.wait(timeout=10)
  except subprocess.TimeoutExpired: run.kill(); code=run.wait()
  (root/'timeout.txt').write_text('Owned probe exceeded 120s; termination fallback applied.\n')
(root/'launch.json').write_text(json.dumps({'command':cmd,'pid':run.pid,'exitCode':code,'isolatedRoot':str(root)},indent=2)+'\n')
print(json.dumps({'root':str(root),'exit':code,'result':json.loads((root/'result.json').read_text()).get('status') if (root/'result.json').exists() else None}),flush=True)
raise SystemExit(code!=0)
