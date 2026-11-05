from pathlib import Path
import json,subprocess,os,hashlib,datetime,time,sys
root=Path(__file__).parent;source=Path('/private/tmp/willyou-m12-p090-source-024/source');manifest=json.loads((source.parent/'source-inputs.json').read_text());deps=json.loads((root/'test-dependencies.json').read_text())
def verify():
 for rel,want in manifest['files'].items():
  p=source/rel;assert hashlib.sha256(p.read_bytes()).hexdigest()==want,rel;assert oct(p.stat().st_mode&0o777)==manifest['modes'][rel],rel
 for x in deps['files']:
  p=Path(x['path']);p=p if p.is_absolute() else source/p;assert hashlib.sha256(p.read_bytes()).hexdigest()==x['sha256'],str(p)
verify();cache=root/'cache';cache.mkdir(exist_ok=True);env=dict(os.environ,WILLYOU_TEST_CACHE_DIR=str(cache/'vite'),NODE_COMPILE_CACHE=str(cache/'node-compile'),npm_config_cache=str(cache/'npm'))
args=['node','scripts/run-tests.mjs','src/main/core/applications/__tests__/tool-service.test.ts','--maxWorkers=1','--fileParallelism=false','--reporter=default','--reporter=json','--reporter='+str(root/'raw-reporter.mjs'),'--outputFile='+str(root/'tool-service.json')];begin=time.monotonic();started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with(root/'tool-service.stdout.log').open('w') as out,(root/'tool-service.stderr.log').open('w') as err:
 p=subprocess.Popen(args,cwd=source,env=env,stdout=out,stderr=err);(root/'started.json').write_text(json.dumps({'pid':p.pid,'command':args,'startedAt':started,'cwd':str(source),'cache':str(cache)},indent=2)+'\n');print('test PID '+str(p.pid),flush=True);code=p.wait(timeout=300)
r={'command':args,'startedAt':started,'seconds':time.monotonic()-begin,'exitCode':code,'privateCache':str(cache),'sourceManifestSha256':hashlib.sha256((source.parent/'source-inputs.json').read_bytes()).hexdigest()}
if (root/'tool-service.json').exists():
 d=json.loads((root/'tool-service.json').read_text());r['counts']={k:d[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
verify();r['sourceAndDependenciesUnchanged']=True;(root/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True);sys.exit(code)
