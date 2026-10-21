from pathlib import Path
import json,hashlib,subprocess,datetime,platform
r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');x=Path('/private/tmp/m10-snapshot-cases-x-20261021');y=Path('/private/tmp/m10-t63-settled-ab-20261021');app=Path('/private/tmp/willyou-m10-snapshots-x-8WvIfw')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=r)
def save(name,data):(y/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
assert git('branch','--show-current').decode().strip()=='feature/0.0.2';head=git('rev-parse','HEAD').decode().strip();assert head=='4a43b4e013bf3b62022e4965f2017e3b043fa7e9'
source=json.loads((Path('/private/tmp/m10-native-root-z-20261021')/'source.json').read_text())
for f in source['files']:
 assert digest(r/f['path'])==f['sha256'];assert digest(Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4')/f['path'])==f['sha256'];assert hashlib.sha256(git('show','HEAD:'+f['path'])).hexdigest()==f['sha256']
receipt=json.loads((Path('/private/tmp/m10-native-root-z-20261021')/'package-verification.json').read_text());bundle=Path('/private/tmp/m10-native-root-z-package-20261021/mac-arm64/WillYou.app');assert digest(bundle/'Contents/Resources/app.asar')==receipt['asarSha256']
results=[json.loads((app/name).read_text()) for name in ['result.json','result-continuation.json','result-continuation-2.json','result-continuation-3.json','result-continuation-4.json','result-continuation-5.json','result-continuation-6.json','result-continuation-7.json']]
for number in [6,7]:
 driver=Path('/private/tmp/m10-native-root-z-20261021')/('packaged-t63-settled.mjs' if number==6 else 'packaged-t63-settled-continuation.mjs');assert "&&!document.querySelector('[data-testid=task-resume]')?.disabled" in driver.read_text()
assert results[-2]['status']=='deferred-focus-loss';assert results[-2]['cases'][0]['kind']=='bad-json' and results[-2]['cases'][0]['after'];assert results[-2]['asarSha256']==results[-1]['asarSha256']
final=results[-1];assert final['status']=='passed-partial';assert final['source3Reverified'];assert final['requests']==[];assert final['rendererErrors']==[];assert all(v['ownAppCleanupComplete'] for v in results)
manifest=json.loads((app/'case-manifest.json').read_text());assert len(final['cases'])==5
executable=bundle/'Contents/MacOS/WillYou'
raw=subprocess.check_output([str(executable),str(x/'snapshot-fault-db.cjs'),str(app/'userdata/smartdd.db'),'read',str(app/'case-manifest.json')],env={'PATH':'/usr/bin:/bin','ELECTRON_RUN_AS_NODE':'1'},timeout=10);(y/'final-db.json').write_bytes(raw);db=json.loads(raw)
expected={'bad-json':'无法解析','unknown-schema':'格式暂不支持','bad-hash':'摘要不符','cross-project-snapshot':'身份不符','cross-project-task':'身份不符'};rows=[];pids={v['pid'] for v in results}
for c in final['cases']:
 kind=c['kind'];seed=next(v for v in final['fault']['after'] if v['kind']==kind);now=next(v for v in db['cases'] if v['kind']==kind);assert c['visibleErrorReason']==expected[kind]
 for key in ['task','refs','identity','runs']:assert now[key]==seed[key],(kind,key)
 for key in ['snapshot_json','snapshot_hash']:assert now['snapshot'][key]==seed['snapshot'][key]
 assert all(v['state']=='stopped' for v in now['runs']);assert all(v['state']=='released' for v in now['leaseStates']);assert all(v['state']=='exited' for v in now['children']);assert now['grants']==0 and now['invocations']==0
 diag=c['diagnostic'];assert diag['selection']==('unsupported-schema' if kind=='unknown-schema' else 'corrupt');assert diag['currentRun'] is None;assert diag['agentState']=='stopped';assert manifest['canary'] not in json.dumps(diag,ensure_ascii=False)
 assert now['task']['native_session_id'];assert len(now['runs'])==1;assert len(now['refs'])>0
 for child in now['children']:pids.add(child['pid'])
 for suffix in ['resume-refused','diagnostic']:assert (app/(kind+'-'+suffix+'.png')).is_file()
 rows.append({'kind':kind,'taskId':c['taskId'],'nativeSessionId':now['task']['native_session_id'],'runId':now['runs'][0]['run_id'],'referenceCount':len(now['refs']),'visibleErrorReason':expected[kind],'selection':diag['selection'],'actualUIResumeRefused':True,'historyRetained':True,'snapshotBytesAndHashRetained':True,'taskRuntimeIdentityAndReferencesRetained':True,'noReplacementOrNewRun':True,'noApplicationInvocationOrSendGrant':True,'diagnosticRedacted':True,'runStoppedChildrenExitedLeasesReleased':True})
processes=[]
for pid in sorted(pids):
 p=subprocess.run(['ps','-p',str(pid),'-o','pid=,ppid=,etime=,command='],capture_output=True,text=True,timeout=5);processes.append({'pid':pid,'exit':p.returncode,'output':p.stdout.strip(),'stderr':p.stderr.strip()});assert p.returncode==1 and not p.stdout.strip(),(pid,p.stdout)
save('process-audit.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Only recorded own eight host Apps, five CLI and five application bridge PIDs;no signals sent;not a machine-wide absence claim','processes':processes,'allRecordedOwnProcessesAbsent':True})
for v in results:
 log=app/('electron.txt' if v is results[0] else '')
for name in ['electron-continuation-2.txt','electron-continuation-3.txt','electron-continuation-4.txt','electron-continuation-5.txt','electron-continuation-6.txt','electron-continuation-7.txt']:
 assert manifest['canary'] not in (app/name).read_text()
assert 'Tests  149 passed (149)' in (Path('/private/tmp/m10-native-root-z-20261021')/'final-green.txt').read_text();assert json.loads((Path('/private/tmp/m10-native-root-z-20261021')/'process-results.json').read_text())['finalTypesExit']==0
summary={'schema':'m10-t63-settled-ab-audit-v1','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':head,'sourceOverlay':'Z3sourcefiles committed in4a43;all3canonical/private/Gitblobs exact','branch':'feature/0.0.2','os':subprocess.check_output(['sw_vers'],text=True).strip(),'architecture':platform.machine(),'nativeRunner':'codex-cli 0.162.1','nativeRunnerProvider':'private synthetic local Responses;no real model/no external business call/send','case':'T63','declaredLayers':'snapshot parser unit + production service integration','softwareEvidence':'current5files149checks,new4included;notaddedtooverlappingX225','source3CanonicalPrivateAndGitBlobsReverified':True,'productionInputsChanged':False,'packageRebuilt':False,'appPath':str(bundle),'asarSha256':receipt['asarSha256'],'embeddedCommit':None,'embeddedDirty':True,'additionalRealAppGate':'all5actualUI history/resume refusal/diagnostic scenarios completed across same source/package/profile/Task batch','faultBoundary':'one explicit own synthetic SQLite corruption;not an unmodified-environment test;no production/auth code patches','rows':rows,'all5FaultScenariosPassed':True,'allFiveStoppedReleasedAndKnown18ProcessesAbsent':True,'productionRuntimeLogsOmitSyntheticCanary':True,'noUnexpectedModelRequestsDuringFaultContinuations':True,'driverFailuresPreserved':['result-continuation-2:search closing animation not awaited;no product assertion failure','initial continuation3:local socket sandbox EPERM beforeApp launch;retry with approved scope','result-continuation-3:P09 async query content not awaited;correct value later shown;remaining3continued'],'visualCheck':'two light P09 screenshots inspected for distinct unsupported/corrupt error and stopped state only;not fullprototype/light-dark/hover/IME/clipboard/system acceptance','T64':'partial4softwarecasespassed;actualCLI+allotherT64repairscenariosnotexecuted','fullCaseGate':'T63settled6+7all5complete;reopenedT63nowclosed;fullM10=2/72T42T63;earlierprematureYconclusionremainscorrected','goal':'active full M10 R1.6 incl12.21;development incomplete;no release','M9Mutated':False}
save('audit.json',summary);print(json.dumps({'T63':'passed','fullCases':'2/72','ownProcessesAbsent':len(processes),'sourceFilesReverified':3,'asarSha256':receipt['asarSha256'],'productionChanged':False}))
