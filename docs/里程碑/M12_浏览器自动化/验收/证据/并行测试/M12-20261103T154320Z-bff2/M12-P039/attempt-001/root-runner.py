#!/usr/bin/python3
# Synthetic managed I run root, not a model/Agent R. Real child CLI+kernel identity.
import os,sys,json,subprocess,time
print(json.dumps({'kind':'root-ready','pid':os.getpid()}),flush=True)
private_env=dict(os.environ);binary=None
for line in sys.stdin:
 request=json.loads(line)
 if request.get('command')=='configure':
  binary=request['binary'];private_env.update(request['environment'])
  print(json.dumps({'kind':'root-configured','pid':os.getpid(),'environmentValuesLogged':False}),flush=True);continue
 if request.get('command')=='stop':break
 request_id=request['id'];args=request['args'];data=request.get('input')
 try:
  child=subprocess.Popen([binary]+args,stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=private_env)
  print(json.dumps({'kind':'cli-spawn','id':request_id,'pid':child.pid,'args':args}),flush=True)
  timed=False
  try:stdout,stderr=child.communicate(data.encode('utf-8') if data is not None else None,timeout=105)
  except subprocess.TimeoutExpired:
   timed=True;child.kill();stdout,stderr=child.communicate()
  print(json.dumps({'kind':'cli-result','id':request_id,'pid':child.pid,'code':child.returncode if child.returncode>=0 else None,'signal':(-child.returncode if child.returncode<0 else None),'stdout':stdout.decode('utf-8'),'stderr':stderr.decode('utf-8'),'timedOut':timed}),flush=True)
 except Exception as error:print(json.dumps({'kind':'cli-root-error','id':request_id,'error':str(error)}),flush=True)
