from pathlib import Path
import datetime,hashlib,json,shutil,stat
ROOT=Path('/private/tmp/willyou-m12-F01-appkit-opener-v2-001');R=ROOT/'runtime-001';SOURCE=R/'attempt-015';OUT=Path('/private/tmp/willyou-m12-F01-attempt015-safe-001')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
load=lambda p:json.loads(Path(p).read_text())
refs={};provenance=[]
def ref(p,boundary='Whole original file SHA only'):
 p=Path(p);row=dict(path=str(p),sha256=sha(p),bytes=p.stat().st_size,mode=stat.S_IMODE(p.stat().st_mode),boundary=boundary);refs[str(p)]=row;return row
def save(n,v):
 p=OUT/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def original(p,n):
 p=Path(p);assert p.is_file() and not p.is_symlink();q=OUT/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);assert sha(q)==sha(p);provenance.append(dict(member=n,source=ref(p),transformation='Original whole bytes'))
actual=load(SOURCE/'result.json');review=load(SOURCE/'root-review.json');inputs=load(SOURCE/'input-manifest.json')
assert actual['exitCode']==1 and actual['sourcesExactlyPreserved'] and actual['exactUnregisterAndDefaultsVerified']
assert actual['AppLaunchExecuted'] is False and actual['documentEventsSent']==0 and actual['receiptCountAfter']==0
assert len(actual['candidateReadinessPolls'])==13 and all(set(p['counts'])=={'md','html','pdf','directory'} and all(v==0 for v in p['counts'].values()) for p in actual['candidateReadinessPolls'])
assert review['currentOSContextDidNotResolveDiscovery'] is True
assert all(s['exitCode']==0 for s in actual['steps'] if s['name'] in ['compile','adhoc-sign','verify-signature','unregister-exact-own-bundle','defaults-after-unregister','check-defaults-after-unregister'])
assert not OUT.exists();OUT.mkdir(mode=0o700)
for p in sorted(SOURCE.iterdir()):
 if p.is_file() and p.suffix in {'.py','.json','.md','.log'}:original(p,'attempt-015/'+p.name)
for p,n in [(R/'attempt-003/receiver.mm','frozen-inputs/receiver.003.mm'),(R/'closeout-001/Info.final.plist','frozen-inputs/Info.final.plist'),(R/'binding.json','frozen-inputs/binding.synthetic.json'),(ROOT/'check-defaults.py','frozen-inputs/check-defaults.py')]:original(p,n)
for row in inputs['files']:
 p=Path(row['path']);assert sha(p)==row['sha256'] and stat.S_IMODE(p.stat().st_mode)==row['mode'];ref(p,'Exact actual input hash; binaries and historical whole files not recopied')
for relative,pin in review['compiledPrivateAppPins'].items():
 p=R/'test-opener.app'/relative;assert sha(p)==pin['sha256'] and p.stat().st_size==pin['bytes'];ref(p,'Private compiled App hash only; not copied/modified/removed')
prior=Path('/private/tmp/willyou-m12-F01-native-preflight-safe-001/manifest.json');ref(prior,'Prior001-014 separate immutable safe delivery; qualification15 does not overwrite its failures')
start=datetime.datetime.fromisoformat(actual['startedAt']);finish=datetime.datetime.fromisoformat(actual['finishedAt'])
save('result.safe.json',dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),group='M12-F01-attempt015-qualification',status='qualification-failed-no-further-variants',actual=review['actual'],exitCode=actual['exitCode'],startedAt=actual['startedAt'],finishedAt=actual['finishedAt'],elapsedSeconds=(finish-start).total_seconds(),compileSignVerify=[dict(name=s['name'],exitCode=s['exitCode']) for s in actual['steps'] if s['name'] in ['compile','adhoc-sign','verify-signature']],observations=dict(boundSeconds=3,polls=13,allFourOwnCandidatesZero=True),registeredCheckerExitCode=next(s['exitCode'] for s in actual['steps'] if s['name']=='check-defaults-registered'),cleanup=dict(exactUnregisterAndDefaultsVerified=True,sourcesExactlyPreserved=True,recordedPidsAbsent=review['rootRecordedPidsAbsent']),sourceBefore=actual['sourceBefore'],sourceFinal=actual['sourceFinal'],documentEvents=0,receipts=0,AppBoots=0,receiverNumericExitObserved=False,productionAExecuted=False,formalIncrement=0,causalBoundary='Explicit escalated OS context alone did not establish discovery. JXA differential is not proof that sandbox caused prior LS failures; no further source/classification/flags variants are scheduled.',privateCompiledAppUntouched=True,resourcesHeld=[]))
save('input-and-private-references.json',dict(references=list(refs.values()),source003SHA256=sha(R/'attempt-003/receiver.mm'),observer008SHA256=sha(R/'attempt-008/default-observer'),InfoFinalSHA256=sha(R/'closeout-001/Info.final.plist'),notArchived=['App/executable/helper binaries','home/auth/DB','SDK/compiler cache','runtime environment/transport endpoints'],syntheticBindingBoundary='Only own synthetic nonce/BID/path/fingerprints; not real auth.'))
save('member-provenance.json',dict(members=provenance,originalsUnmodified=True))
files=[dict(path=str(p.relative_to(OUT)),sha256=sha(p),bytes=p.stat().st_size,mode=stat.S_IMODE(p.stat().st_mode)) for p in sorted(OUT.rglob('*')) if p.is_file()]
for row in files:
 p=OUT/row['path'];assert p.suffix not in {'.db','.sqlite','.dmg','.asar','.node','.dylib'} and p.read_bytes()[:4] not in [b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\x7fELF']
save('manifest.json',dict(schema='M12-safe-delivery-v1',group='M12-F01-attempt015-qualification',files=files,formalIncrement=0,qualificationPassed=False,productionAExecuted=False,resourcesHeld=[]))
for row in files:assert sha(OUT/row['path'])==row['sha256']
print(json.dumps(dict(safeRoot=str(OUT),manifestSHA256=sha(OUT/'manifest.json'),members=len(files),provenanceSHA256=sha(OUT/'member-provenance.json'),resourcesHeld=[]),ensure_ascii=False))
