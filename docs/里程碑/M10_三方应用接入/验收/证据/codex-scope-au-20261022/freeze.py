from pathlib import Path
import hashlib,json,subprocess,difflib,datetime
r=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-codex-scope-au-20261022');base='ecfcf1137828ce073e86c7706e921a845245d077';sha=lambda b:hashlib.sha256(b).hexdigest();at=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=r).decode().strip()==base
paths=json.loads((e/'baseline.json').read_text())['files']+['src/main/core/applications/session-registry.ts','src/main/core/applications/session-diagnostics.ts','src/main/core/applications/__tests__/codex-application-scope.test.ts','src/main/core/applications/__tests__/task-capability-launcher.test.ts']
records=[];diff=[]
for p in paths:
 raw=(w/p).read_bytes();oldrun=subprocess.run(['git','show',base+':'+p],cwd=r,stdout=subprocess.PIPE,stderr=subprocess.PIPE);old=oldrun.stdout if oldrun.returncode==0 else None;assert raw!=old,p;records.append({'path':p,'bytes':len(raw),'sha256':sha(raw),'priorSha256':sha(old) if old else None});diff.extend(difflib.unified_diff(old.decode().splitlines(True) if old else [],raw.decode().splitlines(True),fromfile='a/'+p if old else '/dev/null',tofile='b/'+p));target=e/'source'/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
(e/'source.json').write_text(json.dumps({'baseCommit':base,'files':records},indent=2)+'\n');(e/'source.diff').write_text(''.join(diff))
manifest=json.loads(Path('/private/tmp/m10-app-isolation-at-20261022/build-input-snapshot-foundation.json').read_text());mapped={f['path']:f for f in manifest['files']}
for p,f in mapped.items():
 if p not in paths:assert sha((w/p).read_bytes())==f['sha256'],p
for f in records:mapped[f['path']]={k:v for k,v in f.items() if k in ['path','bytes','sha256']}
manifest.update(recordedAt=at(),baseCommit=base,overlays=paths,files=[mapped[p] for p in sorted(mapped)]);assert len(mapped)==1997;(e/'build-input-snapshot.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
env=json.loads(Path('/private/tmp/m10-app-isolation-at-20261022/environment-foundation.json').read_text());env.update(recordedAt=at(),sourceBase=base,sourceFiles=len(paths),sourceInputs=len(mapped),actualAgentRun=False,scope='phase5 Codex application resource scope wired into real TaskService;Claude partial delivery remains known red');(e/'environment.json').write_text(json.dumps(env,indent=2)+'\n')
commands=json.loads(Path('/private/tmp/m10-app-isolation-at-20261022/command-files-foundation.json').read_text())+['src/main/core/applications/__tests__/'+n for n in ['codex-application-scope.test.ts','agent-adapters.test.ts','session-projector.test.ts']];(e/'command-files.json').write_text(json.dumps(commands,indent=2)+'\n')
cmd=['pnpm','test',*commands,'--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(e/'regression-report.json')]
with(e/'regression.txt').open('w') as out:p=subprocess.run(cmd,cwd=w,stdout=out,stderr=subprocess.STDOUT)
for f in manifest['files']:assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
for f in env['nativeInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256'],f['path']
j=json.loads((e/'regression-report.json').read_text());failed=[{'file':Path(test['name']).relative_to(w).as_posix(),'name':t['fullName'],'message':t['failureMessages']} for test in j['testResults'] for t in test['assertionResults'] if t['status']=='failed']
result={'at':at(),'exitCode':p.returncode,'passed':j['numPassedTests'],'failed':j['numFailedTests'],'pending':j['numPendingTests'],'files':len(j['testResults']),'sourceFrozen':True,'sourceInputs':len(mapped),'command':cmd,'failures':failed,'expectedKnownClaudeRed':len(failed)==1 and 'keeps healthy Mail draft calls available in a new claude-code' in failed[0]['name'],'goal':'active full M10;phase5;not complete'};(e/'regression-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['command','failures']},ensure_ascii=False));print((e/'regression.txt').read_text()[-1600:]);raise SystemExit(p.returncode)
