#!/usr/bin/python3
import os,sys,re,json,time,subprocess,shutil
from pathlib import Path
root=Path(os.environ['P069_ROOT']);runtime=root/'runtime-001';role=os.environ['P069_ROLE']
def event(value):
 value.update(role=role,atMs=time.time_ns()//1000000)
 with (runtime/'agent-events.jsonl').open('a')as f:f.write(json.dumps(value)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group());sys.exit(0)
endpoint=os.environ.get('WILLYOU_ENDPOINT','')
if not(endpoint.startswith('/private/tmp/wy-cli-') and endpoint.endswith('/cli.sock')):raise ValueError('Expected exactmanagedprivateUnix endpoint')
event({'kind':'receiver-ready','pid':os.getpid(),'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT')),'cliEndpoint':endpoint,'cliPath':shutil.which('willyou-app'),'boundary':'Blocking stdin controlled caller; actual TaskServicePTY+M11/kernel peer/nativeCLI, not modelR/UIA'})
print('[I/S] P069 '+role+' ready; blocking stdin',flush=True)
seen=set()
for line in sys.stdin:
 match=re.fullmatch(r'P069 SAMPLE (warm|0|5|10|15|20|25|30)',line.strip())
 if not match:continue
 sample=match.group(1)
 if sample in seen:event({'kind':'duplicate-schedule-refused','sample':sample});continue
 seen.add(sample);cfg=json.loads((runtime/'pages.json').read_text());page=cfg[role]
 if not re.fullmatch(r'[a-zA-Z0-9-]+',page):raise ValueError('PageIdInvalid')
 binary=shutil.which('willyou-app')
 if not binary:event({'kind':'fixture-error','error':'ActualManagedCLIAbsent'});sys.exit(71)
 args=['browser','snapshot','--page',page];start=time.monotonic();child=subprocess.Popen([binary]+args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 event({'kind':'cli-start','sample':sample,'pid':child.pid,'args':args})
 try:stdout,stderr=child.communicate(timeout=30)
 except subprocess.TimeoutExpired:
  event({'kind':'fixture-timeout','sample':sample,'pid':child.pid});child.terminate()
  try:stdout,stderr=child.communicate(timeout=4)
  except subprocess.TimeoutExpired:child.kill();stdout,stderr=child.communicate(timeout=3)
 event({'kind':'cli-result','sample':sample,'pid':child.pid,'code':child.returncode,'stdout':stdout,'stderr':stderr,'elapsedMs':round((time.monotonic()-start)*1000)});print('P069 '+sample+' '+stdout.strip(),flush=True)
 if child.returncode!=0:event({'kind':'fixture-stop-after-upstream-failure','sample':sample});break
