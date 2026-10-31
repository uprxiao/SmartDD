from pathlib import Path
from collections import Counter
import json,hashlib,subprocess,datetime
r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-native-guard-az-20261022');u=e/'recheck-work';base='3e674f6e8e5b6a98405d41b441c7758461af2b5c';sha=lambda b:hashlib.sha256(b).hexdigest();at=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip()==base
main=json.loads((e/'main-regression-report.json').read_text());related=json.loads((e/'related2-report.json').read_text());recheck=json.loads((e/'recheck-report.json').read_text());package=json.loads((e/'package-report.json').read_text());snapshot=json.loads((e/'build-input-snapshot.json').read_text());overlay=json.loads((e/'recheck-source.json').read_text());allowed={f['path']:f['sha256'] for f in overlay['files']}
for j in [main,recheck,package]:assert j['success'] and j['numFailedTests']==j['numPendingTests']==0
assert main['numPassedTests']==131 and len(main['testResults'])==1 and recheck['numPassedTests']==21 and len(recheck['testResults'])==2 and package['numPassedTests']==20 and len(package['testResults'])==1
assert related['numPassedTests']==258 and related['numFailedTests']==3 and related['numPendingTests']==0 and len(related['testResults'])==10
for f in snapshot['files']:
 assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
 assert sha((u/f['path']).read_bytes())==allowed.get(f['path'],f['sha256']),f['path']
assert len(allowed)==2 and all('/__tests__/' in p for p in allowed)
result={};replaced=[]
for j,root in [(main,w),(related,w),(package,w)]:
 for f in j['testResults']:
  path=str(Path(f['name']).relative_to(root));assert path not in result;result[path]=f['assertionResults']
for f in recheck['testResults']:
 path=str(Path(f['name']).relative_to(u));assert path in allowed and Counter(t['fullName'] for t in result[path])==Counter(t['fullName'] for t in f['assertionResults']);assert any(t['status']=='failed' for t in result[path]);result[path]=f['assertionResults'];replaced.append(path)
assert len(result)==12 and len(replaced)==2 and sum(len(v) for v in result.values())==412 and all(t['status']=='passed' for v in result.values() for t in v)
parent=Path('/private/tmp/m10-native-conflicts-ay-20261022');prior={}
for n in ['related1-report.json','remaining-report.json']:
 for f in json.loads((parent/n).read_text())['testResults']:prior[str(Path(f['name']).relative_to(w))]=f['assertionResults']
new=removed=0
for p,tests in result.items():
 before=Counter(t['fullName'] for t in prior.get(p,[]));after=Counter(t['fullName'] for t in tests);new+=sum((after-before).values());removed+=sum((before-after).values())
assert new==25 and removed==0,(new,removed)
process=[]
for line in (e/'recheck.txt').read_text().splitlines():
 if line.startswith('CLAUDE_DELIVERY_PROCESS_EVIDENCE '):process.append(json.loads(line.split(' ',1)[1]))
same=[p for p in process if 'sameHash' in p];assert len(same)==3 and {p['phase'] for p in same}=={'registered','backed-up','delivered'} and all(p['publisherStateAfterSIGKILL']=='stopped' and p['actualAgent'] is False for p in same)
(e/'same-hash-process-results.json').write_text(json.dumps({'at':at(),'source':'recheck.txt exact structured lines','sameHashCases':same,'otherProcessRecords':len(process)-3},indent=2)+'\n')
for f in json.loads((e/'environment.json').read_text())['nativeInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256']
for f in overlay['files']:(w/f['path']).write_bytes((u/f['path']).read_bytes())
final=[]
for f in snapshot['files']:
 raw=(w/f['path']).read_bytes();final.append({'path':f['path'],'bytes':len(raw),'sha256':sha(raw)})
deltas=[f['path'] for f,old in zip(final,snapshot['files']) if f['sha256']!=old['sha256']];assert set(deltas)==set(allowed)
(e/'final-build-input-snapshot.json').write_text(json.dumps({'at':at(),'files':final},indent=2)+'\n');(e/'layer-reuse.json').write_text(json.dumps({'at':at(),'mainReport':'main-regression-report.json','initialRelatedReport':'related2-report.json','initialRelated':{'passed':258,'failed':3},'recheckedWholeFiles':replaced,'recheckReport':'recheck-report.json','rechecked':{'files':2,'passed':21,'failed':0,'pending':0},'onlyChangedInputPaths':deltas,'allProductionAndOther2006InputsUnchanged':True,'main131AndUnchangedRelatedCasesRemainApplicable':True,'finalTypecheckCopyMatchesExactFinal2008Inputs':True,'counting':'latest per file;keep every parameter occurrence,no red/filter/repeat/AY counts added'},indent=2)+'\n')
paths=list(dict.fromkeys([f['path'] for f in json.loads((e/'source.json').read_text())['files']]+list(allowed)));assert len(paths)==10;source=[];diff=[]
for path in paths:
 raw=(w/path).read_bytes();old=subprocess.run(['git','show',base+':'+path],cwd=r,capture_output=True);bh=sha(old.stdout) if old.returncode==0 else None
 if bh is None:assert not (r/path).exists(),path
 else:assert sha((r/path).read_bytes())==bh,path
 source.append({'path':path,'bytes':len(raw),'sha256':sha(raw),'priorSha256':bh});p=e/'final-source'/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
 d=subprocess.run(['git','diff','--no-index','--','/dev/null' if bh is None else str(r/path),str(w/path)],capture_output=True,text=True);assert d.returncode==1;diff.append(d.stdout.replace('a'+str(r/path),'a/'+path).replace('b'+str(w/path),'b/'+path).replace('a/dev/null','a/'+path))
(e/'final-source.json').write_text(json.dumps({'baseCommit':base,'files':source,'inheritedMirrorInputs':'same5 prototypes as AY;unchanged,not copied'},indent=2)+'\n');(e/'final-source.diff').write_text(''.join(diff));recover=e/'final-recovered-source';assert not recover.exists();recover.mkdir()
for f in source:
 if f['priorSha256']:
  p=recover/f['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(subprocess.check_output(['git','show',base+':'+f['path']],cwd=r))
subprocess.run(['git','apply',str(e/'final-source.diff')],cwd=recover,capture_output=True,check=True)
for f in source:assert sha((recover/f['path']).read_bytes())==f['sha256']
(e/'final-source-recovery.json').write_text(json.dumps({'at':at(),'baseCommit':base,'sourceFiles':10,'actualParentPlusPatch':True,'allHashesMatch':True},indent=2)+'\n')
software={'files':12,'total':412,'passed':412,'failed':0,'pending':0,'newCases':25,'removedCases':0,'singleInvocation':False,'mainPassed':131,'relatedLatestPassed':261,'packagePassed':20,'reports':['main-regression-report.json','related2-report.json','package-report.json','recheck-report.json'],'counting':'latest exact full-file recheck replaces2 files,parameter instances preserved;all raw failures retained'}
v={'at':at(),'sourceFiles':10,'productionFiles':5,'testFilesIncludingPublisherFixture':5,'sourceInputs':2008,'sourceFrozen':True,'software':software,'typecheckExit':0,'typecheckRaw':'types-recheck.txt','layerReuse':'layer-reuse.json','nativeInputsUnchanged':True,'preliminary':{'primaryRed':{'passed':2,'failed':2,'filtered':122},'primaryGreen1':{'passed':4,'failed':0,'filtered':122},'foundation1':{'passed':69,'failed':0,'pending':0},'preSlotInitial':{'passed':1,'failed':1,'classification':'fixture wrong branch/incomplete lease query'},'preSlotRed2':{'passed':0,'failed':2,'filtered':126},'primaryGreen3':{'passed':8,'failed':1,'filtered':122},'restore1':{'passed':0,'failed':1,'filtered':130},'primaryGreen4':{'passed':9,'failed':0,'filtered':122},'related2':{'passed':258,'failed':3,'pending':0,'classification':'two checkpoint C-lock fixture failures and old diagnostic bypass of mandatory delivery token'}},'actualAgentSessionRun':False,'newAppBuilt':False,'actualAppUiRun':False,'goal':'active full M10;phase5;not complete'};(e/'verification.json').write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');(e/'types-recheck-result.json').write_text(json.dumps({'at':at(),'exitCode':0,'sourceFrozen':True,'sourceInputs':2008,'source':'recheck-work','overlay':'recheck-source.json'},indent=2)+'\n')
env=json.loads((e/'environment.json').read_text());env.update({'sourceFiles':10,'productionFiles':5,'testFilesIncludingPublisherFixture':5,'sourceInputs':2008,'recordedAt':at(),'testBoundary':'full131 TaskService software cases plus11 related module files;actual isolated publisher SIGKILL,exact two-test-file fixture overlay;no actual Agent/App'});(e/'environment.json').write_text(json.dumps(env,ensure_ascii=False,indent=2)+'\n')
state={'at':at(),'branch':'feature/0.0.2','HEAD':base,'worktree':str(r),'privateSource':str(w),'recheckSource':str(u),'phase':5,'verification':v,'liveSessions':{},'canonicalCopied':False,'goal':'active full M10;not complete'};(e/'precommit-state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n');(e/'current-state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n');Path('/private/tmp/m10-current-handoff-20261022.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n');print(json.dumps(v,ensure_ascii=False))
