from pathlib import Path
import json,os,subprocess,datetime,hashlib,time,sys,shutil,stat
ROOT=Path('/private/tmp/willyou-m12-F01-appkit-opener-v2-001');R=ROOT/'runtime-001';OUT=R/'attempt-015';APP=R/'test-opener.app';EXE=APP/'Contents/MacOS/F01ReceiverV2'
LS='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
load=lambda p:json.loads(Path(p).read_text())
PLAN=load(OUT/'plan.json');B=load(R/'binding.json');BEFORE=OUT/'defaults-before.stdout.log'
env=dict(os.environ,PYTHONPYCACHEPREFIX=str(R/'cache/python'))
result={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'driverPid':os.getpid(),'steps':[],'formalIncrement':0,'scope':'Single escalated-context qualification;0documents/0Appboot/0productA; fixed original003source/finalInfo/binding/observer008'}
def save(): (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
def run(name,args,timeout=15):
 row={'name':name,'command':args,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};result['steps'].append(row);save();start=time.monotonic()
 p=subprocess.Popen(args,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE);row['pid']=p.pid;save();print(json.dumps({'phase':name,'pid':p.pid}),flush=True)
 try:stdout,stderr=p.communicate(timeout=timeout)
 except subprocess.TimeoutExpired:
  row['timedOut']=True;p.terminate();row['cleanupSignals']=['SIGTERM']
  try:stdout,stderr=p.communicate(timeout=2)
  except subprocess.TimeoutExpired:p.kill();row['cleanupSignals'].append('SIGKILL');stdout,stderr=p.communicate(timeout=2)
  (OUT/(name+'.stdout.log')).write_bytes(stdout);(OUT/(name+'.stderr.log')).write_bytes(stderr);row.update(exitCode=p.returncode,seconds=time.monotonic()-start);save();raise
 (OUT/(name+'.stdout.log')).write_bytes(stdout);(OUT/(name+'.stderr.log')).write_bytes(stderr);row.update(exitCode=p.returncode,seconds=time.monotonic()-start);save();return p.returncode,stdout,stderr

def sources():
 rows={}
 for key,item in B['items'].items():
  p=Path(item['path']);s=p.stat();x=subprocess.run(['/usr/bin/xattr','-l','-x',str(p)],env=env,capture_output=True,text=True,timeout=5);assert x.returncode==0
  rows[key]={'device':str(s.st_dev),'inode':str(s.st_ino),'size':str(s.st_size),'mode':stat.S_IMODE(s.st_mode),'mtimeNs':str(s.st_mtime_ns),'ctimeNs':str(s.st_ctime_ns),'xattrs':x.stdout,'sha256':sha(p) if key!='directory' else None}
 return rows

assert sys.argv[1:]==['--execute'] and not (OUT/'result.json').exists()
assert ROOT.resolve()==ROOT and OUT.resolve()==OUT and not APP.exists() and not APP.is_symlink()
assert PLAN['appPath']==str(APP) and PLAN['source']==str(R/'attempt-003/receiver.mm') and PLAN['info']==str(R/'closeout-001/Info.final.plist') and PLAN['observer']==str(R/'attempt-008/default-observer')
assert PLAN['compileCommand']==next(x['command'] for x in load(R/'attempt-003/result.json')['steps'] if x['name']=='compile')
for row in load(OUT/'input-manifest.json')['files']:
 p=Path(row['path']);assert p.is_file() and sha(p)==row['sha256'] and stat.S_IMODE(p.stat().st_mode)==row['mode'],row['path']
lease=load(OUT/'root-lease.json');assert lease['status']=='granted' and lease['coordinator']=='root' and lease['scope']=='M12-F01-attempt015-qualification-only'
assert lease['inputManifestSHA256']==sha(OUT/'input-manifest.json') and lease['controllerSHA256']==sha(Path(__file__))
assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(lease['expiresAt'])
assert not list((R/'receipts').iterdir())
for key,item in B['items'].items():
 p=Path(item['path']);s=p.stat();f=item['fingerprint'];assert str(s.st_dev)==f['device'] and str(s.st_ino)==f['inode'] and str(s.st_size)==f['size'] and stat.S_IMODE(s.st_mode)==f['mode']
 assert str(s.st_mtime_ns//10**9)==f['mtimeSec'] and s.st_mtime_ns%10**9==f['mtimeNs'] and str(s.st_ctime_ns//10**9)==f['ctimeSec'] and s.st_ctime_ns%10**9==f['ctimeNs']
 if key!='directory':assert sha(p)==item['sha256']
result.update(sourceBefore=sources(),AppLaunchExecuted=False,documentEventsSent=0,receiptCountBefore=0);save()
try:
 (APP/'Contents/MacOS').mkdir(parents=True,mode=0o700);shutil.copyfile(PLAN['info'],APP/'Contents/Info.plist');assert sha(APP/'Contents/Info.plist')==PLAN['infoSHA256']
 code,_,_=run('compile',PLAN['compileCommand'],120);assert code==0
 code,_,_=run('adhoc-sign',['/usr/bin/codesign','--force','--sign','-','--timestamp=none',str(APP)]);assert code==0
 code,_,_=run('verify-signature',['/usr/bin/codesign','--verify','--deep','--strict','--verbose=2',str(APP)]);assert code==0
 assert sha(APP/'Contents/Info.plist')==PLAN['infoSHA256'];result['compiledExecutableSHA256']=sha(EXE);result['restoredInfoSHA256']=sha(APP/'Contents/Info.plist');save()
 code,data,_=run('defaults-before',[PLAN['observer']]);assert code==0;before=json.loads(data);assert len(before['rows'])==4 and {x['key'] for x in before['rows']}=={'md','html','pdf','directory'}
 assert all(x['defaultPath'] and x['defaultBundleId'] and not x['ownCandidates'] and x['defaultBundleId']!=B['bundleId'] for x in before['rows'])
 baseline={x['key']:(x['defaultPath'],x['defaultBundleId']) for x in before['rows']}
 code,_,_=run('register-own-alternate',[LS,'-v','-f',str(APP)]);assert code==0
 deadline=time.monotonic()+3;polls=[]
 while not polls or time.monotonic()<deadline:
  code,data,_=run('defaults-registered-poll-%03d'%(len(polls)+1),[PLAN['observer']],max(0.05,deadline-time.monotonic()));assert code==0;current=json.loads(data)
  assert len(current['rows'])==4 and {x['key']:(x['defaultPath'],x['defaultBundleId']) for x in current['rows']}==baseline,'Default changed'
  counts={x['key']:len(x['ownCandidates']) for x in current['rows']};polls.append({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'counts':counts});result['candidateReadinessPolls']=polls;save();(OUT/'defaults-registered.stdout.log').write_bytes(data)
  if all(n==1 for n in counts.values()) or time.monotonic()>=deadline:break
  time.sleep(min(0.2,max(0,deadline-time.monotonic())))
 code,_,_=run('check-defaults-registered',['/usr/bin/python3',str(ROOT/'check-defaults.py'),str(BEFORE),str(OUT/'defaults-registered.stdout.log'),'registered']);assert code==0
 result['registrationDefaultsVerified']=True;result['qualificationOnly']=True;save()
except Exception as error:result['error']={'class':type(error).__name__,'message':str(error)}
finally:
 if APP.exists():
  try:
   code,_,_=run('unregister-exact-own-bundle',[LS,'-u',str(APP)]);assert code==0
   code,_,_=run('defaults-after-unregister',[PLAN['observer']]);assert code==0
   code,_,_=run('check-defaults-after-unregister',['/usr/bin/python3',str(ROOT/'check-defaults.py'),str(BEFORE),str(OUT/'defaults-after-unregister.stdout.log'),'unregistered']);assert code==0;result['exactUnregisterAndDefaultsVerified']=True
  except Exception as error:result['cleanupError']={'class':type(error).__name__,'message':str(error)}
 result['sourceFinal']=sources();result['sourcesExactlyPreserved']=result['sourceFinal']==result['sourceBefore'];result['receiptCountAfter']=len(list((R/'receipts').glob('receipt-*.json')));result['receiverNumericExitObserved']=False;result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 result['exitCode']=0 if result.get('registrationDefaultsVerified') and result.get('exactUnregisterAndDefaultsVerified') and result['sourcesExactlyPreserved'] and result['receiptCountAfter']==0 and not result.get('error') and not result.get('cleanupError') else 1;save();print(json.dumps({'exitCode':result['exitCode'],'qualificationOnly':True,'AppLaunchExecuted':False,'receiptCount':result['receiptCountAfter'],'error':result.get('error'),'cleanupError':result.get('cleanupError')}),flush=True)
sys.exit(result['exitCode'])
