#!/usr/bin/python3
import os,sys,re,json,time,subprocess,shutil
from pathlib import Path
root=Path(os.environ['P062_ROOT']);runtime=root/'runtime-001';role=os.environ.get('P062_ROLE','unknown')
def event(value):
 value.update(role=role,atMs=time.time_ns()//1000000)
 with (runtime/'agent-events.jsonl').open('a')as f:f.write(json.dumps(value)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group());sys.exit(0)
event({'kind':'receiver-ready','pid':os.getpid(),'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT')),'cliPath':shutil.which('willyou-app'),'boundary':'Synthetic version/health/requirements; actual TaskServicePTY+M11/nativeCLI; notR or OSsandbox'})
print('[A] P062 '+role+' synthetic receiver ready',flush=True)
executed=False
for line in sys.stdin:
 event({'kind':'terminal-input','line':line.strip()})
 if role!='T1'or line.strip()!='RUN P062'or executed:continue
 executed=True
 event({'kind':'sequence-armed','pid':os.getpid()});event({'kind':'await-gate','index':1})
 gate=runtime/'gate-1';deadline=time.monotonic()+60
 while not gate.exists():
  if time.monotonic()>deadline:event({'kind':'fixture-error','error':'GateTimeoutNoBusinessReplayed'});sys.exit(72)
  time.sleep(.03)
 cfg=json.loads((runtime/'commands.json').read_text());target=cfg['targetTaskId']
 if not re.fullmatch(r'[a-zA-Z0-9-]+',target):raise ValueError('TargetTaskIdInvalid')
 binary=shutil.which('willyou-app')
 if not binary:event({'kind':'fixture-error','error':'ActualManagedCLIAbsent'});sys.exit(71)
 args=['browser','access','request','--task',target,'--mode','control'];start=time.monotonic()
 child=subprocess.Popen([binary]+args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);event({'kind':'cli-start','index':1,'pid':child.pid,'args':args})
 try:stdout,stderr=child.communicate(timeout=12)
 except subprocess.TimeoutExpired:
  event({'kind':'fixture-timeout','index':1,'pid':child.pid,'boundary':'Expected direct denial did not return within12s; cancel only this owned CLI, no retry'});child.terminate();stdout,stderr=child.communicate(timeout=5)
 event({'kind':'cli-result','index':1,'pid':child.pid,'code':child.returncode,'stdout':stdout,'stderr':stderr,'elapsedMs':round((time.monotonic()-start)*1000)});print('P062 '+stdout.strip(),flush=True)
 event({'kind':'sequence-complete','count':1});print('[A] P062 single command complete; waiting cleanup',flush=True)
