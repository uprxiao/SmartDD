#!/usr/bin/python3
import os,sys,re,json,time,subprocess,shutil
from pathlib import Path
root=Path(os.environ['M12_NAVI_ROOT']);phase=os.environ['M12_NAVI_PHASE'];events=root/'runtime-001'/'agent-events.jsonl'
def event(row):
 row.update(phase=phase,atMs=time.time_ns()//1000000)
 with events.open('a')as f:f.write(json.dumps(row)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group());sys.exit(0)
event({'kind':'receiver-ready','pid':os.getpid(),'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT')),'endpointPath':os.environ.get('WILLYOU_ENDPOINT'),'boundary':'Synthetic health/requirements only; actual TaskService PTY and nativeCLI/M11. Not real model R.'})
print('[A] Navigation/settings receiver ready',flush=True);used=False
for line in sys.stdin:
 event({'kind':'terminal-input','line':line.strip()})
 if line.strip()!='NAVI IDENTITY' or used:continue
 used=True;binary=shutil.which('willyou-app')
 if not binary:event({'kind':'fixture-error','error':'Managed CLI missing'});break
 start=time.monotonic_ns();child=subprocess.Popen([binary,'browser','identity','get'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);event({'kind':'cli-start','pid':child.pid,'args':['browser','identity','get']})
 try:stdout,stderr=child.communicate(timeout=30)
 except subprocess.TimeoutExpired:
  event({'kind':'fixture-timeout','pid':child.pid});child.terminate();stdout,stderr=child.communicate(timeout=4)
 event({'kind':'cli-result','pid':child.pid,'code':child.returncode if child.returncode>=0 else None,'signal':None if child.returncode>=0 else -child.returncode,'stdout':stdout,'stderr':stderr,'elapsedNs':time.monotonic_ns()-start});print(stdout.strip(),flush=True)
