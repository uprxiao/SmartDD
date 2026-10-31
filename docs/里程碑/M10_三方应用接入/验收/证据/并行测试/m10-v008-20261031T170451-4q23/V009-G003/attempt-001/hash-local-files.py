from pathlib import Path
import json,hashlib,os,stat,datetime,time,re
BASE=Path('/private/tmp/willyou-v008-integration-4q23427h/evidence/V009-G003/attempt-001')
INPUT=Path('/private/tmp/willyou-v008-integration-4q23427h/evidence/v009-public-assets-frozen-inputs.json')
ROOT=Path('/private/tmp/willyou-m10-v009-downloads-601aa58648604b3e825c596143583282')
EXPECTED='d7903e097f6b63bef40412ee090f7024e7a0f9601ddaddc52ac7d9b33e5329f6'
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(path):
 h=hashlib.sha256();n=0
 with path.open('rb') as stream:
  while True:
   block=stream.read(1024*1024)
   if not block:break
   h.update(block);n+=len(block)
 return h.hexdigest(),n
def state(path):
 s=path.lstat()
 return {'path':str(path),'bytes':s.st_size,'mode':stat.S_IMODE(s.st_mode),'mtimeNs':s.st_mtime_ns,'regular':stat.S_ISREG(s.st_mode),'symlink':stat.S_ISLNK(s.st_mode)}
start=now();clock=time.monotonic();input_bytes=INPUT.read_bytes();assert hashlib.sha256(input_bytes).hexdigest()==EXPECTED,'Input manifest SHA mismatch';m=json.loads(input_bytes)
assert len(m['files'])==12 and m['downloadCommandExit']==0
assert m['version']=='0.0.9' and m['commit']=='a6bfc60873a0c68e8ac630e2c9b951db04db82c8'
assert len({f['name'] for f in m['files']})==12
assert {p.name for p in ROOT.iterdir()}=={f['name'] for f in m['files']},'Exact download inventory'
before={'at':start,'pid':os.getpid(),'inputManifest':state(INPUT),'inputManifestSha256':EXPECTED,'api':{},'files':[]}
for key in ['sourceApi','actionsApi']:
 p=Path(m[key]['path']);h,n=digest(p);assert h==m[key]['sha256'],key+' frozen SHA';before['api'][key]={**state(p),'sha256':h}
for f in m['files']:
 p=Path(f['path']);assert p==ROOT/f['name'] and p.parent==ROOT
 s=state(p);assert s['regular'] and not s['symlink'];assert s['mode']==f['mode']==0o400;assert s['bytes']==f['bytes'] and s['mtimeNs']==f['mtimeNs'];before['files'].append(s)
(BASE/'frozen-before.json').write_text(json.dumps(before,indent=2)+'\n')
results=[]
with (BASE/'streaming-hash.log').open('w') as log:
 for f in m['files']:
  p=Path(f['path']);started=now();t=time.monotonic();h,n=digest(p);expected=f['expectedGitHubDigest'];assert re.fullmatch(r'sha256:[0-9a-f]{64}',expected)
  r={'name':f['name'],'path':str(p),'bytes':n,'sha256':h,'expectedGitHubDigest':expected,'sizeMatchesFrozenInput':n==f['bytes'],'digestMatchesFrozenInput':expected=='sha256:'+h,'start':started,'end':now(),'durationSeconds':round(time.monotonic()-t,6)}
  results.append(r);line=json.dumps(r);log.write(line+'\n');log.flush();print(line,flush=True)
  if not r['sizeMatchesFrozenInput'] or not r['digestMatchesFrozenInput']:
   (BASE/'local-hashes.json').write_text(json.dumps({'status':'failed','start':start,'end':now(),'pid':os.getpid(),'files':results},indent=2)+'\n');raise RuntimeError('Local file differs from frozen GitHub digest/size: '+f['name'])
result={'schema':'v009-g003-streaming-hashes-v1','status':'passed','start':start,'end':now(),'durationSeconds':round(time.monotonic()-clock,6),'pid':os.getpid(),'chunkBytes':1024*1024,'files':results,'totalFiles':len(results),'totalBytes':sum(r['bytes'] for r in results)}
(BASE/'local-hashes.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','totalFiles':len(results),'totalBytes':result['totalBytes'],'durationSeconds':result['durationSeconds']}),flush=True)
