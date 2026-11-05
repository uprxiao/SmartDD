import json,hashlib,os,subprocess,time,datetime
from pathlib import Path
r=Path('/private/tmp/willyou-m12-t29-effective-policy-suite-001');w=r/'work';m=json.loads((r/'input-manifest.json').read_text())
def changed():
 out=[]
 for rel,want in m['sourceFiles'].items():
  p=w/rel
  if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=want or (p.stat().st_mode&0o777)!=int(m['modes'][rel],8):out.append(rel)
 return out
assert not changed(),changed()
pins=[]
for link in m['privatePackageLinks']:
 rel,target=link['path'],link['target'];p=w/rel
 assert p.is_symlink() and str(p.resolve())==target,rel
 j=p/'package.json';q=json.loads(j.read_text());pins.append({'path':rel,'target':target,'name':q.get('name'),'version':q.get('version'),'packageJsonSha256':hashlib.sha256(j.read_bytes()).hexdigest()})
(r/'dependency-pins.json').write_text(json.dumps(pins,indent=2)+'\n')
cache=r/'cache';cache.mkdir(exist_ok=True)
env=dict(os.environ,WILLYOU_TEST_CACHE_DIR=str(cache/'vitest'),NODE_COMPILE_CACHE=str(cache/'node'),npm_config_cache=str(cache/'npm'))
cmd=['/Users/liubu/.hermes/node/bin/node',str(w/'node_modules/vitest/vitest.mjs'),'run','src/main/core/applications/__tests__/codex-effective-sandbox.test.ts','--config',str(w/'vitest.config.ts'),'--maxWorkers','1','--reporter=json','--outputFile',str(r/'vitest-result.json')]
(r/'execution.json').write_text(json.dumps({'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cwd':str(w),'command':cmd,'privateCache':{k:env[k] for k in ['WILLYOU_TEST_CACHE_DIR','NODE_COMPILE_CACHE','npm_config_cache']},'sourceFilesVerified':len(m['sourceFiles']),'packagesPinned':len(pins),'scope':m['scope']},indent=2)+'\n')
t=time.monotonic()
with (r/'stdout.log').open('w') as out,(r/'stderr.log').open('w') as err:
 p=subprocess.run(cmd,cwd=w,env=env,stdout=out,stderr=err,timeout=90)
result={'exitCode':p.returncode,'seconds':time.monotonic()-t,'changedSourceFiles':changed(),'resultFileExists':(r/'vitest-result.json').exists()};(r/'execution-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if (r/'vitest-result.json').exists():
 d=json.loads((r/'vitest-result.json').read_text());print(json.dumps({k:d.get(k) for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTotalTestSuites','success']}))
raise SystemExit(p.returncode or bool(result['changedSourceFiles']))
