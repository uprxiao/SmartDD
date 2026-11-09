#!/usr/bin/python3
# Synthetic managed I caller only; true native CLI, blocking stdin, one serial worker.
import os,sys,json,subprocess,threading,concurrent.futures,time,datetime
lock=threading.Lock();children={};private_env=dict(os.environ);binary=None

def send(value):
 with lock:print(json.dumps(value),flush=True)

def execute(request):
 started=time.monotonic_ns();utc=datetime.datetime.now(datetime.timezone.utc).isoformat();request_id=request['id'];args=request['args'];data=request.get('input')
 try:
  child=subprocess.Popen([binary]+args,stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=private_env)
  with lock:children[request_id]=child
  send({'kind':'cli-spawn','id':request_id,'pid':child.pid,'args':args,'startedMonotonicNs':started,'startedUTC':utc});timed=False
  try:stdout,stderr=child.communicate(data.encode('utf-8') if data is not None else None,timeout=105)
  except subprocess.TimeoutExpired:timed=True;child.kill();stdout,stderr=child.communicate()
  finished=time.monotonic_ns()
  send({'kind':'cli-result','id':request_id,'pid':child.pid,'code':child.returncode if child.returncode>=0 else None,'signal':-child.returncode if child.returncode<0 else None,'stdout':stdout.decode('utf-8'),'stderr':stderr.decode('utf-8'),'timedOut':timed,'startedMonotonicNs':started,'finishedMonotonicNs':finished,'elapsedNs':finished-started,'startedUTC':utc,'finishedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'timingBoundary':'BeforePopen through aftercommunicate, no deductions'})
  with lock:children.pop(request_id,None)
 except Exception as error:send({'kind':'cli-root-error','id':request_id,'error':str(error)})

send({'kind':'root-ready','pid':os.getpid()});pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
for line in sys.stdin:
 request=json.loads(line)
 if request.get('command')=='configure':binary=request['binary'];private_env.update(request['environment']);send({'kind':'root-configured','pid':os.getpid(),'environmentValuesLogged':False});continue
 if request.get('command')=='cancel-owned':
  with lock:pending=list(children.items())
  for request_id,child in pending:
   if child.poll() is None:child.terminate();send({'kind':'cleanup-owned-cli-signal','id':request_id,'pid':child.pid,'signal':'SIGTERM'})
  continue
 if request.get('command')=='stop':break
 pool.submit(execute,request)
pool.shutdown(wait=True)
