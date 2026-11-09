from pathlib import Path
import json,subprocess,os,hashlib,datetime,time,re,sys
root=Path(__file__).parent;source=Path('/private/tmp/willyou-m12-p078-source-021/source');manifest=json.loads((source.parent/'source-inputs.json').read_text())
def verify():
 for rel,wanted in manifest['files'].items():
  p=source/rel;assert hashlib.sha256(p.read_bytes()).hexdigest()==wanted,rel;assert oct(p.stat().st_mode&0o777)==manifest['modes'][rel],rel
verify();cache=root/'cache';cache.mkdir();(cache/'node').mkdir();(cache/'web').mkdir();env=dict(os.environ,WILLYOU_TEST_CACHE_DIR=str(cache/'vite'),NODE_COMPILE_CACHE=str(cache/'node-compile'),npm_config_cache=str(cache/'npm'));results=[]
commands=[('node-types',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','--tsBuildInfoFile',str(cache/'node/buildinfo'),'-p','tsconfig.node.json'],source),('web-types',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','--tsBuildInfoFile',str(cache/'web/buildinfo'),'-p','tsconfig.web.json'],source),('m9-models',['node','--test','--test-concurrency=1','--test-reporter=tap',*[str(p.relative_to(source/'prototypes/m6-codex'))for p in sorted((source/'prototypes/m6-codex/tests').glob('file-*.test.mjs'))]],source/'prototypes/m6-codex')]
for label,args,cwd in commands:
 started=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic()
 with(root/(label+'.stdout.log')).open('w')as out,(root/(label+'.stderr.log')).open('w')as err:result=subprocess.run(args,cwd=cwd,env=env,stdout=out,stderr=err,timeout=180)
 r={'label':label,'command':args,'cwd':str(cwd),'startedAt':started,'seconds':time.monotonic()-t,'exitCode':result.returncode};results.append(r)
 if label=='m9-models':
  text=(root/(label+'.stdout.log')).read_text();r['actualTAP']={k:int(re.findall(r'^# '+k+r' (\d+)$',text,re.M)[-1])for k in ['tests','pass','fail','skipped','cancelled']};r['scriptEquivalence']='npm run test:m9 exactfileglob; onlysequentialrunner andTAPreporter explicit'
 (root/'pure-checks-live.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(r),flush=True)
 if result.returncode:sys.exit(result.returncode)
 if label=='m9-models':assert r['actualTAP']['tests']>0 and r['actualTAP']['pass']==r['actualTAP']['tests']and not r['actualTAP']['fail']and not r['actualTAP']['skipped']and not r['actualTAP']['cancelled']
verify();(root/'pure-checks.json').write_text(json.dumps({'sourceManifestSha256':hashlib.sha256((source.parent/'source-inputs.json').read_bytes()).hexdigest(),'checks':results,'allInputsBeforeAfterMatch':True,'status':'pure-software-gates-passed','boundary':'types/models only; actualApp/UI/CPU acceptance pending'},indent=2)+'\n')
