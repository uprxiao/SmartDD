#!/usr/bin/python3
"""P084 managed caller health/stockCLI transport; file jobs let T1 keep running while UI selects T2."""
import os,sys,re,json,time,subprocess,shutil,hashlib
from pathlib import Path
sys.dont_write_bytecode=True
root=Path(os.environ['T107_ROOT']);role=os.environ['T107_ROLE'];events=root/'runtime-001/agent-events.jsonl'
def event(x):
 x.update(role=role,at=time.time_ns()//1000000)
 with events.open('a')as f:f.write(json.dumps(x)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 m=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv));print(m.group()if m else'');sys.exit(0 if m else 70)
binary=shutil.which('willyou-app');assert binary
event({'kind':'receiver-ready','pid':os.getpid(),'binary':str(Path(binary).resolve()),'binarySha256':hashlib.sha256(Path(binary).resolve().read_bytes()).hexdigest(),'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT'))})
print('[I+A] T107 controlled managed caller ready '+role,flush=True);seen=set()
while True:
 for file in sorted((root/'runtime-001'/('jobs-'+role)).glob('*.json')):
  if file.name in seen:continue
  seen.add(file.name);job=json.loads(file.read_text());tag=job['tag'];argv=job['argv'];assert isinstance(argv,list)and argv[0]=='browser'and all(isinstance(x,str)for x in argv)
  # Opaque full refs remain exactly as returned by the host; no pattern conversion.
  start=time.monotonic_ns();child=subprocess.Popen([binary,*argv],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);event({'kind':'cli-start','tag':tag,'pid':child.pid,'argv':argv,'startMonoNs':str(start)})
  timed=False
  try:out,err=child.communicate(timeout=35)
  except subprocess.TimeoutExpired:
   timed=True;child.terminate()
   try:out,err=child.communicate(timeout=5)
   except subprocess.TimeoutExpired:child.kill();out,err=child.communicate(timeout=5)
  end=time.monotonic_ns();event({'kind':'cli-result','tag':tag,'pid':child.pid,'argv':argv,'stdout':out,'stderr':err,'code':child.returncode,'timedOut':timed,'elapsedMs':(end-start)/1000000,'startMonoNs':str(start),'finishMonoNs':str(end)})
  if timed:sys.exit(1)
  if child.returncode!=0:
   expected_pause=(child.returncode==2 and job.get('expectedErrorCode')=='BROWSER_PAUSED' and tag.endswith('-pause-read'))
   try: expected_pause=expected_pause and json.loads(out).get('error',{}).get('code')=='BROWSER_PAUSED'
   except (ValueError,AttributeError): expected_pause=False
   if not expected_pause:sys.exit(1)
   event({'kind':'expected-paused-caller-retained','tag':tag,'pid':os.getpid(),'actualExitCode':child.returncode,'errorCode':'BROWSER_PAUSED'})
 time.sleep(.02)
