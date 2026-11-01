from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,time

source=Path('/private/tmp/willyou-m11-s3/source-attempt-001')
out=source.parent/'evidence/units/attempt-001'
manifest_path=source.parent/'source-manifest-attempt-001.json'
expected='1230ec9206f72a796a3eee999d9082baa4f9157be95ee6de8a0d315c9e11c074'
groups=[
    {'id':'business-r14','files':['src/main/core/applications/__tests__/business-data.test.ts'],'pattern':'M11 R14','anticipatedSelected':6},
    {'id':'migrations','files':['src/main/db/mail-sender-identity-migration.test.ts','src/main/db/migrations.test.ts','src/main/db/registered-host-migration.test.ts']},
    {'id':'sender-identity','files':['src/renderer/features/applications/sender-identity.test.tsx'],'anticipatedSelected':9},
]
config=out/'vitest.private.config.mjs';cache=source.parent/'private-units-cache-attempt-001'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def source_changes(rows):
    return [r['path'] for r in rows if not (source/r['path']).is_file() or (source/r['path']).stat().st_size!=r['bytes'] or sha(source/r['path'])!=r['sha256']]
def alive(pgid):
    try:os.killpg(pgid,0);return True
    except ProcessLookupError:return False
    except PermissionError:return 'unknown-permission'

assert not (out/'result.json').exists(),'Refuse to overwrite'
assert sha(manifest_path)==expected
manifest=json.loads(manifest_path.read_text());assert len(manifest['files'])==4796
before_changes=source_changes(manifest['files']);assert not before_changes,before_changes
old=Path('/private/tmp/willyou-m11-s2a/evidence/units/attempt-001/result.json')
dependencies_before={n:sha(source/n) for n in json.loads(old.read_text())['dependencyHashesAfter']}
shared_cache=source/'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json'
cache_before=sha(shared_cache) if shared_cache.is_file() else None
for part in ['tmp','xdg','vite']:(cache/part).mkdir(parents=True,exist_ok=True)
env={**os.environ,'XDG_CACHE_HOME':str(cache/'xdg'),'TMPDIR':str(cache/'tmp')+'/','NO_COLOR':'1'}
started=stamp();executions=[];rows=[]
for group in groups:
    name=group['id'];files=group['files'];pattern=group.get('pattern')
    argv=['pnpm','test',*files,'--config',str(config),'--maxWorkers=1','--no-file-parallelism','--no-cache','--reporter=verbose','--reporter=json','--outputFile.json='+str(out/(name+'.vitest.json'))]
    if pattern:argv.extend(['-t',pattern])
    begin=time.monotonic();timed_out=False;seen=set();log=out/(name+'.log')
    with log.open('wb') as stdout,(out/(name+'.stderr.log')).open('wb') as stderr:
        process=subprocess.Popen(argv,cwd=source,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
        initial={'id':name,'files':files,'pattern':pattern,'argv':argv,'cwd':str(source),'pid':process.pid,'processGroup':process.pid,'startedAt':stamp(),'outerSeconds':180,'individualThresholds':'unchanged'}
        write(name+'.execution.json',initial)
        print(json.dumps({'event':'started','group':name,'pid':process.pid}),flush=True)
        while process.poll() is None:
            for line in log.read_text(errors='replace').splitlines():
                if re.match(r'^\s*[×✗]',line) and line not in seen:
                    seen.add(line);print(json.dumps({'event':'failed-test','group':name,'line':line.strip()},ensure_ascii=False),flush=True)
            if time.monotonic()-begin>=180:
                timed_out=True;os.killpg(process.pid,15)
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:os.killpg(process.pid,9);process.wait()
                break
            time.sleep(.25)
        code=process.wait()
    path=out/(name+'.vitest.json');report=json.loads(path.read_text()) if path.is_file() else {}
    tests=[]
    for suite in report.get('testResults',[]):
        for t in suite.get('assertionResults',[]):
            full=' > '.join(t.get('ancestorTitles',[])+[t['title']])
            tests.append({'group':name,'file':suite['name'],'name':full,'selected':not pattern or re.search(pattern,full) is not None,'status':t['status'],'durationMs':t.get('duration'),'failureMessages':t.get('failureMessages',[])})
    selected=[t for t in tests if t['selected']];outside=[t for t in tests if not t['selected']]
    counts={'files':len(report.get('testResults',[])),'reportedTotal':report.get('numTotalTests'),'selected':len(selected),'passed':sum(t['status']=='passed' for t in selected),'failed':sum(t['status']=='failed' for t in selected),'selectedNotExecuted':sum(t['status'] not in ('passed','failed') for t in selected),'filtered':len(outside),'outsideExecuted':sum(t['status'] in ('passed','failed') for t in outside)}
    selection_ok=bool(selected) and {Path(s['name']).resolve() for s in report.get('testResults',[])}=={(source/f).resolve() for f in files} and report.get('numTotalTests')==len(tests) and len({(t['file'],t['name']) for t in selected})==len(selected) and counts['selectedNotExecuted']==0 and counts['outsideExecuted']==0
    result={**initial,'exitCode':code,'timedOut':timed_out,'elapsedSeconds':round(time.monotonic()-begin,3),'finishedAt':stamp(),'counts':counts,'selectionVerified':selection_ok,'ownProcessGroupStillExists':alive(process.pid),'failures':[t for t in selected if t['status']=='failed']}
    write(name+'.execution.json',result);executions.append(result);rows.extend(tests)
    print(json.dumps({'event':'group-finished','group':name,'exitCode':code,'timedOut':timed_out,'counts':counts,'elapsedSeconds':result['elapsedSeconds'],'ownProcessGroupStillExists':result['ownProcessGroupStillExists'],'failures':result['failures']},ensure_ascii=False),flush=True)

changes_after=source_changes(manifest['files'])
dependencies_after={n:sha(source/n) if (source/n).is_file() else None for n in dependencies_before}
dependency_changes=[n for n in dependencies_before if dependencies_before[n]!=dependencies_after[n]]
cache_after=sha(shared_cache) if shared_cache.is_file() else None
integrity=not changes_after and not dependency_changes and cache_before==cache_after and sha(manifest_path)==expected
processes=[{'group':r['id'],'processGroup':r['processGroup'],'stillExists':alive(r['processGroup'])} for r in executions]
stopped=all(p['stillExists'] is False for p in processes)
selected=[t for t in rows if t['selected']]
counts={'groups':len(executions),'selected':len(selected),'passed':sum(t['status']=='passed' for t in selected),'failed':sum(t['status']=='failed' for t in selected),'filtered':sum(not t['selected'] for t in rows),'selectedNotExecuted':sum(t['status'] not in ('passed','failed') for t in selected)}
passed=all(r['exitCode']==0 and not r['timedOut'] and r['selectionVerified'] for r in executions) and counts['failed']==0 and integrity and stopped
write('cleanup.json',{'at':stamp(),'ownProcessGroups':processes,'allOwnProcessesStopped':stopped,'resourceLease':'released' if stopped else 'held-needs-review','privateCache':str(cache),'privateVitestConfig':str(config),'noGUIOrRealAgent':True,'noDependencyOrSharedOutputBuild':True,'noSourceOrPublicLedgerEdits':True,'integrityPassed':integrity})
write('result.json',{'schema':'willyou-test-result-v1','batch':'M11-S3-U','attempt':1,'status':'passed' if passed else 'failed-needs-classification','baseCommit':manifest.get('baseCommit'),'source':str(source),'sourceManifestSha256':expected,'sourceFileCount':len(manifest['files']),'startedAt':started,'finishedAt':stamp(),'summedTestCommandElapsedSeconds':round(sum(r['elapsedSeconds'] for r in executions),3),'executions':executions,'counts':counts,'tests':rows,'sourceChanges':changes_after,'dependencyHashesBefore':dependencies_before,'dependencyHashesAfter':dependencies_after,'dependencyChanges':dependency_changes,'sharedCacheHashBefore':cache_before,'sharedCacheHashAfter':cache_after,'privateConfigSha256':sha(config),'privateConfigBoundary':'Only cacheDir differs from imported original config; original individual thresholds retained','integrityPassed':integrity,'allOwnProcessesStopped':stopped,'resourceLeaseReleased':stopped,'formalM11CasePassesAdded':0,'scope':'Software checks only; filtered cases not counted as passed','cleanup':'cleanup.json'})
files=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json']
write('manifest.json',{'schema':'willyou-evidence-manifest-v1','batch':'M11-S3-U','attempt':1,'files':files})
print(json.dumps({'event':'sealed','status':'passed' if passed else 'failed-needs-classification','counts':counts,'integrityPassed':integrity,'allOwnProcessesStopped':stopped,'manifestSha256':sha(out/'manifest.json')},ensure_ascii=False),flush=True)
