from pathlib import Path
import os,json,hashlib,subprocess,time,datetime,sys
root=Path(__file__).parent;public=Path('/Users/liubu/hx/4.uprxiao/SmartDD');source=Path('/private/tmp/willyou-m12-p123-source-027');manifest=json.loads((source/'source-inputs.json').read_text());gate=root/'prebuild-gates.json';assert gate.is_file(),'Final gates must complete before build';g=json.loads(gate.read_text());assert g['status']=='renderer-task-id-prebuild-gates-passed' and g['sourceManifestSha256']==hashlib.sha256((source/'source-inputs.json').read_bytes()).hexdigest()
def verify():
 for rel,want in manifest['files'].items():
  p=public/rel;assert hashlib.sha256(p.read_bytes()).hexdigest()==want,rel;assert oct(p.stat().st_mode&0o777)==manifest['modes'][rel],rel
verify();env=dict(os.environ,WILLYOU_TEST_CACHE_DIR=str(root/'cache/vite'),NODE_COMPILE_CACHE=str(root/'cache/node-compile'),npm_config_cache=str(root/'cache/npm'));args=['/Users/liubu/.hermes/node/bin/node','scripts/release/build.mjs','--dir','--output-dir','/private/tmp/willyou-m12-s2-package-023'];env['PATH']='/Users/liubu/.hermes/node/bin:'+env.get('PATH','');started=datetime.datetime.now(datetime.timezone.utc).isoformat();begin=time.monotonic()
with(root/'stdout.log').open('w') as out,(root/'stderr.log').open('w') as err:
 p=subprocess.Popen(args,cwd=public,env=env,stdout=out,stderr=err)
 (root/'started.json').write_text(json.dumps({'at':started,'coordinatorPid':os.getpid(),'buildPid':p.pid,'command':args,'cwd':str(public),'sourceManifestSha256':g['sourceManifestSha256']},indent=2)+'\n');print('official App023 build PID '+str(p.pid),flush=True);code=p.wait(timeout=1500)
verify();r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'startedAt':started,'seconds':time.monotonic()-begin,'command':args,'exitCode':code,'sourceManifestSha256':g['sourceManifestSha256'],'sourceFiles':len(manifest['files']),'sourceShaModeBeforeAfterMatched':True,'boundary':'macOS arm64 local preview; noinstaller/distribution/notarization/x64/publish','status':'official-build-failed' if code else 'official-build-passed'}
if code==0:
 app=Path('/private/tmp/willyou-m12-s2-package-023/mac-arm64/WillYou.app');resources=app/'Contents/Resources';r['actualApp']=str(app);r['pins']={name:hashlib.sha256((resources/name).read_bytes()).hexdigest() for name in ['app.asar','agent-browser/arm64/agent-browser','agent-browser/SOURCE.json','native/willyou-app','native/willyou-process-identity']};r['executableSha256']=hashlib.sha256((app/'Contents/MacOS/WillYou').read_bytes()).hexdigest();r['frameworkSha256']=hashlib.sha256((app/'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework').read_bytes()).hexdigest();lines=(root/'stdout.log').read_text().splitlines();smokes=[]
 for line in lines:
  if line.strip().startswith('{'):
   try:
    v=json.loads(line)
    if isinstance(v,dict) and 'sqlite' in v and 'pty' in v:smokes.append(v)
   except json.JSONDecodeError:pass
 assert len(smokes)==1,smokes;r['nativeSmoke']=smokes[0]
 assert all(r['nativeSmoke'].get(k)=='passed' for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher']),r['nativeSmoke']
(root/'RESULT.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True);sys.exit(code)
