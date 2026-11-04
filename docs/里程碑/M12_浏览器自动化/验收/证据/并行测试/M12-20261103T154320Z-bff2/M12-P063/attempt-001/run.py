from pathlib import Path
import os, subprocess, json, datetime
root = Path('/private/tmp/willyou-m12-p063-prompt-probe-001')
electron = '/Users/liubu/hx/4.uprxiao/SmartDD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
env = {k:v for k,v in os.environ.items() if not k.startswith(('ELECTRON_RUN_AS_NODE','ANTHROPIC_','OPENAI_','CLAUDECODE','CLAUDE_CODE_'))}
for name in ['home','cache','tmp']:(root/name).mkdir(exist_ok=True)
env.update(HOME=str(root/'home'),TMPDIR=str(root/'tmp')+'/',WILLYOU_TEST_CACHE_DIR=str(root/'cache'))
with (root/'electron.log').open('w') as log:
    process = subprocess.Popen([electron,str(root/'main.cjs')],cwd=root,env=env,stdout=log,stderr=log)
    (root/'execution.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':process.pid,'command':[electron,str(root/'main.cjs')],'privateRoot':str(root)},indent=2)+'\n')
    try: code=process.wait(timeout=25);signals=[]
    except subprocess.TimeoutExpired:
        process.terminate();signals=['SIGTERM']
        try:code=process.wait(timeout=3)
        except subprocess.TimeoutExpired:process.kill();signals.append('SIGKILL');code=process.wait(timeout=3)
(root/'exit.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':process.pid,'code':code,'signals':signals},indent=2)+'\n')
print(json.dumps({'pid':process.pid,'code':code,'signals':signals}))
