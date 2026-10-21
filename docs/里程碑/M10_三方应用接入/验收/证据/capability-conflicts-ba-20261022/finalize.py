from pathlib import Path
from collections import Counter
import json,hashlib,subprocess,datetime
r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');e=Path('/private/tmp/m10-capability-conflicts-ba-20261022');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');u=e/'recheck-work';v=e/'final-work';parent='9d38ee044ac425961a7fa54bdb123429f07626cf';sha=lambda b:hashlib.sha256(b).hexdigest();at=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip()==parent
read=lambda n:json.loads((e/n).read_text());first=read('final-main-report.json');second=read('recheck-main-report.json');main=read('candidate3-main-report.json');related=read('final-related-report.json');paths=read('implementation-files.json')
assert main['success'] and main['numPassedTests']==148 and main['numFailedTests']==main['numPendingTests']==0 and len(main['testResults'])==1
assert not first['success'] and first['numPassedTests']==145 and first['numFailedTests']==3 and first['numPendingTests']==0
assert not second['success'] and second['numPassedTests']==147 and second['numFailedTests']==1 and second['numPendingTests']==0
assert related['success'] and related['numFailedTests']==related['numPendingTests']==0 and len(related['testResults'])==65
assert len(paths)==10 and len([p for p in paths if '/__tests__/' in p])==2
original=read('final-inputs.json');candidate=read('candidate3-inputs.json');testOverlay={f['path']:f['sha256'] for f in read('recheck-source.json')['files']};changes=[]
for f,g in zip(original['files'],candidate['files']):
 assert f['path']==g['path'];p=f['path'];assert sha((w/p).read_bytes())==f['sha256'];assert sha((u/p).read_bytes())==testOverlay.get(p,f['sha256']);assert sha((v/p).read_bytes())==g['sha256']
 if f['sha256']!=g['sha256']:changes.append(p)
assert len(original['files'])==len(candidate['files'])==2010 and len(changes)==2 and all('task-capability-launcher' in p for p in changes)
closure=read('related-closure.json');assert closure['allRelatedLocalBytesIdentical'] and closure['changedLauncherNotInAnyRelatedClosure'] and closure['testFiles']==65
for f in closure['inputs']:assert sha((w/f['path']).read_bytes())==sha((v/f['path']).read_bytes())==f['sha256']
actualTests={str(Path(f['name']).relative_to(w)) for f in related['testResults']};assert actualTests=={c['test'] for c in closure['testClosures']}
for f in read('environment.json')['nativeInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256']
for f in read('preexisting-worktree.json')+read('preexisting-untracked.json'):assert sha((r/f['path']).read_bytes())==f['sha256']
firstCases=Counter(t['fullName'] for f in first['testResults'] for t in f['assertionResults']);secondCases=Counter(t['fullName'] for f in second['testResults'] for t in f['assertionResults']);lastCases=Counter(t['fullName'] for f in main['testResults'] for t in f['assertionResults']);assert firstCases==secondCases==lastCases
old=json.loads(Path('/private/tmp/m10-native-guard-az-20261022/main-regression-report.json').read_text());oldCases=Counter(t['fullName'] for f in old['testResults'] for t in f['assertionResults']);assert sum((lastCases-oldCases).values())==17 and not oldCases-lastCases
for f in related['testResults']:
 if f['name'].endswith('/claude-projection-selection.test.ts'):assert len(f['assertionResults'])==12
for report in [main,related]:assert all(t['status']=='passed' for f in report['testResults'] for t in f['assertionResults'])
# Final variant only changes launcher display diagnostics. Its entire test file
# reruns; all65 other test import closures and child/resource inputs are identical.
for p in changes:(w/p).write_bytes((v/p).read_bytes())
for f in candidate['files']:assert sha((w/f['path']).read_bytes())==f['sha256']
(e/'final-build-input-snapshot.json').write_text(json.dumps(candidate,ensure_ascii=False,indent=2)+'\n')
source=[];diff=[]
for p in paths:
 raw=(w/p).read_bytes();old=subprocess.run(['git','show',parent+':'+p],cwd=r,capture_output=True);bh=sha(old.stdout) if old.returncode==0 else None
 if bh is None:assert not(r/p).exists()
 else:assert sha((r/p).read_bytes())==bh,p
 source.append({'path':p,'bytes':len(raw),'sha256':sha(raw),'priorSha256':bh});q=e/'final-source'/p;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(raw)
 d=subprocess.run(['git','diff','--no-index','--','/dev/null' if bh is None else str(r/p),str(w/p)],capture_output=True,text=True);assert d.returncode==1;diff.append(d.stdout.replace('a'+str(r/p),'a/'+p).replace('b'+str(w/p),'b/'+p).replace('a/dev/null','a/'+p))
(e/'final-source.json').write_text(json.dumps({'baseCommit':parent,'files':source,'inheritedMirrorInputs':'same5 prototype files unchanged,not copied'},ensure_ascii=False,indent=2)+'\n');(e/'final-source.diff').write_text(''.join(diff));recover=e/'recovered-source';assert not recover.exists();recover.mkdir()
for f in source:
 if f['priorSha256']:
  p=recover/f['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(subprocess.check_output(['git','show',parent+':'+f['path']],cwd=r))
subprocess.run(['git','apply',str(e/'final-source.diff')],cwd=recover,check=True,capture_output=True)
for f in source:assert sha((recover/f['path']).read_bytes())==f['sha256']
(e/'source-recovery.json').write_text(json.dumps({'at':at(),'parent':parent,'parentPlusPatchActualRecovery':True,'files':10,'allHashesMatch':True},indent=2)+'\n')
sw={'files':66,'total':148+related['numPassedTests'],'passed':148+related['numPassedTests'],'failed':0,'pending':0,'newCases':29,'removedCases':0,'mainPassed':148,'relatedPassed':related['numPassedTests'],'singleInvocation':False,'counting':'latest whole main148 plus65 unchanged-import-closure files;parameter occurrences retained;red,filtered,repeated cases not added'}
proof={'at':at(),'firstMain':{'passed':145,'failed':3,'report':'final-main-report.json'},'secondMain':{'passed':147,'failed':1,'report':'recheck-main-report.json'},'lastMain':{'passed':148,'failed':0,'report':'candidate3-main-report.json'},'relatedReport':'final-related-report.json','relatedFiles':65,'relatedLocalInputs':len(closure['inputs']),'onlyChangedPaths':changes,'relatedLocalInputsByteIdentical':True,'closureProof':'related-closure.json','change':'one production launcher display diagnostic line and same test assertion corrections/strengthening;all148 main cases rerun on exact final variant','allOther2008InputsUnchanged':True,'final2010InputsMergedToPrivateMirror':True};(e/'layer-reuse.json').write_text(json.dumps(proof,indent=2)+'\n')
events=[]
for line in (e/'final-related.txt').read_text().splitlines():
 if line.startswith('CLAUDE_DELIVERY_PROCESS_EVIDENCE '):events.append(json.loads(line.split(' ',1)[1]))
(e/'process-results.json').write_text(json.dumps({'at':at(),'source':'final-related.txt exact structured lines','events':events,'actualAgentOrApp':False,'boundary':'existing generic/same-hash publisher regression;not an added metadata2 subset SIGKILL claim'},indent=2)+'\n')
verification={'at':at(),'sourceFiles':10,'productionFiles':8,'testFiles':2,'sourceInputs':2010,'sourceFrozen':True,'software':sw,'typecheckExit':0,'typecheckRaw':'candidate3-typecheck.txt','typecheckSource':'final-work exact2010 candidate3 inputs','nativeInputsUnchanged':True,'immutableAdapters100And110Unchanged':True,'preliminary':{'originalProductRed':{'passed':0,'failed':10,'filtered':131},'fix1':{'passed':10,'failed':0,'filtered':131},'recoveryAndBoundary':{'passed':19,'failed':0,'filtered':141},'diagnosticFix':{'passed':11,'failed':0,'filtered':137}},'actualAgentSessionRun':False,'newAppBuilt':False,'actualAppUiRun':False,'goal':'active full M10;phase5;not complete'};(e/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n')
state=verification|{'branch':'feature/0.0.2','HEAD':parent,'canonicalCopied':False,'privateSnapshot':str(w),'finalCheckedCopy':str(v),'liveSessions':{},'formalCases':'historical2/72;T42T63;T64partial;current source not packaged'};(e/'current-state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n');Path('/private/tmp/m10-current-handoff-20261022.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n');print(json.dumps(verification,ensure_ascii=False))
