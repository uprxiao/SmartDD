from pathlib import Path
import json,hashlib,subprocess,datetime,platform
r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');x=Path('/private/tmp/m10-snapshot-cases-x-20261021');y=Path('/private/tmp/m10-t63-app-y-20261021');app=Path('/private/tmp/willyou-m10-snapshots-x-8WvIfw')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=r)
def save(name,data):(y/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
assert git('branch','--show-current').decode().strip()=='feature/0.0.2';head=git('rev-parse','HEAD').decode().strip();assert head=='9540af8d44c5260f33441a1c9449c886362cbd15'
source=json.loads((x/'source.json').read_text())
for f in source['files']:
 assert digest(r/f['path'])==f['sha256'];assert hashlib.sha256(git('show','HEAD:'+f['path'])).hexdigest()==f['sha256']
receipt=json.loads((x/'package-verification.json').read_text());bundle=Path('/private/tmp/m10-snapshot-cases-x-package-20261021/mac-arm64/WillYou.app');assert digest(bundle/'Contents/Resources/app.asar')==receipt['asarSha256']
results=[json.loads((app/name).read_text()) for name in ['result.json','result-continuation.json','result-continuation-2.json','result-continuation-3.json','result-continuation-4.json']]
final=results[-1];assert final['status']=='passed-partial';assert final['source8Reverified'];assert final['requests']==[];assert final['rendererErrors']==[];assert all(v['ownAppCleanupComplete'] for v in results)
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
save('process-audit.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Only recorded own five host Apps, five CLI and five application bridge PIDs;no signals sent;not a machine-wide absence claim','processes':processes,'allRecordedOwnProcessesAbsent':True})
for v in results:
 log=app/('electron.txt' if v is results[0] else '')
for name in ['electron-continuation-2.txt','electron-continuation-3.txt','electron-continuation-4.txt']:
 assert manifest['canary'] not in (app/name).read_text()
software=json.loads((x/'execution-summary.json').read_text())['software'];assert software['passed']==225 and software['files']==10
summary={'schema':'m10-t63-app-y-audit-v1','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':head,'branch':'feature/0.0.2','os':subprocess.check_output(['sw_vers'],text=True).strip(),'architecture':platform.machine(),'nativeRunner':'codex-cli 0.162.1','nativeRunnerProvider':'private synthetic local Responses;no real model/no external business call/send','case':'T63','declaredLayers':'snapshot parser unit + production service integration','softwareEvidence':'../snapshot-cases-x-20261021;225related checks reused,not added or rerun','source8CanonicalAndCommitBlobsReverified':True,'productionInputsChanged':False,'packageRebuilt':False,'appPath':str(bundle),'asarSha256':receipt['asarSha256'],'embeddedCommit':None,'embeddedDirty':True,'additionalRealAppGate':'all5actualUI history/resume refusal/diagnostic scenarios completed across same source/package/profile/Task batch','faultBoundary':'one explicit own synthetic SQLite corruption;not an unmodified-environment test;no production/auth code patches','rows':rows,'all5FaultScenariosPassed':True,'allFiveStoppedReleasedAndKnown15ProcessesAbsent':True,'productionRuntimeLogsOmitSyntheticCanary':True,'noUnexpectedModelRequestsDuringFaultContinuations':True,'driverFailuresPreserved':['result-continuation-2:search closing animation not awaited;no product assertion failure','initial continuation3:local socket sandbox EPERM beforeApp launch;retry with approved scope','result-continuation-3:P09 async query content not awaited;correct value later shown;remaining3continued'],'visualCheck':'two light P09 screenshots inspected for distinct unsupported/corrupt error and stopped state only;not fullprototype/light-dark/hover/IME/clipboard/system acceptance','fullCaseGate':'T63passed;fullM10=2/72(T42,T63);originalscope unchanged','goal':'active full M10 R1.6 incl12.21;development incomplete;no release','M9Mutated':False}
save('audit.json',summary);print(json.dumps({'T63':'passed','fullCases':'2/72','ownProcessesAbsent':len(processes),'sourceFilesReverified':8,'asarSha256':receipt['asarSha256'],'productionChanged':False}))
