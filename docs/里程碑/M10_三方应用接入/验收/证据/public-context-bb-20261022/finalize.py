from pathlib import Path
from datetime import datetime,timezone
from collections import Counter
import json,hashlib,subprocess
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');c=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');e=Path('/private/tmp/m10-public-context-bb-20261022');sha=lambda b:hashlib.sha256(b).hexdigest();read=lambda name:json.loads((e/name).read_text());parent='2abcab1b16ce9deb3df94eb301a8e7c147b804ee'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=c,text=True).strip()==parent
for kind in ['main','related']:assert read(kind+'-full-result.json')['exitCode']==0
reports={kind:read(kind+'-full-report.json') for kind in ['main','related']}
for d in reports.values():assert d['success'] and d['numFailedTests']==d['numPendingTests']==0
actual={};names=[]
for kind,d in reports.items():
 for suite in d['testResults']:
  path=str(Path(suite['name']).relative_to(w));assert path not in actual;actual[path]=suite['assertionResults'];assert all(t['status']=='passed' for t in actual[path]);names.append(path)
assert len(actual)==66
base=json.loads(Path('/private/tmp/m10-capability-conflicts-ba-20261022/final-main-report.json').read_text())
old=Counter(t['fullName'] for s in base['testResults'] for t in s['assertionResults']);new=Counter(t['fullName'] for t in actual['src/main/core/applications/__tests__/task-capability-launcher.test.ts']);added=new-old;removed=old-new;assert sum(added.values())==26 and not removed
source=read('source-overlay.json');assert len(source['files'])==9
for f in source['files']:
 assert sha((w/f['path']).read_bytes())==f['candidateSha256'],f['path']
 if f['parentSha256']:assert sha((c/f['path']).read_bytes())==f['parentSha256']
 else:assert not(c/f['path']).exists()
for f in read('candidate-inputs.json')['files']:assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
(e/'post-suite-inputs.json').write_text(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'allFrozen2011InputsUnchanged':True,'scopedFiles':9},indent=2)+'\n')
software={'files':66,'total':sum(len(v) for v in actual.values()),'passed':sum(len(v) for v in actual.values()),'failed':0,'pending':0,'newCases':26,'removedCases':0,'mainPassed':reports['main']['numPassedTests'],'relatedPassed':reports['related']['numPassedTests'],'counting':'one frozen174main plus65related;unique file/fullName/parameter occurrence;targeted,filtered,red and repeated executions not added'}
assert software['total']==1379 and software['mainPassed']==174 and software['relatedPassed']==1205
for f in read('runtime-output-inputs-observed.json')['files']:assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
assert read('canonical-input-boundary.json')['inheritedPrototypeFiles']==5
assert read('types-candidate-result.json')['exitCode']==0
verification={'at':datetime.now(timezone.utc).isoformat(),'sourceBase':parent,'sourceFrozen':True,'inputFiles':2011,'canonicalInputBoundary':'canonical-input-boundary.json;5 inherited prototype files unchanged/not copied;all other non-overlay inputs match','runtimeOutputObservation':'69 existing outputs observed mid-run and unchanged through final verification;no App build','sourceFiles':9,'productionFiles':8,'testFiles':1,'software':software,'typecheckExit':0,'firstHRed':{'passed':0,'failed':3,'pendingFiltered':153},'firstHFix':{'passed':8,'failed':0,'pendingFiltered':148},'followup1':{'passed':1,'failed':15,'productFailures':1,'testAssertionErrors':14,'pendingFiltered':156},'followup2':{'passed':16,'failed':0,'pendingFiltered':156},'realPythonMcp':{'passed':5,'actualAgents':False,'secretFixtures':'random fake passwords only;no real DB/SSH connections'},'newAppBuilt':False,'actualAgentSessionRun':False,'M9MutatedByThisBatch':False,'released':False,'goal':'active full M10;phase5'}
review=read('requirement-review-notes.json');alltests=[t for group in actual.values() for t in group]
for row in review['observations']:
 row['softwareMatches']=[{'title':name,'passedInstances':sum(name in t['fullName'] and t['status']=='passed' for t in alltests)} for name in row['software']]
 assert all(t['passedInstances']>0 for t in row['softwareMatches']),row['id']
review['softwareStatus']='all referenced existing cases found passed in this frozen complete main/related run;source observations only;formal/whole87 audit not complete'
(e/'requirement-review-notes.json').write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n')
(e/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n');(e/'case-delta.json').write_text(json.dumps({'added':dict(added),'removed':dict(removed),'newCases':26},ensure_ascii=False,indent=2)+'\n')
text=(e/'checkpoint-draft.md').read_text().replace('FINAL_RESULTS_PENDING','本次同一冻结候选的66个不同软件文件共1379项全部通过，0失败、0跳过；174项完整launcher与65个相关文件1205项合并统计，26项新增已包含，原用例无移除。最终类型检查exit0。2011份输入在运行前后逐字节一致，父提交加补丁实际恢复9文件并逐hash吻合；8个生产文件、1个测试文件。见[本批证据](../验收/证据/m10-public-context-bb-20261022.json)。')
(e/'checkpoint-final.md').write_text(text);print(json.dumps(verification,ensure_ascii=False))
