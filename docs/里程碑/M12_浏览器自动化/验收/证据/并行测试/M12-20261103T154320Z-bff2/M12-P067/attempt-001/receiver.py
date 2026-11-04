#!/usr/bin/python3
# Synthetic managed caller health/version only, actual TaskService PTY/M11/CLI.
import os,sys,re,json,time,subprocess,shutil,threading,concurrent.futures
from pathlib import Path
root=Path(os.environ['P067_ROOT']);runtime=root/'runtime-001';role=os.environ.get('P067_ROLE','unknown');pid=os.getpid()
lock=threading.Lock();armed=False;done=False;seen=set()
def event(value):
 value.update(role=role,receiverPid=pid,atMs=time.time_ns()//1000000)
 with lock:
  with (runtime/'agent-events.jsonl').open('a')as f:f.write(json.dumps(value)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group());sys.exit(0)
binary=shutil.which('willyou-app')
event({'kind':'receiver-ready','pid':pid,'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT')),'hasCliBinary':bool(binary)})
print('[A] P067 '+role+' ready; RUN P067 to arm',flush=True)
pool=concurrent.futures.ThreadPoolExecutor(max_workers=8)
def execute_inner(q):
 qid=q['id'];args=q['args']
 if not re.fullmatch(r'[a-z0-9-]+',qid):raise ValueError('UniqueIdRequired')
 out=runtime/('cli-'+qid+'.stdout');err=runtime/('cli-'+qid+'.stderr')
 with out.open('wb')as of,err.open('wb')as ef:
  child=subprocess.Popen([binary]+args,stdin=subprocess.DEVNULL,stdout=of,stderr=ef)
  event({'kind':'cli-start','id':qid,'pid':child.pid,'args':args,'stdoutPath':str(out),'stderrPath':str(err)})
  timed=False
  try:child.wait(timeout=105)
  except subprocess.TimeoutExpired:timed=True;child.kill();child.wait(timeout=5)
 event({'kind':'cli-result','id':qid,'pid':child.pid,'code':child.returncode if child.returncode>=0 else None,'signal':-child.returncode if child.returncode<0 else None,'stdout':out.read_text(),'stderr':err.read_text(),'timedOut':timed})
def execute(q):
 try:execute_inner(q)
 except Exception as error:event({'kind':'fixture-error','id':q.get('id'),'error':str(error)})
def watcher():
 while not done:
  if armed:
   inbox=runtime/('inbox-'+role+'.jsonl')
   if inbox.exists():
    for line in inbox.read_text().splitlines():
     q=json.loads(line)
     if q.get('receiverPid')!=pid or q['id']in seen:continue
     seen.add(q['id']);pool.submit(execute,q)
  time.sleep(.025)
thread=threading.Thread(target=watcher,daemon=True);thread.start()
for line in sys.stdin:
 text=line.strip();event({'kind':'terminal-input','line':text})
 if text=='RUN P067'and not armed:armed=True;event({'kind':'sequence-armed'});print('[A] P067 armed',flush=True)
 if text=='END P067':event({'kind':'receiver-normal-end'});break
done=True;thread.join(timeout=1);pool.shutdown(wait=True)
event({'kind':'receiver-exit','pid':pid});print('[A] P067 normal end',flush=True)
