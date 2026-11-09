from pathlib import Path
import json,os,subprocess,datetime,hashlib,time,sys
ROOT=Path('/private/tmp/willyou-m12-F01-appkit-opener-v2-001');R=ROOT/'runtime-001';OUT=R/'attempt-005';APP=R/'test-opener.app';EXE=APP/'Contents/MacOS/F01ReceiverV2';LS='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';B=json.loads((R/'binding.json').read_text());BEFORE=R/'attempt-003/defaults-before.stdout.log';env=dict(os.environ,PYTHONPYCACHEPREFIX=str(R/'cache/python'));result={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'driverPid':os.getpid(),'steps':[],'formalIncrement':0,'scope':'Synthetic receiver OS capability preflight only. open-g-a is NOT product UI F01 A. No default setter or real data.'};attempted=False
save=lambda: (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
def run(name,args,timeout=15):
 row={'name':name,'command':args,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};result['steps'].append(row);save();t=time.monotonic();p=subprocess.Popen(args,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE);row['pid']=p.pid;save();print(json.dumps({'phase':name,'pid':p.pid}),flush=True);stdout,stderr=p.communicate(timeout=timeout);(OUT/(name+'.stdout.log')).write_bytes(stdout);(OUT/(name+'.stderr.log')).write_bytes(stderr);row.update(exitCode=p.returncode,seconds=time.monotonic()-t);save();return p.returncode,stdout,stderr

def xattrs(p):
 q=subprocess.run(['/usr/bin/xattr','-l','-x',str(p)],env=env,capture_output=True,text=True);assert q.returncode==0,(p,q.stderr);return q.stdout

def sources():
 rows={}
 for key,item in B['items'].items():
  p=Path(item['path']);s=p.stat();rows[key]={'device':str(s.st_dev),'inode':str(s.st_ino),'size':str(s.st_size),'mode':s.st_mode&4095,'mtimeNs':str(s.st_mtime_ns),'ctimeNs':str(s.st_ctime_ns),'xattrs':xattrs(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest() if key!='directory' else None}
 return rows
assert not (OUT/'result.json').exists();lease=json.loads((OUT/'root-lease.json').read_text());assert lease['status']=='granted' and lease['coordinator']=='root';assert hashlib.sha256(EXE.read_bytes()).hexdigest()==lease['receiverExecutableSHA256'];assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(lease['expiresAt']);assert not list((R/'receipts').iterdir());result['sourceBefore']=sources();save()
try:
 attempted=True
 code,_,_=run('register-own-alternate',[LS,'-f',str(APP)]);assert code==0
 code,_,_=run('defaults-registered',[str(EXE),'--snapshot']);assert code==0
 code,_,_=run('check-defaults-registered',['/usr/bin/python3',str(ROOT/'check-defaults.py'),str(BEFORE),str(OUT/'defaults-registered.stdout.log'),'registered']);assert code==0
 result['registrationDefaultsVerified']=True;save()
 code,_,_=run('background-md-file-event',['/usr/bin/open','-g','-W','-a',str(APP),'--stdout',str(OUT/'receiver.stdout.log'),'--stderr',str(OUT/'receiver.stderr.log'),B['items']['md']['path']],timeout=22);result['openWaitExitCode']=code;assert code==0
 result['sourceAfterEvent']=sources();files=list((R/'receipts').glob('receipt-*.json'));result['receiptCount']=len(files)
 if len(files)==1:
  receipt=json.loads(files[0].read_text());result['receipt']=receipt;assert receipt['nonce']==B['nonce'] and receipt['bundleId']==B['bundleId'] and receipt['item']['key']=='md' and receipt['item']['path']==B['items']['md']['path'];assert receipt['item']['sha256']==B['items']['md']['sha256'] and receipt['sourceUnchanged'];assert receipt['activationPolicy']==2 and receipt['active'] is False and receipt['windowCount']==0;result['receiverPid']=receipt['pid'];q=subprocess.run(['/bin/ps','-p',str(receipt['pid']),'-o','pid=,comm='],capture_output=True,text=True);result['receiverAbsentAfterOpenWait']=q.returncode==1 and not q.stdout.strip();assert result['receiverAbsentAfterOpenWait'];result['eventReceiptVerified']=True
 else:result['eventReceiptVerified']=False
 code,_,_=run('defaults-after-event',[str(EXE),'--snapshot']);assert code==0
 code,_,_=run('check-defaults-after-event',['/usr/bin/python3',str(ROOT/'check-defaults.py'),str(BEFORE),str(OUT/'defaults-after-event.stdout.log'),'registered']);assert code==0
except Exception as error:
 result['error']={'class':type(error).__name__,'message':str(error)}
finally:
 if attempted:
  try:
   code,_,_=run('unregister-exact-own-bundle',[LS,'-u',str(APP)]);assert code==0
   code,_,_=run('defaults-after-unregister',[str(EXE),'--snapshot']);assert code==0
   code,_,_=run('check-defaults-after-unregister',['/usr/bin/python3',str(ROOT/'check-defaults.py'),str(BEFORE),str(OUT/'defaults-after-unregister.stdout.log'),'unregistered']);assert code==0;result['exactUnregisterAndDefaultsVerified']=True
  except Exception as error:result['cleanupError']={'class':type(error).__name__,'message':str(error)}
 result['sourceFinal']=sources();result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['exitCode']=0 if result.get('eventReceiptVerified') and result.get('exactUnregisterAndDefaultsVerified') and not result.get('error') else 1;result['receiverNumericExitObserved']=False;save();print(json.dumps({'exitCode':result['exitCode'],'receiptCount':result.get('receiptCount'),'eventVerified':result.get('eventReceiptVerified'),'exactUnregistered':result.get('exactUnregisterAndDefaultsVerified'),'error':result.get('error'),'cleanupError':result.get('cleanupError')}),flush=True)
sys.exit(result['exitCode'])
