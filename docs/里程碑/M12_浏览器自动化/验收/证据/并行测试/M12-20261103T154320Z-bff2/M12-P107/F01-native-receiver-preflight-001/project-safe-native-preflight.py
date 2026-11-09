#!/usr/bin/python3
"""Pure-file projection of the terminal F01 fixture capability batch; no subprocesses."""
from pathlib import Path
import datetime,hashlib,json,plistlib,re,shutil,stat
ROOT=Path('/private/tmp/willyou-m12-F01-appkit-opener-v2-001')
RT=ROOT/'runtime-001'
OUT=Path('/private/tmp/willyou-m12-F01-native-preflight-safe-001')
def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as stream:
  for part in iter(lambda:stream.read(1048576),b''):h.update(part)
 return h.hexdigest()
def load(p):return json.loads(Path(p).read_text())
references={};provenance=[];omitted=[]
def ref(p,boundary='Whole original file SHA; original private bytes unchanged'):
 p=Path(p);key=str(p)
 if key not in references:references[key]=dict(path=key,sha256=sha(p),bytes=p.stat().st_size,mode=stat.S_IMODE(p.stat().st_mode),boundary=boundary)
 return references[key]
def save(name,value):
 p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def clean_json(value,path=''):
 if isinstance(value,list):return [clean_json(x,path+'[]') for x in value]
 if isinstance(value,dict):
  result={}
  for key,v in value.items():
   if key.lower() in {'env','environment','processenv','userenvironment','fullenvironment','allapplications','allappregistry','registrydump'}:
    omitted.append(dict(field=path+'.'+key,reason='No full environment/all-app registry in safe archive'));continue
   result[key]=clean_json(v,path+'.'+key)
  return result
 return value
def original(p,name):
 p=Path(p);assert p.is_file() and not p.is_symlink();data=p.read_bytes()
 if p.suffix=='.json':
  parsed=json.loads(data);safe=clean_json(parsed,name)
  if safe!=parsed:
   save(name,safe);provenance.append(dict(member=name,transformation='Scoped JSON projection; omitted environment/registry fields',source=ref(p)));return
 if p.suffix=='.log':
  text=data.decode('utf-8')
  assert not re.search(r'(?im)^\s*(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|Authorization:)\s*[=:]',text),'Unexpected auth-like log'
  try:parsed=json.loads(text)
  except (json.JSONDecodeError,ValueError):parsed=None
  if isinstance(parsed,dict):
   safe=clean_json(parsed,name)
   if safe!=parsed:
    save(name+'.safe.json',safe);provenance.append(dict(member=name+'.safe.json',transformation='Scoped JSON log projection',source=ref(p)));return
 dest=OUT/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest);assert sha(dest)==sha(p)
 provenance.append(dict(member=name,transformation='Original whole bytes',source=ref(p)))
close=load(RT/'closeout-001/result.json')
assert close['allRecordedPidsAbsent'] and len(close['recordedPids'])==100
assert all(close[k] is True for k in ['ownRunningEmpty','ownBundleLookupEmpty','fourDefaultsUnchanged','ownCandidatesEmpty','publicCodeCopy014Removed'])
assert close['actualDocumentEventsSent']==0 and close['receiptCount']==0
assert not OUT.exists(),'Never overwrite a safe delivery'
OUT.mkdir(mode=0o700)
for name in ['receiver.mm','Info.plist.in','bind-inputs.py','check-defaults.py','binding.example.json','preparation.json','COMMANDS.md','README.md','manifest.json']:
 original(ROOT/name,'prepared-v2/'+name)
original(Path(__file__),'project-safe-native-preflight.py')
for name in ['binding.json','binding.actual.stdout.log','binding.actual.stderr.log']:
 original(RT/name,'synthetic-binding/'+name)
for name in ['compile-started.json','compile-result.json','compile.stdout.log','compile.stderr.log']:
 original(RT/name,'attempt-001/'+name)
for directory in sorted(RT.glob('attempt-*')):
 assert directory.is_dir() and not directory.is_symlink()
 for p in sorted(directory.iterdir()):
  if not p.is_file() or p.is_symlink():continue
  relative=directory.name+'/'+p.name
  if p.suffix in {'.m','.mm','.py','.plist','.swift'} or (p.suffix=='.json' and p.name not in {'live.json','root-lease.json'}):
   original(p,relative)
  elif p.suffix=='.log' and not p.name.startswith('controller.'):
   original(p,relative)
  else:ref(p,'Uncopied original duplicate controller/live/lease or compiled helper; whole-file hash only')
for p in sorted((RT/'closeout-001').iterdir()):
 if p.is_file() and p.suffix in {'.json','.plist','.log'}:original(p,'closeout-001/'+p.name)
for key,item in close['appPinsBeforeRemoval'].items():
 p=RT/'test-opener.app'/key
 assert sha(p)==item['sha256'] and p.stat().st_size==item['bytes']
 ref(p,'Own compiled App binary/metadata hash only; compiled App not copied, mutated or removed by projection')
# Preserve the two small synthetic texts; the exact fixed PDF is referenced, not copied as a new binary artifact.
for name in ['route.md','route.html']:original(RT/'fixtures'/name,'synthetic-fixtures/'+name)
ref(RT/'fixtures/route.pdf','Existing original synthetic56519B PDF; exact source retained privately and prior F29 accepted artifact. No binary archived here')
first=load(RT/'compile-result.json');a3=load(RT/'attempt-003/result.json');a9=load(RT/'attempt-009/result.json');a10=load(RT/'attempt-010/result.json');a11=load(RT/'attempt-011/result.json');a14=load(RT/'attempt-014/result.json')
boot=load(RT/'attempt-011/running-01.stdout.log')['ownRunningApplications']
assert len(boot)==1 and boot[0]['pid']==10810 and boot[0]['active'] is False and boot[0]['activationPolicy']==2 and boot[0]['launchTime']>0
assert a11['receiverNumericExitObserved'] is False and a11['receiptFiles']==[]
assert a9['publicRegistration']['registerStatus']==0 and a9['publicRegistration']['isApplication'] is True
assert a10['registered']['ownBundleQueryURLs']==[]
assert all(row['exitCode']==0 for row in a3['steps'])
start=datetime.datetime.fromisoformat(first['startedAt']);end=datetime.datetime.fromisoformat(close['at'])
efficiency=dict(actualStart=first['startedAt'],actualCloseout=close['at'],elapsedSeconds=(end-start).total_seconds(),formalNewCases=0,productABusinessCases=0,productionBuilds=0,actualDocumentEventsSent=0,receipts=0,noDocumentReceiverBootsObserved=1,recordedProcessPIDs=100,PIDCountBoundary='100 unique recorded metadata/compiler/controller/observer/etc PIDs, NOT100Apps. Snapshot utility executions are not document-receiving App business cases.')
attempts=[
 dict(id='001',status='actual-compiler-red',reason='decimal identifier conflicts with SDK typedef; compile1, no receiver binary'),
 dict(id='002',status='actual-compiler-red',reason='Objective-C++ class .new property syntax rejected; compile1'),
 dict(id='003',status='fixture-compile-sign-baseline-green',reason='Minimal syntax fixes compile0/sign0/verify0/readonly four-default snapshot0; no registration/document dispatch'),
 dict(id='004',status='pre-registration-Python-helper-error',reason='os.listxattr unavailable; Root-reported actual tool a7b60f;0LS/0fileevents; no fabricated disk stderr'),
 dict(id='005',status='registration-readiness-failed',reason='lsregister0 but receiver candidates absent; checker1; own unregister/default protection actual'),
 dict(id='006',status='registration-readiness-failed',reason='Agent classification does not establish receiver discovery; original failed result retained'),
 dict(id='007',status='registration-readiness-failed',reason='Bounded delayed readiness polling never established own candidate'),
 dict(id='008',status='independent-observer-registration-readiness-failed',reason='Unbundled readonly NSWorkspace observer and snapshots remain candidate-empty'),
 dict(id='009',status='public-registration-return0-not-discovery',reason='Real public LSRegisterURL0/isApplicationtrue; independent lookup remains0'),
 dict(id='010',status='alias-query-no-own-URLs',reason='Actual explicit alias query ownBundleQueryURLs=[]; no registration readiness'),
 dict(id='011',status='positive-docless-background-boot-only',reason='Exact10810 observed activefalse/policy2/validlaunchTime; no fileevent,12s no-event timeout; receiver numericexit unobserved, open-w launcher0 is not receiverexit'),
 dict(id='012',status='unexecuted-superseded',reason='Recorded NativeExecutedfalse/documentEventSentfalse; not a red runtime or pass'),
 dict(id='013',status='regular-classification-readiness-failed',reason='Same guarded metadata protocol with regular classification did not establish discovery'),
 dict(id='014',status='0755-code-copy-readiness-failed-copy-removed',reason='Identical signed code in self-owned0755copy; discovery still0; copy removed; defaults/source protected')]
refs=[dict(url='https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/LaunchServicesKeys.html',source='attempt-006/classification-only-review.json'),dict(url='https://developer.apple.com/documentation/appkit/nsworkspace/urlsforapplications(toopen:)-ualk',source='attempt-008/observer-boundary.json')]
save('result.safe.json',dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),group='M12-F01-native-fixture-preflight-v2',status='terminal-registration-readiness-unresolved-productA-unexecuted',attempts=attempts,efficiency=efficiency,positiveNoDocumentBoot=boot[0],windowCountObserved=False,windowCount='NOT MEASURED; source has no window construction but this is not runtime proof',receiverNumericExitObserved=False,actualDocumentEventsSent=0,receiptCount=0,productF01Passed=False,formalIncrement=0,productionBuilds=0,cleanup=dict(all100RecordedPidsAbsent=True,ownNSRunningEmpty=True,ownBundleLookupEmpty=True,ownCandidatesEmpty=True,fourDefaultsUnchanged=True,original3SyntheticFilesAndDirectoryFullStatAndSHAUnchanged=close['originalSourcesFullStatAndSHAUnchanged'],copy014Removed=True),AppleReferences=dict(items=refs,boundary='Original review hypotheses only, no official cause proof and no new browsing during projection'),boundaries=['No swizzle or fabricated document receipt; no actual product-menu F01A run','A source-inferred no-window guarantee is not an observed windowcount','No full user environment/auth/DB/daily data/all-app registry/SDKcache/home/tmp or executable bytes archived','Self-generated synthetic BIDnonce/config are not real authentication secrets','Private compiled App untouched until Root reviews safe; removal is Root separate action'],resourcesHeld=[],publicLedgerModified=False))
save('binary-and-omitted-private-references.json',dict(references=list(references.values()),wholeFilesHashed=True,notArchived=['compiled App/helper binaries','SDK/compiler caches','home/tmp','full user env/auth/DB','all-application registry','duplicate controllers/live/leases'],noPrivateAppMutation=True))
save('member-provenance.json',dict(members=provenance,sourceOriginalsUnmodified=True,omittedFields=omitted))
(OUT/'README.md').write_text('F01真实AppKit夹具技术预检安全交付，非产品A。原001/002编译红、003编译签名/默认快照绿、004观察器错误、005–010/013/014注册发现失败、011唯一无文档后台启动与012未执行均保留。0documentevents/0receipts/0新用例/0productionbuild；100是已记录技术PID数量，不能当App数。011 actual10810 inactive/policy2/launchTime有效；窗口数未采、receiver数值exit未观察。Root closeout原100PID清场、ownrunning/BIDlookup空、四默认/三个合成文件及目录fullstat/SHA不变。两Apple链接仅原假设，不是原因证明。私有App未动，Root复核后另清。\n')
for p in OUT.rglob('*'):
 if not p.is_file():continue
 assert not p.is_symlink() and p.suffix not in {'.dmg','.asar','.db','.sqlite','.node','.dylib'}
 data=p.read_bytes();assert data[:4] not in [b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe',b'\x7fELF']
files=[dict(path=str(p.relative_to(OUT)),sha256=sha(p),bytes=p.stat().st_size,mode=stat.S_IMODE(p.stat().st_mode)) for p in sorted(OUT.rglob('*')) if p.is_file()]
save('manifest.json',dict(schema='M12-safe-delivery-v1',at=datetime.datetime.now(datetime.timezone.utc).isoformat(),group='M12-F01-native-fixture-preflight-v2',files=files,formalIncrement=0,productAExecuted=False,actualDocumentEventsSent=0,receiptCount=0,resourcesHeld=[],originalPrivateAppUntouched=True))
print(json.dumps(dict(safeRoot=str(OUT),manifestSHA256=sha(OUT/'manifest.json'),members=len(files),provenanceSHA256=sha(OUT/'member-provenance.json'),efficiency=efficiency),ensure_ascii=False))
