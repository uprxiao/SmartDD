from pathlib import Path
from datetime import datetime,timezone
from collections import Counter
import json,hashlib,subprocess,stat
c=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');p=Path('/private/tmp/m10-legacy-guard-bd-20261022');w=p/'candidate';bc=Path('/private/tmp/m10-native-omissions-bc-20261022');parent='1d1fd835a630722571fbeac680bfda82ba5b9b63';read=lambda n:json.loads((p/n).read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=c,text=True).strip()==parent
reports={k:read(k+'-full-report.json')for k in ['main','related']};actual={}
for k,d in reports.items():
 assert read(k+'-full-result.json')['exitCode']==0 and d['success'] and d['numFailedTests']==d['numPendingTests']==0
 for s in d['testResults']:
  path=str(Path(s['name']).relative_to(w));assert path not in actual;actual[path]=s['assertionResults'];assert all(a['status']=='passed'for a in actual[path])
assert len(actual)==20 and reports['main']['numPassedTests']==212
old=json.loads((bc/'candidate2-final-main-report.json').read_text());before=Counter(a['fullName']for s in old['testResults']for a in s['assertionResults']);after=Counter(a['fullName']for a in actual['src/main/core/applications/__tests__/task-capability-launcher.test.ts']);added=after-before;removed=before-after;assert sum(added.values())==19 and not removed
source=read('source-overlay.json');assert len(source['files'])==6
for f in source['files']:assert sha((w/f['path']).read_bytes())==f['candidateSha256'] and sha((c/f['path']).read_bytes())==f['parentSha256']
inputs=read('candidate-inputs.json')['files'];assert len(inputs)==2011
for f in inputs:assert sha((w/f['path']).read_bytes())==f['sha256'] and stat.S_IMODE((w/f['path']).stat().st_mode)==f['mode'],f['path']
for f in read('runtime-output-inputs-observed.json')['files']:assert sha((w/f['path']).read_bytes())==f['sha256']
assert len(read('runtime-output-inputs-observed.json')['files'])==69
native=[]
for path,expected in [('out/native/willyou-process-identity','3d5b2e3d718d22d9730967e89725b1b71f0ab4f9ebcd5a3fafe8602c5f868b51'),('node_modules/better-sqlite3/build/Release/better_sqlite3.node','803376bb5b623b0c3ccf806817c39a6e78da8a7e06f62174dfef57b3967c4270'),('node_modules/node-pty/build/Release/pty.node','2563297076414a301f3323f7f0a69983704b4cc2720eba37aec3fd91953d6075')]:
 b=(w/path).read_bytes();assert sha(b)==expected;native.append({'path':path,'sha256':expected,'bytes':len(b),'existingOutput':True})
(p/'native-pins.json').write_text(json.dumps({'files':native,'rebuilt':False},indent=2)+'\n')
overlay={f['path']for f in source['files']};inherited=[]
for f in inputs:
 path=f['path']
 if path not in overlay and sha((c/path).read_bytes())!=f['sha256']:inherited.append({'path':path,'canonicalSha256':sha((c/path).read_bytes()),'privateSha256':f['sha256']})
assert len(inherited)==5 and all(f['path'].startswith('prototypes/m6-codex/')for f in inherited)
(p/'canonical-input-boundary.json').write_text(json.dumps({'inputFiles':2011,'sourceOverlayFiles':6,'inheritedPrototypeFiles':5,'inheritedPrototypeDifferences':inherited,'allOtherNonOverlayBytesMatch':True,'inheritedNotCopiedOrClaimedAsNew':True},indent=2)+'\n')
sw={'files':20,'total':sum(len(a)for a in actual.values()),'passed':sum(len(a)for a in actual.values()),'failed':0,'pending':0,'mainPassed':212,'relatedPassed':reports['related']['numPassedTests'],'newCases':19,'removedCases':0,'counting':'one complete212 main plus19 complete related files;unique file/fullName/parameter occurrence;reds,filtered and repeated target executions not added;not fullphase or App acceptance'}
assert read('types-final-result.json')['exitCode']==0
v={'at':datetime.now(timezone.utc).isoformat(),'sourceBase':parent,'sourceFrozen':True,'inputFiles':2011,'sourceFiles':6,'productionFiles':5,'testFiles':1,'software':sw,'typecheckExit':0,'typecheck':'types-final-result.json;node+web;observed12955exit0','firstRun':'8fixture errors before tested mutation;synthetic bridge exit missing;retained','originalProductRed':{'passed':0,'failed':8,'filtered':193},'initialFix':{'passed':8,'failed':0,'typeExit':2,'typeIssue':'history intermediate native.runner widened;existing request type annotation added'},'followup1':{'passed':18,'failed':1,'filtered':193,'typeExit':2,'classification':'test constructor argument order;no product/expectation changes'},'proofFixtureRetest':{'passed':1,'failed':0,'filtered':211},'finalFullMain':{'passed':212,'failed':0,'pending':0},'runtime69ObservedAndUnchanged':True,'nativePins':'native-pins.json;existing3notrebuilt','sourceRecovery':read('source-recovery-proof.json'),'canonicalBoundary':'5 inheritedprototype differencesnotcopied;all other nonoverlay bytes match','requirementObservations':{'newRowsObserved':5,'confirmedNewGap':'REVIEW-04 existingR02-08 UI guide/entry and M10 transfer regressions','whole87Complete':False,'formalCaseStatusChanged':False},'newAppBuilt':False,'actualAgentSessionRun':False,'externalBusinessOrMailSend':False,'M9Mutated':False,'oldAFUnknownBridge':'held untouched','released':False,'goal':'active full M10;phase5;not complete'}
(p/'verification.json').write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');(p/'case-delta.json').write_text(json.dumps({'added':dict(added),'removed':dict(removed),'newCases':19,'totalMain':212},indent=2)+'\n');(p/'post-suite-inputs.json').write_text(json.dumps({'at':v['at'],'all2011FrozenBytesAndModesUnchanged':True,'existingRuntime69Unchanged':True,'nativePins3Unchanged':True,'noBuild':True},indent=2)+'\n')
s=(p/'checkpoint-draft.md').read_text().replace('FINAL_RESULTS_PENDING',f"本次同一冻结候选的20个不同软件文件共{sw['passed']}项全部通过：完整launcher 212项＋19个相关文件{sw['relatedPassed']}项，0失败、0待执行；19项新增已包含，旧用例无移除。最终node／web类型检查exit0。2011份源输入及模式在执行前后相同，69份既有输出及3份原生pins核对未变；父提交加补丁实际恢复6文件并逐hash一致。见[本批证据](../验收/证据/m10-legacy-guard-bd-20261023.json)。")
(p/'checkpoint-final.md').write_text(s);print(json.dumps(v,ensure_ascii=False))
