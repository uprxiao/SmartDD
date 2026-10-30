#!/usr/bin/python3
import hashlib,json,os,resource,signal,subprocess,sys,time
payload=sys.stdin.buffer.read()
request=json.loads(payload)
fault=open("/private/tmp/willyou-native-save-failure-sjgTZa/fault-mode").read().strip()=='generic' and request.get('operation')=='save'
def limit():
 signal.signal(signal.SIGXFSZ,signal.SIG_IGN)
 resource.setrlimit(resource.RLIMIT_FSIZE,(4096,4096))
p=subprocess.Popen(["/private/tmp/willyou-native-save-failure-sjgTZa/original-willyou-files"]+sys.argv[1:],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=sys.stderr.buffer,preexec_fn=limit if fault else None)
p.stdin.write(payload);p.stdin.close()
frames=[]
recovery_path=(request.get('recoveryRoot') or {}).get('path')
for line in p.stdout:
 sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
 frame={'sha256':hashlib.sha256(line).hexdigest(),'bytes':len(line)}
 try:
  value=json.loads(line)
  if request.get('operation')=='initialize-recovery' and isinstance(value.get('result'),dict):recovery_path=value['result'].get('path')
  if 'error' in value:frame['nativeError']=value['error']
  if isinstance(value.get('result'),dict) and 'state' in value['result']:frame['nativeReceipt']={k:value['result'][k] for k in ['state','message','opId','recoveryId'] if k in value['result']}
 except Exception:pass
 frames.append(frame)
code=p.wait()
# Save/copy run under the production kernel write scope. Keep this explicit
# test-only telemetry inside its already authorized private recovery root.
log_path=os.path.join(recovery_path,'.willyou-test-native-relay.jsonl') if request.get('operation') in ('save','copy') and recovery_path else "/private/tmp/willyou-native-save-failure-sjgTZa/native-relay.jsonl"
with open(log_path,'a') as log:
 log.write(json.dumps({'at':time.time(),'operation':request.get('operation'),'relativePath':request.get('relativePath'),'requestSha256':hashlib.sha256(payload).hexdigest(),'saveFsizeLimit':4096 if fault else None,'nativeExit':code,'frames':frames,'recoveryPath':recovery_path,'tracePath':log_path})+'\n')
sys.exit(code)
