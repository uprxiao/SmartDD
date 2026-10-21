from pathlib import Path
import datetime,hashlib,json,os,subprocess
e=Path('/private/tmp/m10-resource-fault-ag-20261021');r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');clone=Path('/private/tmp/m10-resource-fault-ag-package-20261021/WillYou.app');accepted=Path('/private/tmp/m10-fixed-native-ae-package-20261021/mac-arm64/WillYou.app')
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def tree(root):
 rows=[]
 for p in root.rglob('*'):
  assert not p.is_symlink()
  if p.is_file():rows.append({'path':str(p.relative_to(root)),'mode':p.stat().st_mode&0o777,'sha256':sha(p)})
 return sorted(rows,key=lambda x:x['path'])
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip();assert head=='458d6cca78d42d3cb326fa603a6d085a478264c7'
source=json.loads(Path('/private/tmp/m10-fixed-native-ae-20261021/source.json').read_text())
for f in source['files']:
 for root in [r,w]:assert sha(root/f['path'])==f['sha256']
 assert hashlib.sha256(subprocess.check_output(['git','show','HEAD:'+f['path']],cwd=r)).hexdigest()==f['sha256']
frozen=json.loads(Path('/private/tmp/m10-fixed-native-ae-20261021/build-input-snapshot.json').read_text());assert len(frozen['files'])==1967
for f in frozen['files']:assert sha(w/f['path'])==f['sha256'],f['path']
receipt=json.loads(Path('/private/tmp/m10-fixed-native-ae-20261021/package-verification.json').read_text())
for root in [accepted,clone]:
 assert sha(root/'Contents/Resources/app.asar')==receipt['asarSha256']
 for f in receipt['capabilityFiles']:assert sha(root/'Contents/Resources/capability-bundles'/f['path'])==f['sha256']
rows=[];pids=set()
for scenario,runner,handle in [('source-unavailable','codex','source-unavailable-codex-result-path.txt'),('occupied-path','codex','occupied-path-codex-result-path.txt'),('source-unavailable','claude','source-unavailable-claude-result-path.txt'),('occupied-path','claude','occupied-path-claude-continuation-result-path.txt')]:
 path=Path((e/handle).read_text().strip());d=json.loads(path.read_text());assert d['status']=='passed-partial' and d['scenario']==scenario
 def read(task):return json.loads(subprocess.check_output([str(clone/'Contents/MacOS/WillYou'),str(e/'db-read.cjs'),str(Path(d['userData'])/'smartdd.db'),task],env={'PATH':'/usr/bin:/bin','ELECTRON_RUN_AS_NODE':'1'},text=True))
 current=read(d['taskId']);assert current==d['final'];independent=read(d['independentTask']['id']);assert independent==d['independentDb']
 before=d['beforeFault']
 for field in ['snapshot','identity','refs','packages','defaults','proofs']:assert current[field]==before[field],(scenario,runner,field)
 for field in ['id','project_id','native_session_id','state_root','cwd']:assert current['task'][field]==before['task'][field]
 assert current['task']['native_session_id']!=independent['task']['native_session_id'];assert d['unavailableSupport']['state']=='partial';assert d['unavailable']['currentRun']['restriction']['reason']=='fixed_application_resources_unavailable';assert d['unavailable']['currentRun']['bridge']['connected']==False
 for state in [current,independent]:
  assert all(x['state']=='stopped' for x in state['runs']);assert all(x['state'] in ['exited','canceled'] for x in state['children']);assert all(x['state']=='released' for x in state['leases']);assert state['grantCount']==0
  pids.update(x['pid'] for x in state['children'] if x['pid'])
 pids.update(x['pid'] for x in d['rounds'])
 target=Path(d['fault']['target']);metadata=current['resources'];pack=next(x for x in current['packages'] if x['package_hash']==d['originalPackageHash'])
 if scenario=='source-unavailable':
  assert tree(target)==d['originalTree'];assert d['sourceFault']['restoredAt'];assert tree(Path(d['sourceFault']['path']))==d['sourceFault']['files'];assert len(current['restoration'])==1 and current['restoration'][0]['state']=='committed';assert len(current['invocation'])==1;call=current['invocation'][0];assert call['package_hash']==d['originalPackageHash'] and call['tool_name']=='smartdd_mail_draft_list_v1' and call['state']=='succeeded' and call['effect_state']=='read-only';assert next(x for x in metadata if x['resource_id']==pack['resource_id'])['generation']==next(x for x in before['resources'] if x['resource_id']==pack['resource_id'])['generation']+1
 else:
  assert tree(target)==d['userTree'];assert (target/'user.txt').read_text()==d['marker']+'_OWN_USER_CONTENT_KEEP';assert len(current['restoration'])==0 and len(current['invocation'])==0;assert next(x for x in metadata if x['resource_id']==pack['resource_id'])['generation']==next(x for x in before['resources'] if x['resource_id']==pack['resource_id'])['generation']
  if runner=='claude':
   old=json.loads((path.parent/'result-occupied-path-claude.json').read_text());assert old['status']=='failed';pids.update(x['pid'] for x in old['rounds']);assert d['nativePromptAck']['modalAbsent'];assert d['fault']['reusedSameFault']
 rows.append({'scenario':scenario,'runner':runner,'version':d['cliVersion'],'result':str(path),'root':d['root'],'taskId':d['taskId'],'nativeId':current['task']['native_session_id'],'snapshotHash':current['snapshot']['snapshot_hash'],'originalPackageHash':d['originalPackageHash'],'independentTaskId':d['independentTask']['id'],'independentNativeId':independent['task']['native_session_id'],'observedOriginalRuns':len(current['runs']),'independentRuns':len(independent['runs']),'actualLocalReads':len(current['invocation']),'noSendGrant':True,'originalMetadataAndHistoryRetained':True,'allRecordedRunsStoppedChildrenExitedLeasesReleased':True,'sourceRestoredOrUserContentKept':True})
for pid in pids:
 try:os.kill(pid,0);raise AssertionError('Known own PID exists: '+str(pid))
 except ProcessLookupError:pass
out={'schema':'m10-resource-fault-ag-audit-v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':head,'productionSourceCommit':'7a06058fd4435a21cf5191b5ff9a66a7abc07c84','case':'T64 partial','layer':'I/CLI real installed clients through private App clone;explicit source faults and synthetic providers;not GUI orrealmodelSkillproof','rows':rows,'fourScenarioGroupsPassed':True,'observedRunsIncludingOnePreservedFailedNativePromptAttempt':sum(x['observedOriginalRuns']+x['independentRuns'] for x in rows),'allKnownOwnPidsAbsent':sorted(pids),'source9CanonicalPrivateGitMatch':True,'frozenPrivate1967Unchanged':True,'acceptedAndCloneAsarSha256':receipt['asarSha256'],'bothCapabilityTrees65Reverified':True,'acceptedAppMutated':False,'cloneSourcesRestored':True,'noConfiguredTrustedSourceBoundary':'Configured source unavailable in this private clone;quarantine is outside host source list;not a claim all identical bytes everywhere were destroyed','oldAFUnknownBridge':'leftunchanged in otherfailedroot;not released orcountedaspassed','fullCaseGate':'2/72;T42T63;T64native-root andfullconditionsremain','M9Mutated':False,'released':False,'goal':'active fullscope'};(e/'audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'fourScenarioGroupsPassed':True,'observedRuns':out['observedRunsIncludingOnePreservedFailedNativePromptAttempt'],'knownPidsAbsent':len(pids),'sourceUnchanged':True,'packageSourceBothRestored':True,'fullCases':'2/72'}))
