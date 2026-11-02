"""Read-only C24 CI collector. Does not start or mutate workflows."""
import datetime,hashlib,json,re,subprocess
from pathlib import Path
P=Path('/private/tmp/willyou-m11-c24-v011-_h4rvoju/ci-watch/attempt002')
RUN='41396026050'; REPO='uprxiao/SmartDD'; HEAD='44b46ca42cc8fff192c4fd8ae051431f369a2b8b'
commands=[]
def gh(args,name,optional=False,timeout=180):
    argv=['env','-u','GH_TOKEN','-u','GITHUB_TOKEN','gh']+args
    try:
        r=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    except subprocess.TimeoutExpired as e:
        (P/name).write_bytes(e.stdout or b'');(P/(name+'.stderr.log')).write_bytes(e.stderr or b'')
        commands.append({'argv':argv,'exitCode':None,'timedOutAfterSeconds':timeout})
        if optional:return None
        raise
    (P/name).write_bytes(r.stdout);(P/(name+'.stderr.log')).write_bytes(r.stderr)
    commands.append({'argv':argv,'exitCode':r.returncode})
    if r.returncode:
        if optional:return None
        raise RuntimeError(name+' read-only command failed')
    return json.loads(r.stdout) if name.endswith('.json') else r.stdout
segments=[json.loads((P/'watch-execution.json').read_text())]
reconnect=P/'watch-reconnect-001-execution.json'
if reconnect.exists():segments.append(json.loads(reconnect.read_text()))
if any('exitCode' not in segment for segment in segments):raise RuntimeError('A read-only watch segment is still running')
w=segments[-1]
r=gh(['run','view',RUN,'--repo',REPO,'--json','databaseId,headSha,headBranch,status,conclusion,url,workflowName,createdAt,updatedAt,jobs'],'final-run.json')
findings=[]; logs=[]
if r['status']!='completed':findings.append('RUN_NOT_COMPLETE')
if r['conclusion']!='success':findings.append('RUN_NOT_SUCCESS')
if r['headSha']!=HEAD:findings.append('HEAD_MISMATCH')
windows=None; release=None
for job in r['jobs']:
    jid=job['databaseId']
    if job['conclusion']!='success':findings.append('JOB_NOT_SUCCESS:'+str(jid))
    for step in job['steps']:
        if step['name']=='Verify generated application module metadata on Windows':
            windows={'jobId':jid,**step}
        if step['name']=='Run pnpm test:release':
            release={'jobId':jid,**step}
    name='job-'+str(jid)+'-full.log'
    preserved=P/'windows-application-bundles-full.log'
    if jid==125117702890 and preserved.exists():
        name=preserved.name;b=preserved.read_bytes()
    else:
        b=gh(['api','repos/'+REPO+'/actions/jobs/'+str(jid)+'/logs'],name,optional=True)
    if b is None:
        logs.append({'jobId':jid,'path':name,'available':False});continue
    s=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',b.decode(errors='replace'))
    vitest=[line for line in s.splitlines() if re.search(r'\b(?:Test Files|Tests)\s+\d+',line)]
    node=[line for line in s.splitlines() if re.search(r'(?:^|\s)(?:#|ℹ) (?:tests|suites|pass|fail|cancelled|skipped|todo)\s+\d+',line) or re.search(r'\b1\.\.\d+\s*$',line)]
    eol=[line for line in s.splitlines() if re.search(r'\bi/(?:lf|crlf|mixed|none)\s+w/',line)]
    log={'eolObservations':eol,'jobId':jid,'path':name,'available':True,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'actualVitestSummary':vitest,'actualNodeSummary':node}
    if release and release['jobId']==jid:
        start=release['startedAt'];end=release['completedAt'];bounded=[]
        for line in s.splitlines():
            m=re.search(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z',line)
            if m and start[:19]<=m[0][:19]<=end[:19] and (re.search(r'(?:#|ℹ) (?:tests|suites|pass|fail|cancelled|skipped|todo)\s+\d+',line) or re.search(r'\b1\.\.\d+\s*$',line)):
                bounded.append(line)
        log['releaseStepActualSummary']=bounded
    logs.append(log)
if windows is None or windows['conclusion']!='success':findings.append('WINDOWS_METADATA_STEP_NOT_SUCCESS')
if release is None or release['conclusion']!='success':findings.append('RELEASE_TEST_STEP_NOT_SUCCESS')
release_counts={}
for item in logs:
    for line in item.get('releaseStepActualSummary',[]):
        m=re.search(r'(?:#|ℹ)\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)',line)
        if m:release_counts[m[1]]=int(m[2])
if release_counts.get('tests')!=24 or release_counts.get('pass')!=24 or release_counts.get('fail')!=0:
    findings.append('RELEASE_TEST_ACTUAL_24_PASS_SUMMARY_NOT_VERIFIED')
windows_observation=json.loads((P/'windows-eol-metadata-observation.json').read_text()) if (P/'windows-eol-metadata-observation.json').exists() else None
if not windows_observation or windows_observation.get('head_sha')!=HEAD or not any(re.search(r'i/lf\s+w/lf\s+attr/text eol=lf',x) for x in windows_observation.get('eolObservations',[])):
    findings.append('WINDOWS_LF_OBSERVATION_NOT_VERIFIED')
historical=gh(['run','view','41393394709','--repo',REPO,'--json','databaseId,headSha,headBranch,status,conclusion,url,updatedAt,jobs'],'historical-run-41393394709.json',optional=True,timeout=15)
result={'schema':'c24-readonly-ci-monitor-v1','status':'passed-ci' if not findings else 'findings','runId':int(RUN),'expectedHead':HEAD,'expectedVersion':'0.1.1','supersedesRun':41394938471,'watchExitCode':w['exitCode'],'watchSegments':segments,'terminalObservationMethod':'bounded read-only API snapshots after two EOF transport exits','watchTransportInterrupted':True,'run':r,'windowsMetadataStep':windows,'releaseTestStep':release,'jobLogs':logs,'releaseTestActualCounts':release_counts,'windowsEolMetadataEvidence':windows_observation,'historicalRun':historical,'findings':findings,'commands':commands,'boundary':'Existing CI metadata and logs only. No local tests/builds/native/UI/Agent, no big artifacts, no workflow dispatch/rerun/retry/cancel or tag/release mutations. New version release not started or assumed.','formalAcceptanceDelta':0,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(P/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':result['status'],'head':r['headSha'],'conclusion':r['conclusion'],'findings':findings,'windowsMetadataStep':windows,'releaseTestStep':release,'logs':logs},ensure_ascii=False))
