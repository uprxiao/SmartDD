from pathlib import Path
import datetime,hashlib,json,os,subprocess
e=Path('/private/tmp/m10-real-cli-af-20261021');r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');p=Path('/private/tmp/willyou-m10-cli-af-4EmlVF/result-claude-parser.json');d=json.loads(p.read_text());assert d['status']=='passed-partial'
def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip();assert head==d['commit'];assert subprocess.check_output(['git','branch','--show-current'],cwd=r,text=True).strip()=='feature/0.0.2'
s=json.loads(Path('/private/tmp/m10-fixed-native-ae-20261021/source.json').read_text())
for row in s['files']:
 assert sha(r/row['path'])==row['sha256'];assert sha(w/row['path'])==row['sha256'];assert hashlib.sha256(subprocess.check_output(['git','show','HEAD:'+row['path']],cwd=r)).hexdigest()==row['sha256']
frozen=json.loads(Path('/private/tmp/m10-fixed-native-ae-20261021/build-input-snapshot.json').read_text());assert len(frozen['files'])==1967
for row in frozen['files']:assert sha(w/row['path'])==row['sha256'],row['path']
assert sha(Path(d['app'])/'Contents/Resources/app.asar')==d['asarSha256']
before=d['beforeFault'];final=d['final'];current=json.loads(subprocess.check_output([str(Path(d['app'])/'Contents/MacOS/WillYou'),str(e/'db-read.cjs'),str(Path(d['userData'])/'smartdd.db'),d['taskId']],env={'PATH':'/usr/bin:/bin','ELECTRON_RUN_AS_NODE':'1'},text=True));assert current==final
for field in ['snapshot','identity','refs','packages','defaults','proofs']:assert final[field]==before[field],field
for field in ['id','project_id','native_session_id','state_root','cwd']:assert final['task'][field]==before['task'][field]
assert len(final['runs'])==3 and len({x['run_id'] for x in final['runs']})==3 and all(x['state']=='stopped' and x['snapshot_hash']==before['snapshot']['snapshot_hash'] for x in final['runs']);assert all(x['state'] in ['exited','canceled'] for x in final['children']);assert all(x['state']=='released' for x in final['leases'])
assert len(final['invocation'])==1;call=final['invocation'][0];assert call['package_hash']==d['originalPackageHash'] and call['task_id']==d['taskId'] and call['project_id']==d['projectId'] and call['tool_name']=='smartdd_mail_draft_list_v1' and call['state']=='succeeded' and call['semantics']=='read' and call['effect_state']=='read-only';assert final['grantCount']==0
assert len(d['nativeHistory'])==3 and len({x['file'] for x in d['nativeHistory']})==1
pids=sorted({x['pid'] for x in d['rounds']}|{x['pid'] for x in final['children'] if x['pid']});absent=[]
for pid in pids:
 try:os.kill(pid,0);raise AssertionError('Known own PID still exists: '+str(pid))
 except ProcessLookupError:absent.append(pid)
result={'schema':'m10-real-cli-af-claude-audit-v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commit':head,'sourceNineCanonicalPrivateGitMatch':True,'frozenPrivateInputsUnchanged':len(frozen['files']),'asarSha256':d['asarSha256'],'app':d['app'],'result':str(p),'case':'T64 partial','layer':'I/CLI;trusted packaged-host IPC,owned PTY,real installed Claude2.1.303 and synthetic Anthropic;explicit dontAsk native prompt handled with same-version xterm parser,no UI acceptance','originalNativeSessionId':before['task']['native_session_id'],'originalSnapshotHash':before['snapshot']['snapshot_hash'],'sameOriginalNativeHistoryFile':d['nativeHistory'][0]['file'],'sameOriginalPackageHash':d['originalPackageHash'],'threeDistinctStoppedRuns':True,'allRecordedChildrenExitedAndLeasesReleased':True,'oneActualFixedHashLocalRead':True,'noSendingGrant':True,'knownOwnPidsAbsent':absent,'noProductionOrPackageChanges':True,'noModelOrExternalBusinessOrSend':True,'trustedDistributionStayedPresent':'not a no-trusted-copy scenario','M9Mutated':False,'fullCases':'2/72;T42T63;T64notcomplete;path/no-copy/partialdamage/otherconditionsremain','goal':'active full M10;not released'};(e/'audit-claude.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
