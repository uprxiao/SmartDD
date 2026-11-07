# Future file-only setup, not executed during preparation. No compile/register/launch.
from pathlib import Path
import hashlib,json,os,plistlib,stat,uuid
ROOT=Path('/private/tmp/willyou-m12-F01-appkit-opener-v2-001')
assert ROOT.resolve(strict=True)==ROOT
assert stat.S_IMODE(ROOT.stat().st_mode)==0o700
runtime=ROOT/'runtime-001';fixture=runtime/'fixtures';app=runtime/'test-opener.app';receipts=runtime/'receipts'
for p in [runtime,fixture]:
 s=p.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o700 and p.resolve(strict=True)==p
assert not app.exists() and not receipts.exists() and not (runtime/'binding.json').exists()
def fp(p):
 s=p.lstat();assert s.st_uid==os.getuid()
 return dict(device=str(s.st_dev),inode=str(s.st_ino),size=str(s.st_size),mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,mtimeSec=str(s.st_mtime_ns//10**9),mtimeNs=s.st_mtime_ns%10**9,ctimeSec=str(s.st_ctime_ns//10**9),ctimeNs=s.st_ctime_ns%10**9)
items={}
for key,name in [('md','route.md'),('html','route.html'),('pdf','route.pdf')]:
 p=fixture/name;s=p.lstat();assert stat.S_ISREG(s.st_mode) and 0<s.st_size<=8*1024*1024 and p.resolve(strict=True)==p
 before=fp(p);h=hashlib.sha256(p.read_bytes()).hexdigest();assert fp(p)==before
 items[key]=dict(path=str(p),fingerprint=before,sha256=h)
items['directory']=dict(path=str(fixture),fingerprint=fp(fixture))
nonce=uuid.uuid4().hex;bundle_id='com.willyou.m12.f01receiver.v2.'+nonce
contents=app/'Contents';(contents/'MacOS').mkdir(parents=True,mode=0o700);receipts.mkdir(mode=0o700)
plist=plistlib.loads((ROOT/'Info.plist.in').read_bytes());assert plist['LSBackgroundOnly'] is True
assert len(plist['CFBundleDocumentTypes'])==4 and all(x['LSHandlerRank']=='Alternate' and x['CFBundleTypeRole']=='Viewer' for x in plist['CFBundleDocumentTypes'])
plist['CFBundleIdentifier']=bundle_id;plist['CFBundleName']=plist['CFBundleDisplayName']='WillYou F01 v2 '+nonce[:8];(contents/'Info.plist').write_bytes(plistlib.dumps(plist,sort_keys=False))
binding=dict(schema='M12-F01-AppKit-opener-v2',controlRoot=str(ROOT),nonce=nonce,bundleId=bundle_id,fixtureRoot=str(fixture),receiptDirectory=str(receipts),appPath=str(app),items=items)
path=runtime/'binding.json';fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w') as stream:json.dump(binding,stream,ensure_ascii=False,indent=2);stream.write('\n')
print(json.dumps(dict(status='bound-file-inputs-only',root=str(ROOT),items=4,AppCompiled=False,LSRegistered=False)))
