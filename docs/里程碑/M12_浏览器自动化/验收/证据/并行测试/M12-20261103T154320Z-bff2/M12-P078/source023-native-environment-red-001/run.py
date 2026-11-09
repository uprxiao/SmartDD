from pathlib import Path
import json,subprocess,os,hashlib,datetime,time,sys,re
root=Path(__file__).parent;source=Path('/private/tmp/willyou-m12-p078-source-023/source');manifest=json.loads((source.parent/'source-inputs.json').read_text());deps=json.loads((root/'test-dependencies.json').read_text());results=[]
def verify():
 for rel,want in manifest['files'].items():
  p=source/rel;assert hashlib.sha256(p.read_bytes()).hexdigest()==want,rel;assert oct(p.stat().st_mode&0o777)==manifest['modes'][rel],rel
 for x in deps['files']:
  p=Path(x['path']);p=p if p.is_absolute() else source/p;assert hashlib.sha256(p.read_bytes()).hexdigest()==x['sha256'],str(p)
verify();cache=root/'cache';cache.mkdir();env=dict(os.environ,WILLYOU_TEST_CACHE_DIR=str(cache/'vite'),NODE_COMPILE_CACHE=str(cache/'node-compile'),npm_config_cache=str(cache/'npm'))
commands=[('focused-observation',['node','scripts/run-tests.mjs','src/main/core/applications/__tests__/native-user-messages.test.ts','src/main/core/applications/__tests__/session-diagnostics.test.ts','src/main/core/applications/__tests__/skill-observation-monitor.test.ts','--maxWorkers=1','--fileParallelism=false','--reporter=default','--reporter=json','--reporter='+str(root/'raw-reporter.mjs'),'--outputFile='+str(root/'focused-observation.json')],source,108),('launcher-five',['node','scripts/run-tests.mjs','src/main/core/applications/__tests__/task-capability-launcher.test.ts','--testNamePattern',json.loads((root/'selection.json').read_text())['pattern'],'--maxWorkers=1','--fileParallelism=false','--hideSkippedTests','--reporter=default','--reporter=json','--reporter='+str(root/'raw-reporter.mjs'),'--outputFile='+str(root/'launcher-five.json')],source,5),('m9-models',['node','--test','--test-concurrency=1','--test-reporter=tap',*[str(p.relative_to(source/'prototypes/m6-codex')) for p in sorted((source/'prototypes/m6-codex/tests').glob('file-*.test.mjs'))]],source/'prototypes/m6-codex',297)]
for label,args,cwd,expected in commands:
 begin=time.monotonic();started=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with(root/(label+'.stdout.log')).open('w') as out,(root/(label+'.stderr.log')).open('w') as err:r=subprocess.run(args,cwd=cwd,env=env,stdout=out,stderr=err,timeout=480 if label=='focused-observation' else 240)
 receipt={'label':label,'startedAt':started,'seconds':time.monotonic()-begin,'command':args,'cwd':str(cwd),'exitCode':r.returncode}
 if label=='m9-models':
  t=(root/(label+'.stdout.log')).read_text();counts={k:int(re.findall(r'^# '+k+r' (\d+)$',t,re.M)[-1]) for k in ['tests','pass','fail','skipped','cancelled']};receipt['actualTAP']=counts;ok=counts['tests']==expected and counts['pass']==expected and not any(counts[k] for k in ['fail','skipped','cancelled'])
 else:
  d=json.loads((root/(label+'.json')).read_text());receipt['counts']={k:d[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']};ok=d['numPassedTests']==expected and d['numFailedTests']==0
 results.append(receipt);(root/'gates-live.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(receipt),flush=True);verify()
 if r.returncode or not ok:sys.exit(r.returncode or 2)
verify();final={'sourceManifestSha256':hashlib.sha256((source.parent/'source-inputs.json').read_bytes()).hexdigest(),'checks':results,'all3682InputsAnd320DependenciesBeforeAfterMatch':True,'status':'focused-final-gates-passed','boundary':'software only; actualApp/UI/CPU pending'};(root/'result.json').write_text(json.dumps(final,indent=2)+'\n')
