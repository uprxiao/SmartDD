#!/usr/bin/python3
"""P084 managed synthetic caller adapted only for T064; no model or credentials."""
import os,sys,re,json,time,subprocess,shutil,hashlib,base64
from pathlib import Path
sys.dont_write_bytecode=True
root=Path(os.environ['T064_ROOT']);events=root/'runtime-001/agent-events.jsonl'
def event(x):
 x['at']=time.time_ns()//1000000
 with events.open('a')as f:f.write(json.dumps(x)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 m=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv));print(m.group()if m else'');sys.exit(0 if m else 70)
binary=shutil.which('willyou-app');assert binary
event({'kind':'receiver-ready','pid':os.getpid(),'binary':str(Path(binary).resolve()),'binarySha256':hashlib.sha256(Path(binary).resolve().read_bytes()).hexdigest(),'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT'))})
seen=set()
for line in sys.stdin:
 m=re.fullmatch(r'T064 RUN ([a-z0-9-]{1,40}) ([A-Za-z0-9+/=]+)',line.strip())
 if not m:continue
 tag,payload=m.groups();assert tag not in seen;seen.add(tag);job=json.loads(base64.b64decode(payload,validate=True));env=dict(os.environ)
 if isinstance(job,dict):
  assert job['kind']=='stdin-fill'and re.fullmatch(r'@k[0-9a-f]{32}s[0-9]+e[0-9]+',job['ref'])
  command='printf \'%s\' "$PASS" | willyou-app browser fill --element '+job['ref']+' --stdin value'
  env['PASS']=(root/'runtime-001/canary.private.txt').read_text();argv=['/bin/zsh','-c',command]
 else:
  assert isinstance(job,list)and job[0]=='browser'and all(isinstance(x,str)for x in job);command=None;argv=[binary,*job]
 child=subprocess.Popen(argv,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 event({'kind':'cli-start','tag':tag,'pid':child.pid,'shellCommand':command,'argv':argv})
 timed=False
 try:out,err=child.communicate(timeout=35)
 except subprocess.TimeoutExpired:
  timed=True;child.terminate()
  try:out,err=child.communicate(timeout=5)
  except subprocess.TimeoutExpired:child.kill();out,err=child.communicate(timeout=5)
 event({'kind':'cli-result','tag':tag,'pid':child.pid,'stdout':out,'stderr':err,'code':child.returncode,'timedOut':timed})
 if timed or child.returncode!=0:break
