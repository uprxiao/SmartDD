from pathlib import Path
from collections import Counter
import json,hashlib,subprocess,datetime
r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-native-conflicts-ay-20261022');u=e/'ui-work';base='f28089845a6b4167aca1a51e407900a30aacaee5';sha=lambda b:hashlib.sha256(b).hexdigest();at=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip()==base
assert subprocess.check_output(['git','branch','--show-current'],cwd=r,text=True).strip()=='feature/0.0.2'
related=json.loads((e/'related1-result.json').read_text());remaining=json.loads((e/'remaining-result.json').read_text());ui=json.loads((e/'ui-result.json').read_text());types=json.loads((e/'types-result.json').read_text())
for j in [related,remaining,ui]:assert j['exitCode']==j['failed']==j['pending']==0 and j['sourceFrozen']
assert (related['files'],remaining['files'],ui['files'])==(3,61,1) and types['exitCode']==0 and types['sourceFrozen']
reports=[json.loads((e/n).read_text()) for n in ['related1-report.json','remaining-report.json','ui-green-report.json']];allfiles={};counts=Counter()
for j in reports:
 for t in j['testResults']:
  path=t['name'];path=str(Path(path).relative_to(u if str(u) in path else w));assert path not in allfiles,path;allfiles[path]=t['assertionResults']
  for a in t['assertionResults']:counts[a['status']]+=1
assert len(allfiles)==65 and counts=={'passed':1313},counts
old=json.loads(Path('/private/tmp/m10-independent-capabilities-ax-20261022/regression-report.json').read_text());oldfiles={str(Path(t['name']).relative_to(w)):t['assertionResults'] for t in old['testResults']};new=removed=0
for path,tests in oldfiles.items():
 before=Counter(t['fullName'] for t in tests);after=Counter(t['fullName'] for t in allfiles[path]);new+=sum((after-before).values());removed+=sum((before-after).values())
assert new==20 and removed==0,(new,removed)
main=json.loads((e/'build-input-snapshot.json').read_text());overlay=json.loads((e/'ui-source.json').read_text());allowed={f['path']:f['sha256'] for f in overlay['files']};assert len(allowed)==2
for f in main['files']:
 assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
 assert sha((u/f['path']).read_bytes())==allowed.get(f['path'],f['sha256']),f['path']
env=json.loads((e/'environment.json').read_text())
for f in env['nativeInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256']
# Both main jobs have exited successfully before merging the separately verified UI.
for f in overlay['files']:(w/f['path']).write_bytes((u/f['path']).read_bytes())
finalfiles=[]
for f in main['files']:
 raw=(w/f['path']).read_bytes();finalfiles.append({'path':f['path'],'bytes':len(raw),'sha256':sha(raw)})
deltas=[f['path'] for f,p in zip(finalfiles,main['files']) if f['sha256']!=p['sha256']];assert set(deltas)==set(allowed)
(e/'final-build-input-snapshot.json').write_text(json.dumps({'at':at(),'files':finalfiles},indent=2)+'\n');(e/'layer-reuse.json').write_text(json.dumps({'at':at(),'mainFiles':64,'mainSourceSnapshot':'build-input-snapshot.json','finalSourceSnapshot':'final-build-input-snapshot.json','onlyInputChanges':deltas,'all2004OtherInputsUnchanged':True,'mainReportsDisjoint':True,'mainSoftwarePassed':1299,'uiReport':'ui-green-report.json','uiPassed':14,'uiAlsoVerifiedAgainstSameMainSources':True,'finalTypecheckAlsoUsesExactFinal2006Inputs':True,'counting':'65 unique files,assertion parameter occurrences preserved;3 reports disjoint;no red/filtered/repeated/old AX results added'},indent=2)+'\n')
prior=json.loads((e/'source.json').read_text());paths=[f['path'] for f in prior['files']]+list(allowed);assert len(set(paths))==len(paths)==10;source=[];diff=[]
for path in paths:
 raw=(w/path).read_bytes();old=subprocess.run(['git','show',base+':'+path],cwd=r,capture_output=True);before=None if old.returncode else sha(old.stdout)
 assert not (r/path).exists() if before is None else sha((r/path).read_bytes())==before,path
 source.append({'path':path,'bytes':len(raw),'sha256':sha(raw),'priorSha256':before});p=e/'final-source'/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
 d=subprocess.run(['git','diff','--no-index','--','/dev/null' if before is None else str(r/path),str(w/path)],capture_output=True,text=True);assert d.returncode==1;diff.append(d.stdout.replace('a'+str(r/path),'a/'+path).replace('b'+str(w/path),'b/'+path).replace('a/dev/null','a/'+path))
final={'baseCommit':base,'files':source,'inheritedMirrorInputs':prior['inheritedMirrorInputs']};(e/'final-source.json').write_text(json.dumps(final,ensure_ascii=False,indent=2)+'\n');(e/'final-source.diff').write_text(''.join(diff))
recover=e/'final-recovered-source';assert not recover.exists();recover.mkdir()
for f in source+prior['inheritedMirrorInputs']['files']:
 if f['priorSha256']:
  p=recover/f['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(subprocess.check_output(['git','show',base+':'+f['path']],cwd=r))
for patch in ['final-source.diff','inherited-mirror.diff']:subprocess.run(['git','apply',str(e/patch)],cwd=recover,capture_output=True,check=True)
for f in source+prior['inheritedMirrorInputs']['files']:assert sha((recover/f['path']).read_bytes())==f['sha256']
(e/'final-source-recovery.json').write_text(json.dumps({'at':at(),'base':base,'sourceFiles':10,'inheritedMirrorInputs':5,'appliedActualParentPlusSeparatePatches':True,'all15HashesMatch':True,'inheritedPrototypesNotAYEditsOrCopiedToCanonical':True},indent=2)+'\n')
env.update({'sourceFiles':10,'productionFiles':6,'testFiles':4,'sourceInputs':2006,'recordedAt':at(),'testBoundary':'64 application main software files plus1 P09 jsdom file,disjoint reports,exact source matching across two private copies;no actual Agent/App'});(e/'environment.json').write_text(json.dumps(env,ensure_ascii=False,indent=2)+'\n')
v={'at':at(),'software':{'files':65,'mainFiles':64,'mainPassed':1299,'uiFiles':1,'uiPassed':14,'total':1313,'passed':1313,'failed':0,'pending':0,'newCases':22,'mainNewCases':20,'uiNewCases':2,'removedMainCases':0,'singleInvocation':False,'reports':['related1-report.json','remaining-report.json','ui-green-report.json'],'counting':'disjoint files,all actual parameter occurrences;red/filtered/repeated/AX runs not added'},'sourceFiles':10,'productionFiles':6,'testFiles':4,'sourceInputs':2006,'sourceFrozen':True,'typecheckExit':0,'layerReuse':'layer-reuse.json','preliminary':{'primaryRed':{'failed':4,'filtered':110},'primaryGreen':{'passed':4,'filtered':110},'uiRed':{'failed':2,'filtered':12,'fixtureCorrection':'ui-fixture-correction.md'},'uiRed2':{'failed':2,'filtered':12}},'nativeInputsUnchanged':True,'newAppBuilt':False,'actualAgentSessionRun':False,'actualAppUiRun':False,'goal':'active full M10;phase5;not complete'};(e/'verification.json').write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
state={'at':at(),'branch':'feature/0.0.2','HEAD':base,'privateSource':str(w),'uiPrivateCopy':str(u),'source':str(e/'final-source.json'),'verification':v,'liveSessions':{},'canonicalCopied':False,'goal':'active full M10;phase5;not complete'};(e/'precommit-state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n');(e/'current-state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n');Path('/private/tmp/m10-current-handoff-20261022.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n');print(json.dumps(v,ensure_ascii=False))
