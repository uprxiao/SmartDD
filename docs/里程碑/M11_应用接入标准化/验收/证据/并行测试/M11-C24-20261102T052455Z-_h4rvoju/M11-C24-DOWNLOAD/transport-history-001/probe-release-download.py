import datetime,json,os,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parent;e=root/'evidence/release-download-probe-001';e.mkdir(exist_ok=False)
out=e/'prefix.bin';env=dict(os.environ)
for k in ['GH_TOKEN','GITHUB_TOKEN']:env.pop(k,None)
cmd=['gh','api','repos/uprxiao/SmartDD/releases/assets/700888229','-H','Accept: application/octet-stream','-H','Range: bytes=0-4194303']
r={'schema':'released-asset-transport-probe-v1','assetId':700888229,'expectedFullSize':609272511,'expectedFullSha256':'cefce360069f0d80615ee2692b925ce2f089d8fdcf76b66aeb5070151e78c353','command':cmd,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'running'}
t=time.monotonic()
with out.open('xb') as f,(e/'stderr.log').open('xb') as err:
 p=subprocess.Popen(cmd,env=env,stdout=f,stderr=err,start_new_session=True);r['pid']=p.pid
 try:
  while p.poll() is None and time.monotonic()-t<40 and out.stat().st_size<=4194303+1024:time.sleep(.1)
  if p.poll() is None:os.killpg(p.pid,15)
  try:r['exitCode']=p.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(p.pid,9);r['exitCode']=p.wait(timeout=5)
 finally:
  if p.poll() is None:os.killpg(p.pid,15);p.wait(timeout=5)
r.update(bytes=out.stat().st_size,elapsedSeconds=round(time.monotonic()-t,3));r['status']='range-complete' if r['exitCode']==0 and r['bytes']==4194304 else 'range-incomplete';r['mibPerSecond']=round(r['bytes']/1024/1024/r['elapsedSeconds'],3)
(e/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
