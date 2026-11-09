from pathlib import Path
import hashlib,json,datetime,os,subprocess,time,sys
root=Path('/Users/liubu/hx/4.uprxiao/SmartDD');out=Path('/private/tmp/willyou-m12-tab-tooltip-App037-build-002');manifest=Path('/private/tmp/willyou-m12-tab-tooltip-source-044/source-inputs.json');source=json.loads(manifest.read_text());node='/Users/liubu/.hermes/node/bin/node'
lease=json.loads((out/'lease.receipt.json').read_text());assert lease['status']=='granted' and lease['coordinator']=='root';assert lease['sourceManifestSHA256']==hashlib.sha256(manifest.read_bytes()).hexdigest();assert not (out/'started.json').exists();assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(lease['expiresAt']);result={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceManifestSHA256':hashlib.sha256(manifest.read_bytes()).hexdigest(),'sourceFiles':len(source['files']),'actualBuildCwd':str(root),'phases':[],'boundary':'Official local arm64 App037; source044 controlled tab tooltip and scoped parking lifecycle. Actual73 software +297 prototype model and dual TS passed; affected real App UI and installed S6 remain pending. No x64 or release.', 'formalIncrement':0, 'UAndTypeReuse':'Actual73 software/297prototype models and dualTS; 3691 sourceSHA/mode verification before/after. Native smoke only counted from this actual build'};(out/'started.json').write_text(json.dumps({'pid':os.getpid(),**result},indent=2))
def verify():
 bad=[]
 for rel,sha in source['files'].items():
  p=root/rel
  if hashlib.sha256(p.read_bytes()).hexdigest()!=sha or p.stat().st_mode&511!=source['modes'][rel]:bad.append(rel)
 assert not bad,bad
 return {'files':len(source['files']),'mismatches':bad}
env=dict(os.environ);env.update(WILLYOU_TEST_CACHE_DIR=str(out/'cache/vitest'),NODE_COMPILE_CACHE=str(out/'cache/node'),TMPDIR=str(out/'tmp')+'/',SMARTDD_SIGN='0',CSC_IDENTITY_AUTO_DISCOVERY='false')
phases=[('official-App037-directory',[node,'scripts/release/build.mjs','--dir','--platform','mac','--arch','arm64','--output-dir','/private/tmp/willyou-m12-s2-package-037'])]
try:
 result['before']=verify()
 for label,cmd in phases:
  start=time.monotonic();row={'label':label,'command':cmd,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};result['phases'].append(row)
  with (out/(label+'.private.log')).open('wb') as log:
   child=subprocess.Popen(cmd,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT);row['pid']=child.pid;print(json.dumps({'phase':label,'pid':child.pid}),flush=True);row['exitCode']=child.wait(timeout=480)
  row['seconds']=time.monotonic()-start;row['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();row['sourceAfter']=verify();(out/'live.json').write_text(json.dumps(result,indent=2));print(json.dumps({'phase':label,'exitCode':row['exitCode'],'seconds':row['seconds']}),flush=True)
  if row['exitCode']!=0:raise RuntimeError('Phase failed: '+label)
 app=Path('/private/tmp/willyou-m12-s2-package-037/mac-arm64/WillYou.app');assert app.is_dir();result['actualApp']=str(app);result['pins']={name:hashlib.sha256(p.read_bytes()).hexdigest() for name,p in [('app.asar',app/'Contents/Resources/app.asar'),('executable',app/'Contents/MacOS/WillYou')]};result['exitCode']=0;result['sourceShaModeBeforeAfterMatched']=True
except Exception as e:
 result['exitCode']=1;result['error']={'type':type(e).__name__,'message':str(e)}
finally:
 result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(out/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps({'exitCode':result['exitCode'],'phases':[(r['label'],r.get('exitCode')) for r in result['phases']],'pins':result.get('pins')}),flush=True)
sys.exit(result['exitCode'])
