#!/usr/bin/python3
import os,sys,re,json,time,subprocess,shutil
from pathlib import Path
root=Path(os.environ.get('P056_ROOT','/private/tmp/willyou-m12-p056-focus-app-004'));runtime=root/'runtime-001';role=os.environ.get('P056_ROLE','unknown')
def event(value):
 value.update(role=role,atMs=time.time_ns()//1000000)
 with (runtime/'agent-events.jsonl').open('a')as f:f.write(json.dumps(value)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group());sys.exit(0)
event({'kind':'receiver-ready','pid':os.getpid(),'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT')),'cliPath':shutil.which('willyou-app'),'boundary':'Syntheticversion/health/requirementsprotocol; actualTaskServicePTY/nativeCLI/M11,notRorOSsandbox'})
print('[A] P056 '+role+' synthetic receiver ready',flush=True)
for line in sys.stdin:
 event({'kind':'terminal-input','line':line.strip()})
 if role!='T1'or line.strip()!='RUN P056':continue
 event({'kind':'sequence-armed','pid':os.getpid()})
 cfg=json.loads((runtime/'commands.json').read_text());binary=shutil.which('willyou-app');new_id=None
 if not binary:event({'kind':'fixture-error','error':'ActualmanagedCLIabsent'});sys.exit(71)
 for index in range(1,4):
  event({'kind':'await-gate','index':index});gate=runtime/('gate-'+str(index));deadline=time.monotonic()+60
  while not gate.exists():
   if time.monotonic()>deadline:event({'kind':'fixture-error','index':index,'error':'GateTimeoutNoBusinessReplayed'});sys.exit(72)
   time.sleep(.03)
  if index==1:args=['browser','tab','create','--url',cfg['newUrl']]
  else:args=['browser','tab','switch','--page',new_id]+(['--focus','true']if index==3 else[])
  child=subprocess.Popen([binary]+args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);event({'kind':'cli-start','index':index,'pid':child.pid,'args':args})
  try:stdout,stderr=child.communicate(timeout=40)
  except subprocess.TimeoutExpired:
   event({'kind':'fixture-timeout','index':index,'pid':child.pid});child.terminate();stdout,stderr=child.communicate(timeout=5)
  event({'kind':'cli-result','index':index,'pid':child.pid,'code':child.returncode,'stdout':stdout,'stderr':stderr});print('P056 '+str(index)+' '+stdout.strip(),flush=True)
  if child.returncode!=0:sys.exit(child.returncode)
  if index==1:
   new_id=json.loads(stdout)['data']['pageId']
   if not isinstance(new_id,str)or not re.fullmatch(r'[a-zA-Z0-9-]+',new_id):raise ValueError('ActualcreatepageIDmissing')
 event({'kind':'sequence-complete','count':3});sys.exit(0)
