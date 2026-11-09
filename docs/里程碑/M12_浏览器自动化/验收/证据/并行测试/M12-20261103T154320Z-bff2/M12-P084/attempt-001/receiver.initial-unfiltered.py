#!/usr/bin/python3
"""Blocking synthetic caller. All browser outputs come from the real native CLI.
No credentials are created/injected by this fixture; TaskService supplies its env.
Synthetic health/config handshake is not a real model R or sandbox assertion.
"""
import os,sys,re,json,time,subprocess,shutil,hashlib,base64
from pathlib import Path
root=Path(os.environ['T088_ROOT']);role=os.environ['T088_ROLE']
events=root/'runtime-001'/'agent-events.jsonl'
def event(row):
 row.update(role=role,atMs=time.time_ns()//1000000)
 with events.open('a')as f:f.write(json.dumps(row)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group());sys.exit(0)
binary=shutil.which('willyou-app')
binary_path=str(Path(binary).resolve())if binary else None
binary_sha=hashlib.sha256(Path(binary_path).read_bytes()).hexdigest()if binary_path else None
event({'kind':'receiver-ready','pid':os.getpid(),'binary':binary_path,'binarySha256':binary_sha,'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT')),'endpointPath':os.environ.get('WILLYOU_ENDPOINT'),'boundary':'Real TaskService managed PTY/nativeCLI/M11; synthetic health/config only, no real model R.'})
print('[I] T088 blocking caller ready '+role,flush=True)
seen=set()
for line in sys.stdin:
 match=re.fullmatch(r'T088 RUN ([a-z0-9-]{1,80}) ([A-Za-z0-9+/=]+)',line.strip())
 if not match:continue
 tag,payload=match.groups()
 if tag in seen:event({'kind':'duplicate-refused','tag':tag});continue
 seen.add(tag)
 try:
  argv=json.loads(base64.b64decode(payload,validate=True))
  if not isinstance(argv,list)or not argv or argv[0]!='browser'or not all(isinstance(x,str)for x in argv):raise ValueError('Only browser argv string arrays')
  if binary is None:raise ValueError('Actual managed CLI absent')
  start=time.monotonic_ns();child=subprocess.Popen([binary,*argv],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  event({'kind':'cli-start','pid':child.pid,'tag':tag,'argv':argv,'startMonoNs':str(start)})
  timed_out=False;cleanup=[]
  try:stdout,stderr=child.communicate(timeout=105)
  except subprocess.TimeoutExpired:
   timed_out=True;child.terminate();cleanup.append('SIGTERM')
   try:stdout,stderr=child.communicate(timeout=5)
   except subprocess.TimeoutExpired:child.kill();cleanup.append('SIGKILL');stdout,stderr=child.communicate(timeout=5)
  event({'kind':'cli-result','pid':child.pid,'tag':tag,'argv':argv,'stdout':stdout,'stderr':stderr,'code':child.returncode if child.returncode>=0 else None,'signal':None if child.returncode>=0 else -child.returncode,'timedOut':timed_out,'cleanupSignals':cleanup,'startMonoNs':str(start),'finishMonoNs':str(time.monotonic_ns())})
  print(stdout.strip(),flush=True)
  if child.returncode!=0 or timed_out:event({'kind':'stop-after-cli-failure','tag':tag});break
 except Exception as error:
  event({'kind':'fixture-error','tag':tag,'error':repr(error)});break
