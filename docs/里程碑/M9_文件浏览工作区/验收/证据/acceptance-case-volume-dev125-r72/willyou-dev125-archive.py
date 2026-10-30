from pathlib import Path
import datetime,gzip,hashlib,json,platform,shutil,tarfile
r=Path('/Users/hx/hx/hxWork/SmartDD');s=r/'docs/里程碑/M9_文件浏览工作区';b=Path('/private/tmp');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
previous=s/'验收/证据/m9-acceptance-resource-url-dev124-r72-20261019.json';assert sha(previous)=='1fc37b4ccabe1513a132329d691827ec1a517555b41798365fb1b4d290d5d17e';old=json.loads(previous.read_text())
for a in old['artifacts'].values():assert sha(r/a['path'])==a['sha256']
m=json.loads((b/'willyou-m9-acceptance-batch-r72-dev125-tested-sources.json').read_text());prior=json.loads((b/'willyou-m9-acceptance-batch-r72-dev124-tested-sources.json').read_text());assert len(m['files'])==1175 and len(m['addedFiles'])==4 and m['changedFromPrevious']==[]
for p,h in prior['files'].items():assert m['files'][p]==h
for p,h in m['files'].items():assert sha(r/p)==h,p
assert sha(m['path'])==m['sha256']
with tarfile.open(m['path']) as tar:
 assert len(tar.getmembers())==1175
 for e in tar.getmembers():assert hashlib.sha256(tar.extractfile(e).read()).hexdigest()==m['files'][e.name]
assert json.loads((s/'验收/用例覆盖索引.json').read_text())==json.loads((b/'willyou-dev125-index-before.json').read_text())
code=json.loads((b/'willyou-dev125-code-final.json').read_text());assert code['success'] and (code['numPassedTests'],code['numFailedTests'],code['numPendingTests'])==(6,0,0)
native=json.loads((b/'willyou-dev125-native-final.json').read_text());assert len(native['rows'])==6 and all(x['pass'] for x in native['rows']) and all(v['detached'] for v in native['environment']['volumes'])
appSummary=json.loads((b/'willyou-dev125-app-r2.log').read_text().splitlines()[-1]);directory=Path(appSummary['artifacts']);app=json.loads((directory/'result.json').read_text());assert app['status']=='passed-macos-ia-only' and len(app['checks'])==4 and all(x['pass'] for x in app['checks'])
assert len(app['exits'])==4 and all(x['code']==0 and x['signal'] is None for x in app['exits'])
assert all(all(x.values()) for x in app['restored']) and len(app['aliasRegistration'])==4
for rpc in app['rpc']:
 for x in rpc['rows']:
  if x.get('delivered'):assert x['before']==x['after']
audit=json.loads((b/'willyou-dev125-process-audit.json').read_text());assert audit['allClosed'] and audit['allOwnVolumesDetached']
assert json.loads((b/'willyou-dev125-runtime-r72.json').read_text())['verified']==82
resources=Path(old['app']['path'])/'Contents/Resources';assert sha(resources/'app.asar')==app['asarSha256']==old['app']['asarSha256'];assert sha(resources/'native/willyou-files')==old['app']['brokerSha256'];assert json.loads((b/'willyou-dev125-watcher-r72.json').read_text())['sha256']==old['app']['watcherSha256']
out=s/'验收/证据/acceptance-case-volume-dev125-r72';report=s/'验收/证据/m9-acceptance-case-volume-dev125-r72-20261019.json';assert not report.exists();out.mkdir(exist_ok=True);artifacts={}
def copy(p,label):
 target=out/label;target.parent.mkdir(parents=True,exist_ok=True)
 if Path(p).suffix=='.json' and Path(p).stat().st_size>1024*1024:
  original=Path(p).read_bytes();target=target.with_name(target.name+'.gz');data=gzip.compress(original,mtime=0)
  if target.exists():assert target.read_bytes()==data
  else:target.write_bytes(data)
  artifacts[str(target.relative_to(out))]={'path':str(target.relative_to(r)),'sha256':sha(target),'encoding':'gzip','uncompressedSha256':hashlib.sha256(original).hexdigest()}
 else:
  if target.exists():assert sha(target)==sha(p)
  else:shutil.copy2(p,target)
  artifacts[label]={'path':str(target.relative_to(r)),'sha256':sha(target)}
for p in sorted(b.glob('willyou-dev125-*')):
 if p.is_file() and p.suffix in ['.json','.log','.py','.mjs','.cjs','.stderr']:copy(p,p.name)
for ext in ['json','tar.gz']:
 p=b/('willyou-m9-acceptance-batch-r72-dev125-tested-sources.'+ext);copy(p,p.name)
for record in audit['fixtureEnvironments']:
 directory=Path(record['path']).parent
 for p in sorted(directory.iterdir()):
  if p.is_file() and p.suffix in ['.json','.log','.png','.plist']:copy(p,'runs/'+directory.name+'/'+p.name)
notes='''Partial M05: current macOS arm64 I6/A4 passed, X unexecuted. The glossary explicitly defines X as Windows/Linux/other-Mac-arch installed systems; two filesystem personalities on this machine do not satisfy it. Formal233/41955.61% unchanged,184unexecuted2blocked,183remaining A. No full new case, no scope/expected change, no production/prototype/build changes or release.
Own two64MiBimages per run; APFS exclusive-create lower a.txt returnsEEXIST/sameinode/samebytes, Case-sensitiveAPFS allowsdistinctA/a inode/bytes. Native actualSQLite/source/root/FileService/recovery/packaged broker I6: case identity/read/list/save, canonical root+contained file/directory/nested aliases, distinct leases/sameactualdocumentKey, simultaneous aliased saves one saved/oneconflict, correctly checkpointed losingL retained. Root-alias duplicate DB rows in I are explicit raw/legacy fixture input, not accepted current project configuration. No native result mocks.
Actual normalr72 A4(light/dark xtwofilesystems): real root/tree/tab/input/CtrlS, sensitiveA/a keep two dirtytabs/ownbytes and bothsave independently, insensitivehostshowsoneA row (literal lowercasea input is I, no invented UIrow). Root-file symlink and valid nested source reuse one dirtybuffer, selection/history and Undo/Redo retained; actual externalD->visibleconflict->continueEditing->realCtrlS writeslocalL against exactDhash; aliasagainkeepssinglebuffer. Raw root-symlink duplicate registration is correctly rejected by original projectDirs.add. Final driver asserts this original rejection, registers only permitted nested root, never bypasses source configuration. Four normalexit0/null, originalRPC forwarding hashes unchanged/restored. Own images all detached, current hdiutilimage-path and process-prefix audit empty.
Failures retained: first setup used diskutil aliasAPFSX which hdiutil rejects; exact local help names Case-sensitiveAPFS, changed formatter string only, first suite6pending is not a pass. Next6failed because fixture forgot actual userData directory before nativeinitialize-recovery; added directory, no production change. Next4pass2fail because directsavepreflight conflicts do not create independent editor checkpoints; originalFileBuffer.save explicitly awaits checkpointSnapshot beforeapi.save, fixture now does same realcheckpointfirst, preserving all losingdraft assertions. FirstA0 failed because duplicate realpath root registration is forbidden; keptcorrecterror and switched to real existingUI routes, no acceptance bypass. Two script-construction errors before any tool execution were not App failures and no historical code snapshot fabricated.
1175tested source tar addsfour verificationfiles; all1171prior hashes unchanged. Same r72 internal0.0.5 ASAR/broker/watcher and fresh82runtime verified, previous189artifacts unchanged. Prior sixsmokes/P243/shared16/build/Sites4 remain unchanged-hash prior results, not fresh full-suite/pixel reruns. No clipboard, physicalIME, model/CLI/externalApp/dailyresources or crossplatformclaim. Synthetic DTO/log/source/screenshots/owned-volumeplists only, no userData/DB/wholeApp/DMG archived. M05 remainsunexecuted overall untilX, then continue Y01/Y02/Y03 and other independent pendingcases.
'''
p=out/'execution-boundaries.txt';p.write_text(notes);artifacts[p.name]={'path':str(p.relative_to(r)),'sha256':sha(p)}
value={'schemaVersion':1,'id':'M9-ACCEPTANCE-CASE-VOLUME-DEV125-R72','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localDate':'2026-10-19','status':'partial-case-macos-ia-passed-x-unexecuted','revision':'R3.4 / R3.4-P1; M05 original scope/steps/expected retained','branch':m['branch'],'head':m['head'],'platform':platform.platform(),'architecture':platform.machine(),'fullCasesPassed':[],'partialCases':['M9-T-M05'],'caseProgress':{'M9-T-M05':{'I':'current macOS arm64 passed','A':'current macOS arm64 passed','X':'Windows/Linux/other Mac architecture unexecuted; not inferred from APFS/APFSX on arm64'}},'productionChanges':[],'prototypeChanges':[],'defects':[],'app':old['app'],'previousReport':{'path':str(previous.relative_to(r)),'sha256':sha(previous),'all189ArtifactsUnchanged':True},'sourceBaseline':{'previousTestedFiles':1171,'testedFiles':1175,'previousTestedSha256':prior['sha256'],'finalTestedSha256':m['sha256'],'priorSourceFilesUnchanged':1171,'newVerificationFiles':m['addedFiles']},'verification':{'currentCodePassed':6,'newUniqueCodeTests':6,'newTestsByBoundary':{'I':6},'currentSkipped':0,'currentTypecheckExit':0,'nativeRows':6,'actualAppScenarios':4,'normalQuits':app['exits'],'ownEnvironmentsClosed':len(audit['fixtureEnvironments']),'ownVolumesDetached':sum(x['volumes'] for x in audit['fixtureEnvironments']),'formalPassed':233,'formalTotal':419,'formalRemaining':186,'unexecuted':184,'blocked':2,'appRemaining':183},'boundaries':[native['boundary'],app['boundary'],notes],'artifacts':artifacts}
report.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(report.relative_to(r)),'sha256':sha(report),'artifacts':len(artifacts),'formalPassed':233,'percentage':round(233/419*100,2),'M05':'I/A Mac passed, X unexecuted'},ensure_ascii=False))
