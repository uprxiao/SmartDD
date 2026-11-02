"""Read-only C24 CI collector. Does not start or mutate workflows."""
import datetime,hashlib,json,re,subprocess
from pathlib import Path
P=Path('/private/tmp/willyou-m11-c24-v011-_h4rvoju/ci-watch/attempt001')
RUN='41394938471'; REPO='uprxiao/SmartDD'; HEAD='9bcecccfd56536644eb692a900563cd283ea5937'
commands=[]
def gh(args,name,optional=False):
    argv=['env','-u','GH_TOKEN','-u','GITHUB_TOKEN','gh']+args
    r=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
    (P/name).write_bytes(r.stdout);(P/(name+'.stderr.log')).write_bytes(r.stderr)
    commands.append({'argv':argv,'exitCode':r.returncode})
    if r.returncode:
        if optional:return None
        raise RuntimeError(name+' read-only command failed')
    return json.loads(r.stdout) if name.endswith('.json') else r.stdout
w=json.loads((P/'watch-execution.json').read_text())
if 'exitCode' not in w:raise RuntimeError('Original watch still running')
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
    preserved=P/'windows-metadata-failed-full.log'
    if jid==125114325450 and preserved.exists():
        name=preserved.name;b=preserved.read_bytes()
    else:
        b=gh(['api','repos/'+REPO+'/actions/jobs/'+str(jid)+'/logs'],name,optional=True)
    if b is None:
        logs.append({'jobId':jid,'path':name,'available':False});continue
    s=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',b.decode(errors='replace'))
    vitest=[line for line in s.splitlines() if re.search(r'\b(?:Test Files|Tests)\s+\d+',line)]
    node=[line for line in s.splitlines() if re.search(r'(?:^|\s)# (?:tests|suites|pass|fail|cancelled|skipped|todo)\s+\d+',line) or re.search(r'\b1\.\.\d+\s*$',line)]
    log={'jobId':jid,'path':name,'available':True,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'actualVitestSummary':vitest,'actualNodeSummary':node}
    if release and release['jobId']==jid:
        start=release['startedAt'];end=release['completedAt'];bounded=[]
        for line in s.splitlines():
            m=re.search(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z',line)
            if m and start[:19]<=m[0][:19]<=end[:19] and (re.search(r'# (?:tests|suites|pass|fail|cancelled|skipped|todo)\s+\d+',line) or re.search(r'\b1\.\.\d+\s*$',line)):
                bounded.append(line)
        log['releaseStepActualSummary']=bounded
    logs.append(log)
if windows is None or windows['conclusion']!='success':findings.append('WINDOWS_METADATA_STEP_NOT_SUCCESS')
if release is None or release['conclusion']!='success':findings.append('RELEASE_TEST_STEP_NOT_SUCCESS')
historical=gh(['run','view','41393394709','--repo',REPO,'--json','databaseId,headSha,headBranch,status,conclusion,url,updatedAt,jobs'],'historical-run-41393394709.json',optional=True)
result={'schema':'c24-readonly-ci-monitor-v1','status':'passed-ci' if not findings else 'findings','runId':int(RUN),'expectedHead':HEAD,'expectedVersion':'0.1.1','watchExitCode':w['exitCode'],'run':r,'windowsMetadataStep':windows,'releaseTestStep':release,'jobLogs':logs,'historicalRun':historical,'findings':findings,'commands':commands,'boundary':'Existing CI metadata and logs only. No local tests/builds/native/UI/Agent, no big artifacts, no workflow dispatch/rerun/retry/cancel or tag/release mutations. New version release not started or assumed.','formalAcceptanceDelta':0,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(P/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':result['status'],'head':r['headSha'],'conclusion':r['conclusion'],'findings':findings,'windowsMetadataStep':windows,'releaseTestStep':release,'logs':logs},ensure_ascii=False))
