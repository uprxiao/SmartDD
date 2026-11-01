from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,time

source=Path('/private/tmp/willyou-m11-s7/source-attempt-001')
out=source.parent/'evidence/units/attempt-001'
manifest_path=source.parent/'source-manifest-attempt-001.json'
expected='4fff9145c607a5022814c46d3928a0887adddb5b38762e92565af72028f4b09e'
groups=[
    {'id':'typecheck','files':[],'kind':'typecheck'},
    {'id':'s7-components','files':['src/main/core/applications/__tests__/'+n+'.test.ts' for n in ['zentao-v2','sample-kv','upstream-session-pool','run-plan','module-registry']]},
    {'id':'launcher-data-only','files':['src/main/core/applications/__tests__/task-capability-launcher.test.ts'],'pattern':'M11 S4 data-only','anticipatedSelected':6},
    {'id':'build-script','files':['scripts/applications/build.test.mjs'],'kind':'node-test'},
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
manifest=json.loads(manifest_path.read_text());assert len(manifest['files'])==4805
before_changes=source_changes(manifest['files']);assert not before_changes,before_changes
old=Path('/private/tmp/willyou-m11-s4/evidence/units/attempt-001/result.json')
dependencies_before={n:sha(source/n) if (source/n).is_file() else None for n in json.loads(old.read_text())['dependencyHashesAfter'] if n.startswith('node_modules/')}
shared_out_before={str(p.relative_to(source)):sha(p) for p in sorted((source/'out').rglob('*')) if p.is_file()}
write('shared-out-before.json',shared_out_before)
shared_cache=source/'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json'
cache_before=sha(shared_cache) if shared_cache.is_file() else None
for part in ['tmp','xdg','vite']:(cache/part).mkdir(parents=True,exist_ok=True)
env={**os.environ,'XDG_CACHE_HOME':str(cache/'xdg'),'TMPDIR':str(cache/'tmp')+'/','NO_COLOR':'1','COREPACK_ENABLE_NETWORK':'0','ELECTRON_RUN_AS_NODE':'1'}
bundles=source.parent/'bundles-attempt-001'
bundle_index=json.loads((bundles/'index.json').read_text())
assert bundle_index['indexHash']=='0f384b1f8b388eb5fa6ca29ecd4112e1a05fc19aa198c80fde5d898dfd7100e6'
assert {a['appId'] for a in bundle_index['apps']}=={'mail','zentao','sample-kv'}
bundle_before={str(p.relative_to(bundles)):sha(p) for p in sorted(bundles.rglob('*')) if p.is_file()}
write('production-bundles-before.json',bundle_before)
env['WILLYOU_TEST_BUNDLES']=str(bundles)
started=stamp();executions=[];rows=[]
for group in groups:
    name=group['id'];files=group['files'];pattern=group.get('pattern')
    electron=(source/'node_modules/electron/dist'/(source/'node_modules/electron/path.txt').read_text().strip()).resolve()
    argv=[str(electron),str(source/'node_modules/vitest/vitest.mjs'),'run',*files,'--config',str(config),'--maxWorkers=1','--no-file-parallelism','--no-cache','--reporter=verbose','--reporter=json','--outputFile.json='+str(out/(name+'.vitest.json'))]
    if group.get('kind')=='typecheck':argv=[str(electron),str(out/'typecheck.mjs')]
    if group.get('kind')=='node-test':argv=['node','--test',*files]
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
    if group.get('kind')=='typecheck':
        counts={'files':0,'reportedTotal':0,'selected':0,'passed':0,'failed':0,'selectedNotExecuted':0,'filtered':0,'outsideExecuted':0}
        selection_ok=code==0
        if code!=0:print(json.dumps({'event':'typecheck-error','stdout':log.read_text(errors='replace'),'stderr':(out/(name+'.stderr.log')).read_text(errors='replace')},ensure_ascii=False),flush=True)
    if group.get('kind')=='node-test':
        tap=log.read_text(errors='replace')
        def tap_count(key):
            match=re.search(r'^# '+key+r'\s+(\d+)\s*$',tap,re.MULTILINE)
            return int(match.group(1)) if match else None
        total=tap_count('tests');passed_count=tap_count('pass');failed_count=tap_count('fail')
        counts={'files':len(files),'reportedTotal':total,'selected':total or 0,'passed':passed_count or 0,'failed':failed_count or 0,'selectedNotExecuted':(tap_count('cancelled') or 0)+(tap_count('skipped') or 0)+(tap_count('todo') or 0),'filtered':0,'outsideExecuted':0}
        names=re.findall(r'^# Subtest: (.+)$',tap,re.MULTILINE)
        tests=[{'group':name,'file':files[0],'name':title,'selected':True,'status':'passed' if code==0 and failed_count==0 else 'failed','durationMs':None,'failureMessages':[] if code==0 else [tap,(out/(name+'.stderr.log')).read_text(errors='replace')]} for title in names]
        selected=tests
        selection_ok=bool(total) and total==len(tests) and passed_count is not None and failed_count is not None and passed_count+failed_count==total and counts['selectedNotExecuted']==0
        if code!=0:print(json.dumps({'event':'node-test-error','stdout':tap,'stderr':(out/(name+'.stderr.log')).read_text(errors='replace')},ensure_ascii=False),flush=True)
    result={**initial,'exitCode':code,'timedOut':timed_out,'elapsedSeconds':round(time.monotonic()-begin,3),'finishedAt':stamp(),'counts':counts,'selectionVerified':selection_ok,'ownProcessGroupStillExists':alive(process.pid),'failures':[t for t in selected if t['status']=='failed']}
    write(name+'.execution.json',result);executions.append(result);rows.extend(tests)
    print(json.dumps({'event':'group-finished','group':name,'exitCode':code,'timedOut':timed_out,'counts':counts,'elapsedSeconds':result['elapsedSeconds'],'ownProcessGroupStillExists':result['ownProcessGroupStillExists'],'failures':result['failures']},ensure_ascii=False),flush=True)

changes_after=source_changes(manifest['files'])
dependencies_after={n:sha(source/n) if (source/n).is_file() else None for n in dependencies_before}
dependency_changes=[n for n in dependencies_before if dependencies_before[n]!=dependencies_after[n]]
cache_after=sha(shared_cache) if shared_cache.is_file() else None
shared_out_after={str(p.relative_to(source)):sha(p) for p in sorted((source/'out').rglob('*')) if p.is_file()}
shared_out_changes=[n for n in sorted(set(shared_out_before)|set(shared_out_after)) if shared_out_before.get(n)!=shared_out_after.get(n)]
bundle_after={str(p.relative_to(bundles)):sha(p) for p in sorted(bundles.rglob('*')) if p.is_file()}
bundle_changes=[n for n in sorted(set(bundle_before)|set(bundle_after)) if bundle_before.get(n)!=bundle_after.get(n)]
integrity=not changes_after and not dependency_changes and not shared_out_changes and not bundle_changes and cache_before==cache_after and sha(manifest_path)==expected
processes=[{'group':r['id'],'processGroup':r['processGroup'],'stillExists':alive(r['processGroup'])} for r in executions]
stopped=all(p['stillExists'] is False for p in processes)
selected=[t for t in rows if t['selected']]
counts={'groups':len(executions),'selected':len(selected),'passed':sum(t['status']=='passed' for t in selected),'failed':sum(t['status']=='failed' for t in selected),'filtered':sum(not t['selected'] for t in rows),'selectedNotExecuted':sum(t['status'] not in ('passed','failed') for t in selected)}
passed=all(r['exitCode']==0 and not r['timedOut'] and r['selectionVerified'] for r in executions) and counts['failed']==0 and integrity and stopped
write('cleanup.json',{'at':stamp(),'ownProcessGroups':processes,'allOwnProcessesStopped':stopped,'resourceLease':'released' if stopped else 'held-needs-review','privateCache':str(cache),'privateVitestConfig':str(config),'noGUIOrRealAgent':True,'noDependencyOrSharedOutputBuild':True,'noSourceOrPublicLedgerEdits':True,'integrityPassed':integrity})
mapping=json.loads((out/'t36-map-template.json').read_text())
for item in mapping['criteria']:
    actual=[t for t in rows if t['selected'] and any(fragment in t['name'] for fragment in item['testNameFragments'])]
    item['evidence']=[{'file':t['file'],'name':t['name'],'status':t['status']} for t in actual]
    item['referencedTestsPassed']=bool(actual) and all(t['status']=='passed' for t in actual)
mapping['sourceManifestSha256']=expected
mapping['formalCasePassesAdded']=0
write('t36-criterion-mapping.json',mapping)
write('result.json',{'schema':'willyou-test-result-v1','batch':'M11-S7-U','attempt':1,'status':'passed' if passed else 'failed-needs-classification','baseCommit':manifest.get('baseCommit'),'source':str(source),'sourceManifestSha256':expected,'sourceFileCount':len(manifest['files']),'productionBundleDirectory':str(bundles),'productionBundleIndexHash':bundle_index['indexHash'],'productionBundleIndexFileSha256':bundle_before['index.json'],'productionBundleFileCount':len(bundle_before),'productionBundleChanges':bundle_changes,'forcedEnvironment':{'WILLYOU_TEST_BUNDLES':str(bundles),'COREPACK_ENABLE_NETWORK':'0'},'T36IntegrationMapping':'t36-criterion-mapping.json','T36AllIntegrationCriteriaDemonstrated':False,'runId':'M11-S7-reference-adapters-source001','sharedOutFileCount':len(shared_out_before),'sharedOutChanges':shared_out_changes,'sharedOutBeforeReceipt':'shared-out-before.json','startedAt':started,'finishedAt':stamp(),'summedTestCommandElapsedSeconds':round(sum(r['elapsedSeconds'] for r in executions),3),'executions':executions,'counts':counts,'tests':rows,'sourceChanges':changes_after,'dependencyHashesBefore':dependencies_before,'dependencyHashesAfter':dependencies_after,'dependencyChanges':dependency_changes,'sharedCacheHashBefore':cache_before,'sharedCacheHashAfter':cache_after,'privateConfigSha256':sha(config),'privateConfigBoundary':'Only cacheDir differs from imported original config; original individual thresholds retained','integrityPassed':integrity,'allOwnProcessesStopped':stopped,'resourceLeaseReleased':stopped,'formalM11CasePassesAdded':0,'scope':'S7 controlled HTTP/MCP stdio/CLI reference integrations plus targeted launcher and private bundle build checks; no real Agent/model/SMTP; formal M11 status unchanged','invocationBoundary':'Existing Electron binary executes Vitest exactly as scripts/run-tests.mjs; COREPACK_ENABLE_NETWORK=0; no pnpm/Corepack bootstrap','cleanup':'cleanup.json'})
files=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json']
write('manifest.json',{'schema':'willyou-evidence-manifest-v1','batch':'M11-S7-U','attempt':1,'files':files})
print(json.dumps({'event':'sealed','status':'passed' if passed else 'failed-needs-classification','counts':counts,'integrityPassed':integrity,'allOwnProcessesStopped':stopped,'manifestSha256':sha(out/'manifest.json')},ensure_ascii=False),flush=True)
