import concurrent.futures,datetime,hashlib,json,os,shutil,subprocess,threading,time,zipfile
from pathlib import Path
root=Path(__file__).resolve().parent
e=root/'evidence/ci-download-resume-002';e.mkdir(exist_ok=False)
artifact=json.loads((root/'release-watch/attempt001/mac-arm64-artifact.json').read_text())
assert artifact['id']==13121743482 and artifact['workflow_run']['head_sha']=='44b46ca42cc8fff192c4fd8ae051431f369a2b8b'
assert json.loads((root/'evidence/ci-download-range-001/result.json').read_text())['rangeVerified']
assert json.loads((root/'evidence/ci-download-001/result.json').read_text())['status']=='failed'
assert json.loads((root/'evidence/ci-download-cancel-001/result.json').read_text())['intentionalTransportSwitch']
prefix=root/'downloaded-release/artifact-13121743482.zip'
offset=prefix.stat().st_size;total=artifact['size_in_bytes'];assert 0<offset<total
env=dict(os.environ)
for key in ['GH_TOKEN','GITHUB_TOKEN']:env.pop(key,None)
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as source:
  while b:=source.read(1024*1024):h.update(b)
 return h.hexdigest()
prefix_sha=digest(prefix)
result={'schema':'github-artifact-range-resume-v1','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'artifact':artifact,'prefixBytes':offset,'prefixSha256':prefix_sha,'parallelTransfers':4,
 'basis':'Original single stream observed slow. One1024-byte nonzero Range matched original prefix; disjoint bounded segments now resume identical archive. Original failure/cancellation retained.',
 'githubAuthorization':'Existing stored gh login; ambient GH_TOKEN/GITHUB_TOKEN removed; no App/Agent daily credentials used.',
 'status':'running'}
(e/'execution.json').write_text(json.dumps(result,indent=2)+'\n')
size=8*1024*1024;ranges=[(i,start,min(start+size,total)-1) for i,start in enumerate(range(offset,total,size))]
stop=threading.Event();start_time=time.monotonic()
def transfer(item):
 i,start,end=item
 if stop.is_set():return {'index':i,'status':'not-started-after-failure'}
 path=e/('segment-%03d.bin'%i);stderr=e/('segment-%03d.stderr.log'%i)
 cmd=['gh','api','repos/uprxiao/SmartDD/actions/artifacts/13121743482/zip','-H','Range: bytes=%d-%d'%(start,end)]
 row={'index':i,'start':start,'end':end,'command':cmd,'status':'running','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 t=time.monotonic()
 try:
  with path.open('xb') as out,stderr.open('xb') as err:
   child=subprocess.Popen(cmd,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True)
   row['pid']=child.pid
   (e/('segment-%03d.execution.json'%i)).write_text(json.dumps(row,indent=2)+'\n')
   try:row['exitCode']=child.wait(timeout=240)
   except subprocess.TimeoutExpired:
    os.killpg(child.pid,15)
    try:child.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(child.pid,9);child.wait(timeout=5)
    raise
  row['bytes']=path.stat().st_size
  assert row['exitCode']==0 and row['bytes']==end-start+1
  row.update(status='passed',sha256=digest(path))
 except Exception as error:
  stop.set();row.update(status='failed',error=type(error).__name__+': '+str(error))
 row['elapsedSeconds']=round(time.monotonic()-t,3)
 (e/('segment-%03d.result.json'%i)).write_text(json.dumps(row,indent=2)+'\n')
 return row
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(transfer,ranges))
 result['segments']=rows
 assert all(row['status']=='passed' for row in rows)
 assert prefix.stat().st_size==offset and digest(prefix)==prefix_sha
 archive=root/'downloaded-release/artifact-13121743482-resumed.zip'
 with archive.open('xb') as out:
  with prefix.open('rb') as source:shutil.copyfileobj(source,out)
  for i,_,_ in ranges:
   with (e/('segment-%03d.bin'%i)).open('rb') as source:shutil.copyfileobj(source,out)
 result['archiveBytes']=archive.stat().st_size;result['archiveSha256']=digest(archive)
 assert result['archiveBytes']==total and 'sha256:'+result['archiveSha256']==artifact['digest']
 package=root/'downloaded-release/ci-artifact';assert not any(package.iterdir())
 expected={'WillYou-0.1.1-mac-arm64.dmg','manifest-mac-arm64.json'}
 with zipfile.ZipFile(archive) as z:
  assert set(z.namelist())==expected
  for item in z.infolist():
   assert item.filename in expected and not item.is_dir() and item.file_size<1024*1024*1024
   with z.open(item) as source,(package/item.filename).open('xb') as target:shutil.copyfileobj(source,target)
 manifest=json.loads((package/'manifest-mac-arm64.json').read_text())
 assert manifest['version']=='0.1.1' and manifest['commit']==artifact['workflow_run']['head_sha'] and manifest['dirty'] is False
 assert manifest['platform']=='mac' and manifest['arch']=='arm64' and len(manifest['files'])==1
 image=manifest['files'][0];assert image['file']=='WillYou-0.1.1-mac-arm64.dmg'
 assert image['size']==(package/image['file']).stat().st_size and image['sha256']==digest(package/image['file'])
 result.update(status='passed',producer=manifest,package=str(package))
except Exception as error:result.update(status='failed',error=type(error).__name__+': '+str(error))
finally:
 result['elapsedSeconds']=round(time.monotonic()-start_time,3);result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 (e/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({key:value for key,value in result.items() if key!='segments'}))
raise SystemExit(0 if result['status']=='passed' else 1)
