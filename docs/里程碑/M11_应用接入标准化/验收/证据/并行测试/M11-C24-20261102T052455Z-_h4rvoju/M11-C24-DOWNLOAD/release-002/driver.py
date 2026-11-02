import concurrent.futures,datetime,hashlib,json,os,shutil,subprocess,threading,time
from pathlib import Path
r=Path(__file__).resolve().parent;old=r/'evidence/release-download-001';e=r/'evidence/release-download-002';e.mkdir(exist_ok=False)
prior=json.loads((old/'result.json').read_text());assert prior['status']=='failed'
assert 'EOF' in (old/'segment-017.stderr.log').read_text()
release=json.loads((old/'release-api.json').read_text());assert release['id']==431168778 and release['draft'] is False and release['prerelease'] is True
asset=next(x for x in release['assets'] if x['id']==700888229)
producer=(old/'manifest-mac-arm64.json').read_bytes();manifest=json.loads(producer)
assert manifest['commit']=='44b46ca42cc8fff192c4fd8ae051431f369a2b8b' and manifest['dirty'] is False
assert 'sha256:'+manifest['files'][0]['sha256']==asset['digest']
prefix=r/'evidence/release-download-probe-001/prefix.bin';assert prefix.stat().st_size==4194304
env=dict(os.environ)
for k in ['GH_TOKEN','GITHUB_TOKEN']:env.pop(k,None)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1024*1024):h.update(b)
 return h.hexdigest()
assert sha(prefix)==prior['prefixSha256']
cache={x['index']:x for x in prior['segments'] if x['status']=='passed'}
for i,x in cache.items():assert sha(old/('segment-%03d.bin'%i))==x['sha256']
chunk=8*1024*1024;items=[(i,s,min(s+chunk,asset['size'])-1) for i,s in enumerate(range(prefix.stat().st_size,asset['size'],chunk))]
stop=threading.Event();lock=threading.Lock();budget=[4]
result={'schema':'released-installer-transport-continuation-v1','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'running','assetId':asset['id'],'releaseUrl':release['html_url'],'releaseCommit':manifest['commit'],'prefixBytes':prefix.stat().st_size,'reusedSegments':len(cache),'basis':'Original segment017 GH API EOF with zero bytes; preserve all original raw and reuse hash-verified complete segments. At most one retry per transient EOF and4total; no business test or source changed.','artifactOrigin':'github-release-arm64'}
(e/'execution.json').write_text(json.dumps(result,indent=2)+'\n');start_time=time.monotonic()
def transfer(item):
 i,start,end=item
 if i in cache:return dict(cache[i],reused=True,file=str(old/('segment-%03d.bin'%i)))
 if stop.is_set():return {'index':i,'status':'not-started-after-failure'}
 attempts=[]
 for attempt in [1,2]:
  path=e/('segment-%03d-attempt-%d.bin'%(i,attempt));err=e/('segment-%03d-attempt-%d.stderr.log'%(i,attempt));row={'index':i,'start':start,'end':end,'attempt':attempt,'file':str(path)}
  cmd=['gh','api','repos/uprxiao/SmartDD/releases/assets/700888229','-H','Accept: application/octet-stream','-H','Range: bytes=%d-%d'%(start,end)]
  try:
   with path.open('xb') as out,err.open('xb') as log:
    child=subprocess.Popen(cmd,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=log,start_new_session=True);row.update(pid=child.pid,command=cmd)
    (e/('segment-%03d-attempt-%d.execution.json'%(i,attempt))).write_text(json.dumps(row,indent=2)+'\n')
    try:row['exitCode']=child.wait(timeout=180)
    except subprocess.TimeoutExpired:
     os.killpg(child.pid,15)
     try:child.wait(timeout=10)
     except subprocess.TimeoutExpired:os.killpg(child.pid,9);child.wait(timeout=5)
     raise
   row['bytes']=path.stat().st_size;assert row['exitCode']==0 and row['bytes']==end-start+1
   row.update(status='passed',sha256=sha(path))
  except Exception as error:row.update(status='failed',error=type(error).__name__+': '+str(error))
  attempts.append(row);(e/('segment-%03d-attempt-%d.result.json'%(i,attempt))).write_text(json.dumps(row,indent=2)+'\n')
  if row['status']=='passed':return dict(row,attempts=attempts)
  retry=False
  if attempt==1 and 'EOF' in err.read_text():
   with lock:
    if budget[0]>0:budget[0]-=1;retry=True
  if not retry:stop.set();return dict(row,attempts=attempts)
  time.sleep(.5)
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(transfer,items))
 result['segments']=rows;assert all(x['status']=='passed' for x in rows)
 package=r/'downloaded-release/ci-artifact';assert not any(package.iterdir());image=package/asset['name']
 with image.open('xb') as out:
  with prefix.open('rb') as source:shutil.copyfileobj(source,out)
  for row in sorted(rows,key=lambda x:x['index']):
   with Path(row['file']).open('rb') as source:shutil.copyfileobj(source,out)
 result['imageBytes']=image.stat().st_size;result['imageSha256']=sha(image)
 assert result['imageBytes']==asset['size'] and 'sha256:'+result['imageSha256']==asset['digest']
 (package/'manifest-mac-arm64.json').write_bytes(producer);result.update(status='passed',producer=manifest,package=str(package))
except Exception as error:result.update(status='failed',error=type(error).__name__+': '+str(error))
finally:
 result['elapsedSeconds']=round(time.monotonic()-start_time,3);result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 (e/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='segments'}));raise SystemExit(0 if result['status']=='passed' else 1)
