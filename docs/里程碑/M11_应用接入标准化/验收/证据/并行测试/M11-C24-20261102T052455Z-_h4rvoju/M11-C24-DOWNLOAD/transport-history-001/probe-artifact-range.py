import datetime,hashlib,json,os,selectors,signal,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parent
e=root/'evidence/ci-download-range-001';e.mkdir(exist_ok=False)
env=dict(os.environ)
for k in ['GH_TOKEN','GITHUB_TOKEN']:env.pop(k,None)
cmd=['gh','api','repos/uprxiao/SmartDD/actions/artifacts/13121743482/zip','-H','Range: bytes=1024-2047']
result={'schema':'github-artifact-bounded-range-transport-probe-v1','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':cmd,'scope':'One 1024-byte range on this exact already-authorized installer archive; no installer test or release success claimed.'}
t=time.monotonic();data=bytearray()
with (e/'stderr.log').open('xb') as err:
 p=subprocess.Popen(cmd,env=env,stdout=subprocess.PIPE,stderr=err,start_new_session=True)
 selector=selectors.DefaultSelector();selector.register(p.stdout,selectors.EVENT_READ)
 try:
  while time.monotonic()-t<35:
   if selector.select(.5):
    chunk=os.read(p.stdout.fileno(),2049-len(data))
    if not chunk:break
    data.extend(chunk)
    if len(data)>1024:result['responseExceededRequestedRange']=True;break
  if p.poll() is None:
   if len(data)>1024 or time.monotonic()-t>=35:os.killpg(p.pid,signal.SIGTERM)
  try:result['exitCode']=p.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);result['exitCode']=p.wait(timeout=5)
 finally:
  selector.close();p.stdout.close()
  if p.poll() is None:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=5)
expected=(root/'downloaded-release/artifact-13121743482.zip').read_bytes()[1024:2048]
result.update(bytesReceived=len(data),rangeMatchesDownloadedPrefix=bytes(data)==expected,
              rangeVerified=result.get('exitCode')==0 and len(data)==1024 and bytes(data)==expected,
              sha256=hashlib.sha256(data).hexdigest(),elapsedSeconds=round(time.monotonic()-t,3))
(e/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
