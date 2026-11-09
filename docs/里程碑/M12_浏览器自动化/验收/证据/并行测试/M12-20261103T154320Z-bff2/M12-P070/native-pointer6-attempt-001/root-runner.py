#!/usr/bin/python3
# Synthetic managed I root, concurrent actual native CLI children; never Agent R.
import os,sys,json,subprocess,threading,concurrent.futures
lock=threading.Lock()
def send(value):
 with lock: print(json.dumps(value),flush=True)
send({'kind':'root-ready','pid':os.getpid()})
private_env=dict(os.environ);binary=None
pool=concurrent.futures.ThreadPoolExecutor(max_workers=8)
def execute(request):
 request_id=request['id'];args=request['args'];data=request.get('input')
 try:
  child=subprocess.Popen([binary]+args,stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=private_env)
  send({'kind':'cli-spawn','id':request_id,'pid':child.pid,'args':args});timed=False
  try: stdout,stderr=child.communicate(data.encode('utf-8') if data is not None else None,timeout=105)
  except subprocess.TimeoutExpired:
   timed=True;child.kill();stdout,stderr=child.communicate()
  send({'kind':'cli-result','id':request_id,'pid':child.pid,'code':child.returncode if child.returncode>=0 else None,'signal':-child.returncode if child.returncode<0 else None,'stdout':stdout.decode('utf-8'),'stderr':stderr.decode('utf-8'),'timedOut':timed})
 except Exception as error:send({'kind':'cli-root-error','id':request_id,'error':str(error)})
for line in sys.stdin:
 request=json.loads(line)
 if request.get('command')=='configure':
  binary=request['binary'];private_env.update(request['environment']);send({'kind':'root-configured','pid':os.getpid(),'environmentValuesLogged':False});continue
 if request.get('command')=='stop':break
 pool.submit(execute,request)
pool.shutdown(wait=True)
