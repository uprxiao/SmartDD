from binding_guard import assert_bound
assert_bound()
from pathlib import Path
import os,json,hashlib,subprocess,shutil,datetime,sys
ROOT=Path('/private/tmp/willyou-m12-app027-installer-001');SHARED=Path('/private/tmp/willyou-m12-s2-package-027/mac-arm64/WillYou.app');PRIVATE=ROOT/'installer-input/WillYou.app';OLD=Path('/private/tmp/willyou-m12-p125-app023-installer-001')
assert sys.argv[1:]==['--execute'] and os.environ.get('WILLYOU_M12_NATIVE_LEASE_CONFIRMED')=='1'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
prepared=ROOT/'prepared-inputs.json';assert sha(prepared)==os.environ['WILLYOU_P111_PREPARED_SHA']
for f in json.loads(prepared.read_text())['inputs']:assert sha(Path(f['path']))==f['sha256'],f['path']
assert not PRIVATE.exists()
start={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':os.getpid(),'stage':'private-prepackaged-copy','codeRebuild':False,'published':False}
fd=os.open(ROOT/'evidence/preparation-started.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as s:json.dump(start,s);s.write('\n')
logical=sum((Path(d)/n).stat().st_size for d,ds,fs in os.walk(SHARED,followlinks=False) for n in fs if not (Path(d)/n).is_symlink());free=shutil.disk_usage(ROOT).free
assert free>logical*3+2_000_000_000,'Insufficient private build scratch; do not delete unrelated artifacts'
commands=[]
def run(argv):
 p=subprocess.run(argv,capture_output=True,text=True);commands.append({'argv':argv,'exitCode':p.returncode,'stderr':p.stderr});assert p.returncode==0,commands[-1]
run(['/bin/cp','-Rp',str(SHARED),str(PRIVATE)])
plan=json.loads((ROOT/'plan.json').read_text());base=OLD/'baseline-download/stored-auth-attempt-002'/plan['baselineAsset'];assert sha(base)==plan['baselineDmgSha256'];target=ROOT/'baseline-download/stored-auth-attempt-002'/plan['baselineAsset'];assert not target.exists();run(['/bin/cp','-p',str(base),str(target)]);assert sha(target)==plan['baselineDmgSha256'] and base.stat().st_ino!=target.stat().st_ino
cache=OLD/'cache/electron-builder';new=ROOT/'cache/electron-builder'
if cache.is_dir():
 assert not new.exists();run(['/bin/cp','-Rp',str(cache),str(new)])
pins=json.loads((ROOT/'evidence/prepackaged-input-pins.json').read_text())['files'];checks=[]
for f in pins:
 a=SHARED/f['path'];b=PRIVATE/f['path'];assert sha(a)==f['sha256'] and sha(b)==f['sha256'];assert a.stat().st_ino!=b.stat().st_ino and (a.stat().st_mode&511)==(b.stat().st_mode&511);checks.append({'path':f['path'],'sha256':f['sha256'],'distinctPrivateInode':True})
for name in ['node','npm','tmp']:(ROOT/'cache'/name).mkdir(mode=0o700,exist_ok=True)
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'private-copy-and-baseline-pins-ready-for-official-builder','pid':os.getpid(),'commands':commands,'logicalAppBytes':logical,'freeBytesBefore':free,'copiedPins':checks,'baselineCachedTrustedSHA256':plan['baselineDmgSha256'],'noCredentialsOrModel':True,'codeRebuild':False,'published':False}
(ROOT/'evidence/private-copy-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'logicalAppBytes':logical,'pins':len(checks),'baselineTrusted':True}))
