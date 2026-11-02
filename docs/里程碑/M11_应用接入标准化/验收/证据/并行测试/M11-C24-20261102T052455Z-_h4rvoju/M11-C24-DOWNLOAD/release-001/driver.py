import concurrent.futures,datetime,hashlib,json,os,shutil,subprocess,threading,time
from pathlib import Path
root=Path(__file__).resolve().parent;e=root/'evidence/release-download-001';e.mkdir(exist_ok=False)
env=dict(os.environ)
for k in ['GH_TOKEN','GITHUB_TOKEN']:env.pop(k,None)
def gh(args,name):
 p=subprocess.run(['gh']+args,env=env,capture_output=True,timeout=35)
 (e/name).write_bytes(p.stdout);(e/(name+'.stderr.log')).write_bytes(p.stderr);assert p.returncode==0
 return p.stdout
release=json.loads(gh(['api','repos/uprxiao/SmartDD/releases/tags/v0.1.1'],'release-api.json'))
assert release['id']==431168778 and release['draft'] is False and release['prerelease'] is True
asset=next(a for a in release['assets'] if a['id']==700888229)
assert asset['name']=='WillYou-0.1.1-mac-arm64.dmg' and asset['size']==609272511
assert asset['digest']=='sha256:cefce360069f0d80615ee2692b925ce2f089d8fdcf76b66aeb5070151e78c353'
ma=next(a for a in release['assets'] if a['name']=='manifest-mac-arm64.json')
raw=gh(['api','repos/uprxiao/SmartDD/releases/assets/'+str(ma['id']),'-H','Accept: application/octet-stream'],'manifest-mac-arm64.json')
assert 'sha256:'+hashlib.sha256(raw).hexdigest()==ma['digest']
manifest=json.loads(raw)
assert manifest['version']=='0.1.1' and manifest['commit']=='44b46ca42cc8fff192c4fd8ae051431f369a2b8b' and manifest['dirty'] is False
assert manifest['platform']=='mac' and manifest['arch']=='arm64' and len(manifest['files'])==1
assert manifest['files'][0]['file']==asset['name'] and manifest['files'][0]['size']==asset['size'] and 'sha256:'+manifest['files'][0]['sha256']==asset['digest']
prefix=root/'evidence/release-download-probe-001/prefix.bin'
pr=json.loads((prefix.parent/'result.json').read_text());assert pr['status']=='range-complete' and prefix.stat().st_size==4194304
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  while b:=f.read(1024*1024):h.update(b)
 return h.hexdigest()
r={'schema':'actual-public-release-installer-download-v1','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
   'releaseId':release['id'],'releaseUrl':release['html_url'],'releaseCommit':manifest['commit'],'asset':asset,'producer':manifest,
   'prefixBytes':prefix.stat().st_size,'prefixSha256':digest(prefix),'parallelTransfers':4,
   'artifactOrigin':'github-release-arm64','status':'running','boundary':'Actual published DMG via Release CDN; aborted Actions ZIP histories retained, not claimed complete. Existing gh login only; no daily App/Agent credentials.'}
(e/'execution.json').write_text(json.dumps(r,indent=2)+'\n');t=time.monotonic();stop=threading.Event()
chunk=8*1024*1024;ranges=[(i,s,min(s+chunk,asset['size'])-1) for i,s in enumerate(range(prefix.stat().st_size,asset['size'],chunk))]
def transfer(item):
 i,start,end=item
 if stop.is_set():return {'index':i,'status':'not-started-after-failure'}
 out=e/('segment-%03d.bin'%i);row={'index':i,'start':start,'end':end,'status':'running'};begin=time.monotonic()
 cmd=['gh','api','repos/uprxiao/SmartDD/releases/assets/700888229','-H','Accept: application/octet-stream','-H','Range: bytes=%d-%d'%(start,end)]
 try:
  with out.open('xb') as f,(e/('segment-%03d.stderr.log'%i)).open('xb') as err:
   child=subprocess.Popen(cmd,env=env,stdin=subprocess.DEVNULL,stdout=f,stderr=err,start_new_session=True);row.update(pid=child.pid,command=cmd)
   (e/('segment-%03d.execution.json'%i)).write_text(json.dumps(row,indent=2)+'\n')
   try:row['exitCode']=child.wait(timeout=180)
   except subprocess.TimeoutExpired:
    os.killpg(child.pid,15)
    try:child.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(child.pid,9);child.wait(timeout=5)
    raise
  row['bytes']=out.stat().st_size;assert row['exitCode']==0 and row['bytes']==end-start+1
  row.update(status='passed',sha256=digest(out))
 except Exception as error:stop.set();row.update(status='failed',error=type(error).__name__+': '+str(error))
 row['elapsedSeconds']=round(time.monotonic()-begin,3)
 (e/('segment-%03d.result.json'%i)).write_text(json.dumps(row,indent=2)+'\n');return row
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(transfer,ranges))
 r['segments']=rows;assert all(x['status']=='passed' for x in rows)
 package=root/'downloaded-release/ci-artifact';assert not any(package.iterdir())
 image=package/asset['name']
 with image.open('xb') as out:
  with prefix.open('rb') as f:shutil.copyfileobj(f,out)
  for i,_,_ in ranges:
   with (e/('segment-%03d.bin'%i)).open('rb') as f:shutil.copyfileobj(f,out)
 r['imageBytes']=image.stat().st_size;r['imageSha256']=digest(image)
 assert r['imageBytes']==asset['size'] and 'sha256:'+r['imageSha256']==asset['digest']
 (package/'manifest-mac-arm64.json').write_bytes(raw)
 r.update(status='passed',package=str(package))
except Exception as error:r.update(status='failed',error=type(error).__name__+': '+str(error))
finally:
 r['elapsedSeconds']=round(time.monotonic()-t,3);r['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 (e/'result.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({k:v for k,v in r.items() if k not in ['segments','asset']}));raise SystemExit(0 if r['status']=='passed' else 1)
