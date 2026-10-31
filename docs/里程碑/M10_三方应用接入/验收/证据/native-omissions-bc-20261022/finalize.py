from pathlib import Path
from datetime import datetime,timezone
from collections import Counter
import json,hashlib,subprocess
c=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-native-omissions-bc-20261022');t=e/'candidate2';parent='74bed931d489902010c78bf685cfb114f6828000';read=lambda n:json.loads((e/n).read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=c,text=True).strip()==parent
assert read('candidate2-final-main-result.json')['exitCode']==read('related-full-result.json')['exitCode']==0
reports={'main':read('candidate2-final-main-report.json'),'related':read('related-full-report.json')};actual={}
for kind,d in reports.items():
 assert d['success'] and d['numFailedTests']==d['numPendingTests']==0
 base=t if kind=='main' else w
 for s in d['testResults']:
  name=str(Path(s['name']).relative_to(base));assert name not in actual;actual[name]=s['assertionResults'];assert all(a['status']=='passed' for a in actual[name])
assert len(actual)==15
old=json.loads(Path('/private/tmp/m10-public-context-bb-20261022/main-full-report.json').read_text());before=Counter(a['fullName'] for s in old['testResults'] for a in s['assertionResults']);after=Counter(a['fullName'] for a in actual['src/main/core/applications/__tests__/task-capability-launcher.test.ts']);added=after-before;removed=before-after;assert sum(added.values())==19 and not removed
source=read('source-overlay.json');assert len(source['files'])==6
for f in source['files']:
 assert sha((c/f['path']).read_bytes())==f['parentSha256'];assert sha((w/f['path']).read_bytes())==sha((t/f['path']).read_bytes())==f['candidateSha256']
inputs=read('candidate2-inputs.json')['files'];assert len(inputs)==2011
for f in inputs:
 for root in [w,t]:assert sha((root/f['path']).read_bytes())==f['sha256'],str(root/f['path'])
assert read('source-mode-boundary.json')['different']==[]
closure=read('related-closure.json');assert closure['testFiles']==14 and closure['relatedLocalInputs']==96 and closure['changedLauncherNotInAnyRelatedClosure']
for f in closure['inputs']:assert sha((t/f['path']).read_bytes())==f['sha256']
for f in read('runtime-output-inputs-observed.json')['files']:assert sha((w/f['path']).read_bytes())==f['sha256']
assert len(read('runtime-output-inputs-observed.json')['files'])==69
boundary=[];inherited=[];overlays={f['path'] for f in source['files']}
for f in inputs:
 path=f['path'];current=(c/path).read_bytes();different=sha(current)!=f['sha256']
 if path in overlays:continue
 if different:inherited.append({'path':path,'canonicalSha256':sha(current),'privateSha256':f['sha256']})
 else:boundary.append(path)
assert len(inherited)==5 and all(x['path'].startswith('prototypes/m6-codex/') for x in inherited)
(e/'canonical-input-boundary.json').write_text(json.dumps({'allInputFiles':2011,'overlayFiles':6,'inheritedPrototypeFiles':5,'inheritedPrototypeDifferences':inherited,'allOtherNonOverlayBytesMatch':True,'notCopiedOrClaimedAsNew':True},ensure_ascii=False,indent=2)+'\n')
sw={'files':15,'total':sum(len(a)for a in actual.values()),'passed':sum(len(a)for a in actual.values()),'failed':0,'pending':0,'newCases':19,'removedCases':0,'mainPassed':reports['main']['numPassedTests'],'relatedPassed':reports['related']['numPassedTests'],'counting':'final complete193 main plus14 related236;one count per file/fullName/parameter occurrence;reds,retests,repeats and filtered tests not added;not a whole software suite rerun'};assert sw['total']==429 and sw['mainPassed']==193 and sw['relatedPassed']==236
assert read('candidate2-main-report.json')['numPassedTests']==191 and read('candidate2-main-report.json')['numFailedTests']==2
assert read('history-retest-result.json')['exitCode']==0 and read('history-retest-report.json')['numPassedTests']==2
assert read('main-full-report.json')['numPassedTests']==188 and read('main-full-report.json')['numFailedTests']==5
v={'at':datetime.now(timezone.utc).isoformat(),'sourceBase':parent,'sourceFrozen':True,'inputFiles':2011,'modesIdentical':True,'sourceFiles':6,'productionFiles':5,'testFiles':1,'software':sw,'typecheck':{'command':'pnpm typecheck','cwd':str(t),'exitCode':0,'observedCompletedSession':58593,'log':'types-candidate2.txt','scope':'node and web noEmit;tool observed exit0;source unchanged since'},'relatedReuse':{'files':14,'passed':236,'localInputs':96,'proof':'related-closure.json;candidate1and2 manifest delta only launcher,not in related closure;all other source/resources identical'},'runtimeOutputs':{'existingObservedAndUnchanged':69,'newBuild':False},'originalRed':{'failed':8,'passed':0,'filtered':174},'initialFix':{'passed':8,'filtered':174},'newFollowups':{'passed':11,'filtered':182},'firstFullRegression':{'passed':188,'failed':5,'classification':'product diagnostic regressions;two scoped production launcher repairs,no assertion edits'},'diagnosticRetest':{'passed':5,'failed':0,'filtered':188},'secondFullRegression':{'passed':191,'failed':2,'classification':'native session identifier waiting;1072/1116s delays observed;cause unproven'},'sameSourceHistoryRetest':{'passed':2,'failed':0,'filtered':191},'finalCompleteMain':{'passed':193,'failed':0,'pending':0},'sourceRecovery':read('source-recovery-proof.json'),'newAppBuilt':False,'actualAgentSessionRun':False,'M9MutatedByThisBatch':False,'released':False,'goal':'active full M10;phase5'}
(e/'verification.json').write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');(e/'case-delta.json').write_text(json.dumps({'added':dict(added),'removed':dict(removed),'newCases':19},ensure_ascii=False,indent=2)+'\n')
(e/'post-suite-inputs.json').write_text(json.dumps({'at':v['at'],'all2011FinalInputsUnchangedInBothCopies':True,'runtime69Unchanged':True,'sourceOverlayFiles':6,'canonicalOtherBoundary':'canonical-input-boundary.json'},indent=2)+'\n')
s=(e/'checkpoint-draft.md').read_text().replace('FINAL_RESULTS_PENDING','最终完整主回归193项通过；复用经过96份本地依赖及完整输入差异核对的14个相关文件236项，合计15个不同软件文件429项通过、0失败、0待执行。19项新增包含在内，原用例无移除。最终类型检查exit0，2011份最终输入及文件模式一致，运行前后源码和69份既有输出hash未变；父提交加补丁恢复6份源文件并逐hash一致。本批5个生产文件、1个测试文件。见[本批证据](../验收/证据/m10-native-omissions-bc-20261022.json)。')
(e/'checkpoint-final.md').write_text(s);print(json.dumps(v,ensure_ascii=False))
