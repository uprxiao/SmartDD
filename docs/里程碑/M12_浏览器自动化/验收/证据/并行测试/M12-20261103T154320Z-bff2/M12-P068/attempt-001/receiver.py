#!/usr/bin/python3
import os,sys,re,json,time,subprocess,shutil
from pathlib import Path
root=Path(os.environ['P068_ROOT']);runtime=root/'runtime-001';role=os.environ.get('P068_ROLE','unknown')
def event(value):
 value.update(role=role,atMs=time.time_ns()//1000000)
 with (runtime/'agent-events.jsonl').open('a') as f:f.write(json.dumps(value)+'\n');f.flush()
if '--version' in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec' in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group());sys.exit(0)
event({'kind':'receiver-ready','pid':os.getpid(),'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT')),'cliPath':shutil.which('willyou-app'),'boundary':'Synthetic version/health/requirements, actual TaskService PTY+M11/nativeCLI; not real model R or OS sandbox'})
print('[A] P068 '+role+' synthetic receiver ready',flush=True)
executed=False
for line in sys.stdin:
 event({'kind':'terminal-input','line':line.strip()})
 if role!='T1' or line.strip()!='RUN P068' or executed:continue
 executed=True;event({'kind':'sequence-armed','pid':os.getpid()})
 cfg=json.loads((runtime/'commands.json').read_text());page=cfg['pageId']
 if not re.fullmatch(r'[a-zA-Z0-9-]+',page):raise ValueError('PageIdInvalid')
 binary=shutil.which('willyou-app')
 if not binary:event({'kind':'fixture-error','error':'ActualManagedCLIAbsent'});sys.exit(71)
 commands=[['browser','snapshot','--page',page]]+[['browser','wait','--page',page,'--text','P068-'+str(i)+'-complete','--timeout','45000'] for i in range(1,4)]
 for index,args in enumerate(commands):
  event({'kind':'await-gate','index':index})
  gate=runtime/('gate-'+str(index));deadline=time.monotonic()+90
  while not gate.exists():
   if time.monotonic()>deadline:event({'kind':'fixture-error','error':'GateTimeoutNoReplay','index':index});sys.exit(72)
   time.sleep(.02)
  start=time.monotonic();child=subprocess.Popen([binary]+args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  event({'kind':'cli-start','index':index,'pid':child.pid,'args':args})
  try:stdout,stderr=child.communicate(timeout=55)
  except subprocess.TimeoutExpired:
   event({'kind':'fixture-timeout','index':index,'pid':child.pid});child.terminate();stdout,stderr=child.communicate(timeout=4)
  event({'kind':'cli-result','index':index,'pid':child.pid,'code':child.returncode,'stdout':stdout,'stderr':stderr,'elapsedMs':round((time.monotonic()-start)*1000)});print('P068 '+stdout.strip(),flush=True)
  if child.returncode!=0:event({'kind':'fixture-stop-after-upstream-failure','index':index});break
 else:event({'kind':'sequence-complete','count':len(commands)})
 print('[A] P068 command sequence complete; waiting cleanup',flush=True)
