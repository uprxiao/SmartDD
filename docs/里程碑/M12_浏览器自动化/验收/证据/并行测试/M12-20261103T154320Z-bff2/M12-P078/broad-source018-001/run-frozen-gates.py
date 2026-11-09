from pathlib import Path
import json,hashlib,subprocess,os,datetime,time,sys
root=Path(__file__).parent;source=Path('/private/tmp/willyou-m12-p078-source-018/source');manifest=json.loads((source.parent/'source-inputs.json').read_text());deps=json.loads((root/'test-dependencies.json').read_text())
def check_inputs():
 for name,wanted in manifest['files'].items():
  p=source/name
  assert hashlib.sha256(p.read_bytes()).hexdigest()==wanted,name
  assert oct(p.stat().st_mode&0o777)==manifest['modes'][name],name
 for row in deps['files']:
  p=Path(row['path']) if row.get('sharedReadOnlyDependency') else source/row['path']
  assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256'],row['path']
check_inputs();env=dict(os.environ,WILLYOU_TEST_CACHE_DIR=str(root/'frozen-cache'));results=[]
commands=[('frozen-integration',['node','scripts/run-tests.mjs','src/main/core/applications/__tests__/native-user-messages.test.ts','src/main/core/applications/__tests__/session-diagnostics.test.ts','src/main/core/applications/__tests__/skill-observation-monitor.test.ts','src/main/core/applications/__tests__/task-capability-launcher.test.ts','--maxWorkers=1','--fileParallelism=false','--reporter=json','--outputFile='+str(root/'frozen-vitest.json')]),('node-types',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','--tsBuildInfoFile',str(root/'frozen-cache/node.tsbuildinfo'),'-p','tsconfig.node.json'])]
for label,args in commands:
 begin=time.monotonic();start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (root/(label+'.stdout.log')).open('w') as out,(root/(label+'.stderr.log')).open('w') as err:
  proc=subprocess.run(args,cwd=source,env=env,stdout=out,stderr=err)
 result={'label':label,'command':args,'cwd':str(source),'cache':env['WILLYOU_TEST_CACHE_DIR'],'startedAt':start,'seconds':time.monotonic()-begin,'exitCode':proc.returncode};results.append(result)
 if label=='frozen-integration' and (root/'frozen-vitest.json').exists():
  d=json.loads((root/'frozen-vitest.json').read_text());result['actualAssertions']={k:d[k]for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 (root/'frozen-gates-live.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True)
 if proc.returncode:sys.exit(proc.returncode)
check_inputs();out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceManifestSha256':hashlib.sha256((source.parent/'source-inputs.json').read_bytes()).hexdigest(),'testDependenciesSha256':hashlib.sha256((root/'test-dependencies.json').read_bytes()).hexdigest(),'checks':results,'frozenSourceAndDependenciesBeforeAfterMatch':True,'status':'software-gates-passed','boundary':'Native-backed software only; no actualApp019/CPU30min or formalcase pass'};(root/'frozen-gates.json').write_text(json.dumps(out,indent=2)+'\n')
