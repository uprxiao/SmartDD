from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,time

source=Path('/private/tmp/willyou-m11-s2a/source-attempt-001')
out=Path('/private/tmp/willyou-m11-s2a/evidence/units/attempt-001')
manifest_path=source.parent/'source-manifest-attempt-001.json'
expected='775b17b64b977957c29e33dd2431b619e44e1e73cead03653ecfae7583c35601'
names=['run-plan','session-registry','run-registry']
cache=source.parent/'private-units-cache-attempt-001'
config=out/'vitest.private.config.mjs'

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(name,value):(out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def source_changes(rows):
    return [r['path'] for r in rows if not (source/r['path']).is_file() or (source/r['path']).stat().st_size!=r['bytes'] or sha(source/r['path'])!=r['sha256']]
def still_exists(pgid):
    try:os.killpg(pgid,0);return True
    except ProcessLookupError:return False
    except PermissionError:return 'unknown-permission'

assert not (out/'result.json').exists(),'Do not overwrite prior execution'
assert sha(manifest_path)==expected
manifest=json.loads(manifest_path.read_text());assert len(manifest['files'])==4789
changes_before=source_changes(manifest['files']);assert not changes_before,changes_before
previous=Path('/private/tmp/willyou-m11-s2/evidence/units/attempt-001/result.json')
dependency_paths=json.loads(previous.read_text())['dependencyHashesAfter']
dependencies_before={n:sha(source/n) for n in dependency_paths}
shared_cache=source/'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json'
cache_before=sha(shared_cache) if shared_cache.is_file() else None
for n in ['tmp','xdg','vite']:(cache/n).mkdir(parents=True,exist_ok=True)
env={**os.environ,'XDG_CACHE_HOME':str(cache/'xdg'),'TMPDIR':str(cache/'tmp')+'/','NO_COLOR':'1'}
started=stamp();executions=[];all_tests=[]
for name in names:
    file='src/main/core/applications/__tests__/'+name+'.test.ts'
    argv=['pnpm','test',file,'--config',str(config),'--maxWorkers=1','--no-file-parallelism','--no-cache','--reporter=verbose','--reporter=json','--outputFile.json='+str(out/(name+'.vitest.json'))]
    begin=time.monotonic();timeout=False;seen=set();command_started=stamp()
    log=out/(name+'.log')
    with log.open('wb') as stdout,(out/(name+'.stderr.log')).open('wb') as stderr:
        process=subprocess.Popen(argv,cwd=source,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
        initial={'file':file,'argv':argv,'cwd':str(source),'pid':process.pid,'processGroup':process.pid,'startedAt':command_started,'outerSeconds':180,'individualThresholds':'unchanged'}
        write(name+'.execution.json',initial)
        print(json.dumps({'event':'started','file':name,'pid':process.pid}),flush=True)
        while process.poll() is None:
            for line in log.read_text(errors='replace').splitlines():
                if re.match(r'^\s*[×✗]',line) and line not in seen:
                    seen.add(line);print(json.dumps({'event':'failed-test','file':name,'line':line.strip()},ensure_ascii=False),flush=True)
            if time.monotonic()-begin>=180:
                timeout=True;os.killpg(process.pid,15)
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:os.killpg(process.pid,9);process.wait()
                break
            time.sleep(.25)
        code=process.wait()
    report_path=out/(name+'.vitest.json')
    report=json.loads(report_path.read_text()) if report_path.is_file() else {}
    tests=[{'file':s['name'],'name':' > '.join(t.get('ancestorTitles',[])+[t['title']]),'status':t['status'],'durationMs':t.get('duration'),'failureMessages':t.get('failureMessages',[])} for s in report.get('testResults',[]) for t in s.get('assertionResults',[])]
    counts={'files':len(report.get('testResults',[])),'reportedTotal':report.get('numTotalTests'),'observed':len(tests),'passed':sum(t['status']=='passed' for t in tests),'failed':sum(t['status']=='failed' for t in tests),'notExecuted':sum(t['status'] not in ('passed','failed') for t in tests)}
    selection_ok=bool(tests) and {Path(s['name']).resolve() for s in report.get('testResults',[])}=={(source/file).resolve()} and counts['reportedTotal']==len(tests) and len({t['name'] for t in tests})==len(tests) and counts['notExecuted']==0
    alive=still_exists(process.pid)
    result={**initial,'exitCode':code,'timedOut':timeout,'elapsedSeconds':round(time.monotonic()-begin,3),'finishedAt':stamp(),'counts':counts,'fullAssignedFileVerified':selection_ok,'ownProcessGroupStillExists':alive,'failures':[t for t in tests if t['status']=='failed']}
    write(name+'.execution.json',result);executions.append(result);all_tests.extend(tests)
    print(json.dumps({'event':'file-finished','file':name,'exitCode':code,'timedOut':timeout,'counts':counts,'elapsedSeconds':result['elapsedSeconds'],'ownProcessGroupStillExists':alive,'failures':result['failures']},ensure_ascii=False),flush=True)

changes_after=source_changes(manifest['files'])
dependencies_after={n:sha(source/n) if (source/n).is_file() else None for n in dependencies_before}
dependency_changes=[n for n in dependencies_before if dependencies_before[n]!=dependencies_after[n]]
cache_after=sha(shared_cache) if shared_cache.is_file() else None
integrity=not changes_after and not dependency_changes and cache_before==cache_after and sha(manifest_path)==expected
processes=[{'file':r['file'],'processGroup':r['processGroup'],'stillExists':still_exists(r['processGroup'])} for r in executions]
stopped=all(r['stillExists'] is False for r in processes)
counts={'files':len(executions),'observed':len(all_tests),'passed':sum(t['status']=='passed' for t in all_tests),'failed':sum(t['status']=='failed' for t in all_tests),'notExecuted':sum(t['status'] not in ('passed','failed') for t in all_tests)}
passed=all(r['exitCode']==0 and not r['timedOut'] and r['fullAssignedFileVerified'] for r in executions) and counts['failed']==0 and integrity and stopped
write('cleanup.json',{'at':stamp(),'ownProcessGroups':processes,'allOwnProcessesStopped':stopped,'resourceLease':'released' if stopped else 'held-needs-review','privateCache':str(cache),'privateVitestConfig':str(config),'noGUIOrRealAgent':True,'noDependencyOrSharedOutputBuild':True,'noSourceOrPublicLedgerEdits':True,'integrityPassed':integrity})
write('result.json',{'schema':'willyou-test-result-v1','batch':'M11-S2a-U','attempt':1,'status':'passed' if passed else 'failed-needs-classification','baseCommit':manifest.get('baseCommit'),'source':str(source),'sourceManifestSha256':expected,'sourceFileCount':len(manifest['files']),'startedAt':started,'finishedAt':stamp(),'summedTestCommandElapsedSeconds':round(sum(r['elapsedSeconds'] for r in executions),3),'executions':executions,'counts':counts,'tests':all_tests,'sourceChanges':changes_after,'dependencyHashesBefore':dependencies_before,'dependencyHashesAfter':dependencies_after,'dependencyChanges':dependency_changes,'sharedCacheHashBefore':cache_before,'sharedCacheHashAfter':cache_after,'privateVitestConfigSha256':sha(config),'privateConfigBoundary':'Imports the original config unchanged except private Vite cacheDir; default individual thresholds are unmodified','integrityPassed':integrity,'allOwnProcessesStopped':stopped,'resourceLeaseReleased':stopped,'formalM11CasePassesAdded':0,'scope':'Software checks only; formal M11 acceptance not closed','cleanup':'cleanup.json'})
rows=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json']
write('manifest.json',{'schema':'willyou-evidence-manifest-v1','batch':'M11-S2a-U','attempt':1,'files':rows})
print(json.dumps({'event':'sealed','status':'passed' if passed else 'failed-needs-classification','counts':counts,'integrityPassed':integrity,'allOwnProcessesStopped':stopped,'manifestSha256':sha(out/'manifest.json')},ensure_ascii=False),flush=True)
