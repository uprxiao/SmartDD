from pathlib import Path
import json,hashlib,subprocess,datetime
r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-native-guard-az-20261022');base='3e674f6e8e5b6a98405d41b441c7758461af2b5c';sha=lambda b:hashlib.sha256(b).hexdigest();old={f['path']:f['sha256'] for f in json.loads((e/'parent-inputs.json').read_text())['files']};paths=list(old)+['src/main/core/applications/native-static-roots.ts','src/main/core/applications/__tests__/native-static-roots.test.ts'];files=[];changes=[];diff=[]
for path in paths:
 raw=(w/path).read_bytes();h=sha(raw);files.append({'path':path,'bytes':len(raw),'sha256':h})
 if old.get(path)==h:continue
 result=subprocess.run(['git','show',base+':'+path],cwd=r,capture_output=True);bh=sha(result.stdout) if result.returncode==0 else None
 if bh is None:assert not (r/path).exists(),('unexpected canonical new file',path)
 else:assert sha((r/path).read_bytes())==bh,('canonical changed',path)
 changes.append({'path':path,'bytes':len(raw),'sha256':h,'priorSha256':bh});p=e/'frozen-source'/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
 cmd=['git','diff','--no-index','--','/dev/null' if bh is None else str(r/path),str(w/path)];d=subprocess.run(cmd,capture_output=True,text=True)
 assert d.returncode==1,(path,d.returncode,d.stderr)
 diff.append(d.stdout.replace('a'+str(r/path),'a/'+path).replace('b'+str(w/path),'b/'+path).replace('a/dev/null','a/'+path))
assert len(changes)==9 and len(files)==2008,(len(changes),len(files))
(e/'source.json').write_text(json.dumps({'baseCommit':base,'files':changes,'inheritedMirrorInputs':'same5 prototypes as AY,unchanged and not copied'},indent=2)+'\n');(e/'source.diff').write_text(''.join(diff));(e/'build-input-snapshot.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':files},indent=2)+'\n')
env=json.loads(Path('/private/tmp/m10-native-conflicts-ay-20261022/environment.json').read_text())
for f in env['nativeInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256'],f['path']
env.update({'sourceBase':base,'sourceFiles':9,'productionFiles':5,'testFilesIncludingPublisherFixture':4,'sourceInputs':2008,'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'testBoundary':'isolated TaskService/fake owned CLI and bridge,actual publisher child SIGKILL and C/H kernel coordination;no actual Agent/App','nativeGuardStaticSources':'metadata-only retention until full H verification after lease;business always denied'});(e/'environment.json').write_text(json.dumps(env,ensure_ascii=False,indent=2)+'\n')
pre=json.loads(Path('/private/tmp/m10-native-conflicts-ay-20261022/preexisting-worktree.json').read_text())
for f in pre:assert sha((r/f['path']).read_bytes())==f['sha256'],f['path']
(e/'preexisting-worktree.json').write_text(json.dumps(pre,ensure_ascii=False,indent=2)+'\n')
requested=['native-static-roots','run-registry','application-run-scope','discovery-catalog','claude-delivery','claude-delivery-process','package-registry','resource-publication-recovery','legacy-session-migration','session-diagnostics','application-run-policy']
for name in requested:assert (w/'src/main/core/applications/__tests__'/(name+'.test.ts')).exists(),('requested test missing',name)
s=json.loads((e/'current-state.json').read_text());s.update({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceFiles':9,'sourceInputs':2008,'primaryGreen4':{'passed':9,'failed':0,'filteredNotExecuted':122},'typecheck5Exit':0,'liveSessions':{'mainRegression':37949,'related2':73518,'typesFinal':'terminal0'},'next':'Frozen9 sources;wait exact2 test handles;verify all results and inputs;review then scoped archive/commit;full M10 stage5 active.'});(e/'current-state.json').write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n');Path('/private/tmp/m10-current-handoff-20261022.json').write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n');print({'frozenSources':9,'inputs':2008,'preexistingDocsPreserved':4,'all11RequestedFilesExist':True})
