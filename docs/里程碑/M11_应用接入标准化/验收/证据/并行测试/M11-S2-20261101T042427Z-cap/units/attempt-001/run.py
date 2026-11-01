from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,time

source=Path('/private/tmp/willyou-m11-s2/source-attempt-001')
out=Path('/private/tmp/willyou-m11-s2/evidence/units/attempt-001')
source_manifest=source.parent/'source-manifest-attempt-001.json'
expected='e4c7df701ce2f342e8fcac31e336d5ec4fca724c85431f4625083b2490a3204c'
files=['src/main/core/applications/__tests__/module-registry.test.ts','src/main/core/applications/__tests__/tool-service.test.ts']
private_cache=source.parent/'private-units-cache-attempt-001'

def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(name,value):(out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def check_source(rows):
    return [r['path'] for r in rows if not (source/r['path']).is_file() or (source/r['path']).stat().st_size!=r['bytes'] or sha(source/r['path'])!=r['sha256']]

assert not (out/'result.json').exists(),'Refuse to overwrite evidence'
assert sha(source_manifest)==expected
manifest=json.loads(source_manifest.read_text());before_changes=check_source(manifest['files']);assert not before_changes,before_changes
dependency_paths=json.loads(Path('/private/tmp/willyou-m11-s1a/evidence/diagnostic-registry-fix/attempt-001/inputs-before.json').read_text())['dependencyAndOutputHashes']
dependency_before={name:sha(source/name) for name in dependency_paths}
shared_cache=source/'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json'
cache_before=sha(shared_cache) if shared_cache.is_file() else None
for part in ['tmp','xdg']:(private_cache/part).mkdir(parents=True,exist_ok=True)
env={**os.environ,'XDG_CACHE_HOME':str(private_cache/'xdg'),'TMPDIR':str(private_cache/'tmp')+'/', 'NO_COLOR':'1'}
argv=['pnpm','test',*files,'--maxWorkers=1','--no-file-parallelism','--no-cache','--reporter=verbose','--reporter=json','--outputFile.json='+str(out/'vitest.json')]
started=stamp();begin=time.monotonic();timeout=False;seen=set()
with (out/'test.log').open('wb') as stdout,(out/'stderr.log').open('wb') as stderr:
    process=subprocess.Popen(argv,cwd=source,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
    write('execution.json',{'argv':argv,'cwd':str(source),'pid':process.pid,'processGroup':process.pid,'startedAt':started,'outerSeconds':180,'individualThresholds':'unchanged','privateCache':str(private_cache)})
    print(json.dumps({'event':'started','pid':process.pid,'sourceManifestSha256':expected,'sourceFiles':len(manifest['files'])}),flush=True)
    while process.poll() is None:
        for line in (out/'test.log').read_text(errors='replace').splitlines():
            if re.match(r'^\s*[×✗]',line) and line not in seen:
                seen.add(line);print(json.dumps({'event':'failed-test','line':line.strip()},ensure_ascii=False),flush=True)
        if time.monotonic()-begin>=180:
            timeout=True;os.killpg(process.pid,15)
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:os.killpg(process.pid,9);process.wait()
            break
        time.sleep(.25)
    exit_code=process.wait()
elapsed=round(time.monotonic()-begin,3);finished=stamp()
print(json.dumps({'event':'test-exit','exitCode':exit_code,'timedOut':timeout,'elapsedSeconds':elapsed}),flush=True)
report=json.loads((out/'vitest.json').read_text()) if (out/'vitest.json').is_file() else {}
tests=[{'file':suite['name'],'name':' > '.join(t.get('ancestorTitles',[])+[t['title']]),'status':t['status'],'durationMs':t.get('duration'),'failureMessages':t.get('failureMessages',[])} for suite in report.get('testResults',[]) for t in suite.get('assertionResults',[])]
counts={'files':len(report.get('testResults',[])),'reportedTotal':report.get('numTotalTests'),'observed':len(tests),'passed':sum(t['status']=='passed' for t in tests),'failed':sum(t['status']=='failed' for t in tests),'notExecuted':sum(t['status'] not in ('passed','failed') for t in tests)}
selection_ok=bool(tests) and {Path(s['name']).resolve() for s in report.get('testResults',[])}=={(source/f).resolve() for f in files} and counts['reportedTotal']==len(tests) and len({(t['file'],t['name']) for t in tests})==len(tests) and counts['notExecuted']==0
source_changes=check_source(manifest['files']);dependency_after={name:sha(source/name) if (source/name).is_file() else None for name in dependency_before};dependency_changes=[name for name in dependency_before if dependency_after[name]!=dependency_before[name]]
cache_after=sha(shared_cache) if shared_cache.is_file() else None
integrity=not source_changes and not dependency_changes and cache_before==cache_after and sha(source_manifest)==expected
try:os.killpg(process.pid,0);alive=True
except ProcessLookupError:alive=False
except PermissionError:alive='unknown-permission'
write('cleanup.json',{'at':stamp(),'ownProcessGroup':process.pid,'stillExists':alive,'allOwnProcessesStopped':alive is False,'resourceLease':'released' if alive is False else 'held-needs-review','privateCache':str(private_cache),'privateCacheRetainedForDiagnosis':True,'noGUIOrRealAgent':True,'noDependencyOrOutputBuild':True,'noSourceOrPublicLedgerEdits':True,'integrityPassed':integrity})
passed=exit_code==0 and not timeout and selection_ok and counts['failed']==0 and integrity and alive is False
write('result.json',{'schema':'willyou-test-result-v1','batch':'M11-S2-U','attempt':1,'status':'passed' if passed else 'failed-needs-classification','baseCommit':manifest.get('baseCommit'),'source':str(source),'sourceManifestSha256':expected,'sourceFiles':len(manifest['files']),'argv':argv,'startedAt':started,'finishedAt':finished,'elapsedSeconds':elapsed,'exitCode':exit_code,'timedOut':timeout,'individualThresholds':'unchanged','outerSeconds':180,'counts':counts,'fullAssignedFilesVerified':selection_ok,'tests':tests,'sourceChanges':source_changes,'dependencyHashesBefore':dependency_before,'dependencyHashesAfter':dependency_after,'dependencyChanges':dependency_changes,'sharedCacheHashBefore':cache_before,'sharedCacheHashAfter':cache_after,'integrityPassed':integrity,'resourceLeaseReleased':alive is False,'formal38CasePassesAdded':0,'scope':'Software checks only; no formal M11 acceptance case closed','cleanup':'cleanup.json'})
rows=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json']
write('manifest.json',{'schema':'willyou-evidence-manifest-v1','batch':'M11-S2-U','attempt':1,'files':rows})
print(json.dumps({'event':'sealed','status':'passed' if passed else 'failed-needs-classification','counts':counts,'integrityPassed':integrity,'ownProcessGroupStillExists':alive,'manifestSha256':sha(out/'manifest.json')},ensure_ascii=False),flush=True)
