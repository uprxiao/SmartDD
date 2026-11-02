from pathlib import Path
import json,hashlib,collections,datetime
root=Path('/private/tmp/willyou-m11-c23-2637');ev=root/'software-evidence';out=ev/'attempt-007-fixture-recovery';old=ev/'attempt-005-final-full';light=ev/'attempt-006-light-fixture'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=True,indent=2)+'\n')
def validate_manifest(folder,expected):
 assert sha(folder/'manifest.json')==expected,str(folder)
 for row in json.loads((folder/'manifest.json').read_text())['files']:
  p=folder/row['path'];assert p.is_file() and p.stat().st_size==row.get('bytes',row.get('size')) and sha(p)==row['sha256'],str(p)
validate_manifest(old,'90555c4be211743358e797e491b2055bdc64daefac34d4255355cdc8a85bd91b')
validate_manifest(light,'792c57c70a712c0e467f6959d1e09c2da69cbea78270de173e0fd215439fa2f6')
assert not (out/'manifest.json').exists(),'Do not overwrite a sealed recovery'
summary=json.loads((out/'raw-summary.json').read_text());assert summary['allOwnProcessesStopped'] and summary['selectionVerified']
cleanup=json.loads((out/'cleanup.json').read_text());assert not cleanup['codeDrift'] and not cleanup['fixtureDrift'] and not cleanup['privateWrapperDrift']
base_report=json.loads((old/'vitest.json').read_text());light_report=json.loads((light/'vitest.json').read_text());new_report=json.loads((out/'vitest.json').read_text());light_result=json.loads((light/'result.json').read_text())
assert light_result['execution']['exitCode']==0 and light_report['success'] and new_report['success'] and summary['execution']['exitCode']==0
def file_map(report,source,phase):
 result={}
 for s in report['testResults']:
  relative=str(Path(s['name']).relative_to(source));assert relative not in result
  tests=[{'file':relative,'fullName':t.get('fullName') or ' > '.join(t.get('ancestorTitles',[])+[t.get('title','')]),'status':t['status'],'durationMs':t.get('duration'),'failureMessages':t.get('failureMessages',[]),'evidencePhase':phase} for t in s.get('assertionResults',[])]
  result[relative]={'file':relative,'status':s.get('status'),'message':s.get('message'),'tests':tests,'evidencePhase':phase}
 return result
base=file_map(base_report,root/'software-source-attempt-002','attempt-005-final-full');a=file_map(light_report,root/'software-source-fixtures-attempt-003','attempt-006-light-fixture');b=file_map(new_report,root/'software-source-fixtures-attempt-003','attempt-007-fixture-recovery')
assert len(base)==643 and len(a)==2 and len(b)==60 and not set(a)&set(b)
replacement={**a,**b};assert len(replacement)==62 and set(replacement)<=set(base)
assert all(f in replacement for f,s in base.items() if s['status']=='failed')
combined={f:replacement.get(f,s) for f,s in base.items()};all_tests=[t for s in combined.values() for t in s['tests']]
added=[];removed=[];transitions=[];recovered_hook_skips=[]
known_hook_files={'src/main/core/files/office/pages.test.ts','src/main/core/files/office/parser.test.ts','src/main/core/files/office/pptx-service.test.ts','src/main/core/files/office/service.test.ts'}
for f,new in replacement.items():
 previous=base[f];old_keys=[t['fullName'] for t in previous['tests']];new_keys=[t['fullName'] for t in new['tests']]
 assert len(old_keys)==len(set(old_keys)) and len(new_keys)==len(set(new_keys)),f
 before={t['fullName']:t for t in previous['tests']};after={t['fullName']:t for t in new['tests']}
 for name,t in after.items():
  if name not in before:added.append(t)
  else:
   transition={'file':f,'fullName':name,'beforeStatus':before[name]['status'],'afterStatus':t['status'],'afterEvidencePhase':t['evidencePhase']};transitions.append(transition)
   if f in known_hook_files and before[name]['status']=='skipped' and t['status']=='passed':recovered_hook_skips.append(transition)
 for name,t in before.items():
  if name not in after:removed.append(t)
counts=dict(collections.Counter(t['status'] for t in all_tests));transition_counts=dict(collections.Counter(t['beforeStatus']+' -> '+t['afterStatus'] for t in transitions));duplicates=collections.Counter((t['file'],t['fullName']) for t in all_tests);duplicate_labels=[{'file':k[0],'fullName':k[1],'multiplicity':v} for k,v in duplicates.items() if v>1]
assert not removed,'Collection removals require explicit review'
assert counts.get('failed',0)==0 and all(s['status']!='failed' for s in combined.values())
write('collection-transitions.json',{'key':'relative File + fullName','replacementFilesHaveUniqueKeys':True,'newlyCollected':added,'removedFromCollection':removed,'transitionCounts':transition_counts,'transitions':transitions,'recoveredOriginalBeforeAllHookSkips':recovered_hook_skips,'unchangedOriginalDuplicateParameterizedLabels':duplicate_labels,'duplicateBoundary':'Original unreplaced files contain repeated parameterized labels. Their multiplicity is retained; no dictionary deduplication may delete reported assertions. Replacement files have unique keys.'})
write('aggregated-per-test-results.json',{'files':len(combined),'reportedAssertions':len(all_tests),'uniqueFileFullNameKeys':len(duplicates),'statuses':counts,'tests':all_tests})
aggregate={'schema':'willyou-v010-composed-software-evidence-v1','status':'all-executed-assertions-passed-with-original-conditional-skips','singleInvocation':False,'originalInvocation':{'directory':str(old),'exitCode':1,'originalJsonSha256':sha(old/'vitest.json'),'manifestSha256':sha(old/'manifest.json'),'counts':{'passed':base_report['numPassedTests'],'failed':base_report['numFailedTests'],'skipped':base_report['numPendingTests'],'total':base_report['numTotalTests']},'rewritten':False},'supplements':[{'directory':str(light),'exitCode':0,'jsonSha256':sha(light/'vitest.json'),'manifestSha256':sha(light/'manifest.json'),'files':2,'total':light_report['numTotalTests'],'passed':light_report['numPassedTests'],'skipped':light_report['numPendingTests']},{'directory':str(out),'exitCode':summary['execution']['exitCode'],'jsonSha256':sha(out/'vitest.json'),'files':60,'total':new_report['numTotalTests'],'passed':new_report['numPassedTests'],'skipped':new_report['numPendingTests']}],'aggregationKey':'relative File + fullName, preserving original multiplicity for unreplaced duplicate parameterized labels','fileResults':len(combined),'unchangedOriginalFilesReused':len(base)-len(replacement),'replacementFiles':len(replacement),'assertions':len(all_tests),'statuses':counts,'uniqueFileFullNameKeys':len(duplicates),'newlyCollectedAssertions':len(added),'removedAssertions':len(removed),'originalHookSkipsRecovered':len(recovered_hook_skips),'transitionCounts':transition_counts,'duplicateLabelExtraMultiplicity':sum(v-1 for v in duplicates.values() if v>1),'coordinatorReportedCandidateCi':{'candidate':'5471b7ec73fbe82340dd9051bffec66e8ca3e9d0','producer':'coordinator','passed':5866,'skipped':1000,'total':6866},'matchesCoordinatorCiTotals':counts.get('passed',0)==5866 and counts.get('skipped',0)==1000 and len(all_tests)==6866,'flagsAndOriginalTimeoutsUnchanged':True,'formalUniqueCasesAdded':0,'boundary':'This is a per-file evidence composition, not a rewritten exit0 result for the original full invocation. Original exit1, 360 failures, and1053 skipped remain archived. Default platform/native/live gates were not enabled.','candidateAssociation':str(old/'candidate-association.json')}
write('aggregation.json',aggregate)
result={'schema':'willyou-v010-local-environment-recovery-v1','status':'passed-with-original-conditional-skips','source':str(root/'software-source-fixtures-attempt-003'),'candidate':'5471b7ec73fbe82340dd9051bffec66e8ca3e9d0','execution':summary['execution'],'counts':summary['counts'],'selectionVerified':summary['selectionVerified'],'productionOrTestCodeChanged':False,'codeInputCount':3233,'fixtureInputCount':103,'codeDrift':summary['codeDrift'],'fixtureDrift':summary['fixtureDrift'],'privateWrapperDrift':summary['privateWrapperDrift'],'wrapperBoundary':'server.fs.strict stays true; explicit allowed roots are only this frozen source and the approved immutable shared node_modules realpath. Original Vitest config is unchanged.','rawJsonSha256':sha(out/'vitest.json'),'rawOriginalFullJsonUnmodified':True,'aggregate':'aggregation.json','aggregateCounts':{'assertions':len(all_tests),**counts},'newlyCollectedAssertions':len(added),'recoveredOriginalHookSkips':len(recovered_hook_skips),'sourceWasCandidateCheckout':False,'heavyNativeLeaseReleased':True,'allOwnProcessesStopped':True,'noAdditionalCommandsQueuedOrExecuted':True,'formalUniqueCasesAdded':0,'cleanup':'cleanup.json','finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
write('result.json',result)
files=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json'];write('manifest.json',{'schema':'willyou-evidence-manifest-v1','group':'V010-FIXTURE-RECOVERY','attempt':7,'files':files})
print(json.dumps({'resultStatus':result['status'],'localSupplement':summary['counts'],'elapsedSeconds':summary['execution']['elapsedSeconds'],'aggregateAssertions':len(all_tests),'aggregateStatuses':counts,'newlyCollected':len(added),'recoveredHookSkips':len(recovered_hook_skips),'transitions':transition_counts,'unreplacedOriginalFiles':aggregate['unchangedOriginalFilesReused'],'duplicateLabelExtraMultiplicityRetained':aggregate['duplicateLabelExtraMultiplicity'],'matchesCandidateCi':aggregate['matchesCoordinatorCiTotals'],'manifestSha256':sha(out/'manifest.json')},ensure_ascii=True))
