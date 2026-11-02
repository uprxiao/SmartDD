"""Read-only v0.1.1 release metadata and small-assets audit."""
import datetime,hashlib,json,re,subprocess
from pathlib import Path
P=Path('/private/tmp/willyou-m11-c24-v011-_h4rvoju/release-watch/attempt002')
REPO='uprxiao/SmartDD';RUN='41399417380';TAG='v0.1.1';VERSION='0.1.1';HEAD='44b46ca42cc8fff192c4fd8ae051431f369a2b8b';TAGOBJ='727e651fbcead7528b7ea86ddec95195e60471c1'
receipts=[];findings=[]
def gh(args,name,optional=False):
    argv=['env','-u','GH_TOKEN','-u','GITHUB_TOKEN','gh']+args
    try:q=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25)
    except subprocess.TimeoutExpired as e:
        (P/name).write_bytes(e.stdout or b'');(P/(name+'.stderr.log')).write_bytes(e.stderr or b'');receipts.append({'argv':argv,'path':name,'exitCode':None,'timedOut':True})
        if optional:return None
        raise
    (P/name).write_bytes(q.stdout);(P/(name+'.stderr.log')).write_bytes(q.stderr);receipts.append({'argv':argv,'path':name,'exitCode':q.returncode,'timedOut':False})
    if q.returncode:
        if optional:return None
        raise RuntimeError(name+' readonly query failed')
    return json.loads(q.stdout) if name.endswith('.json') else q.stdout

def digest(b):return hashlib.sha256(b).hexdigest()
def plain(b):return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',b.decode(errors='replace'))
def api_digest_matches(asset,value):return asset.get('digest')=='sha256:'+value
obs=json.loads((P/'observer-execution.json').read_text())
if 'exitCode' not in obs:raise RuntimeError('Observer has not exited')
run=gh(['run','view',RUN,'--repo',REPO,'--json','databaseId,headSha,headBranch,status,conclusion,url,workflowName,createdAt,updatedAt,jobs'],'final-run.json')
if run['status']!='completed':findings.append('RUN_NOT_COMPLETED')
if run['conclusion']!='success':findings.append('RUN_NOT_SUCCESS')
if run['headSha']!=HEAD:findings.append('RUN_HEAD_MISMATCH')
run_rest=gh(['api','repos/'+REPO+'/actions/runs/'+RUN],'final-run-rest.json')
first_jobs=gh(['api','repos/'+REPO+'/actions/runs/'+RUN+'/attempts/1/jobs?per_page=100'],'attempt1-jobs-final.json')['jobs']
second_jobs=gh(['api','repos/'+REPO+'/actions/runs/'+RUN+'/attempts/2/jobs?per_page=100'],'attempt2-jobs-final.json')['jobs']
if run_rest.get('run_attempt')!=2 or run_rest.get('head_sha')!=HEAD:findings.append('FINAL_ATTEMPT_OR_SOURCE_MISMATCH')
first_root=P.parent/'attempt001'
prior_manifest_sha=digest((first_root/'manifest.json').read_bytes())
if prior_manifest_sha!='115aa24eacc03af04c6708d569599181012783ee9029612774542bada1d97a63':findings.append('FROZEN_FIRST_ATTEMPT_MANIFEST_CHANGED')
first_by={j['name']:j for j in first_jobs};second_by={j['name']:j for j in second_jobs}
original_good=[j for j in first_jobs if j['conclusion']=='success']
x64_names=[j['name'] for j in first_jobs if 'package (mac, x64' in j['name']]
new_required=set(x64_names+['publish']);logical=[];selected={}
if len(first_by)!=9 or len(original_good)!=7 or len(new_required)!=2:findings.append('FIRST_ATTEMPT_LOGICAL_BASELINE_MISMATCH')
for name,old_job in first_by.items():
    new_job=second_by.get(name);reuse=name not in new_required;chosen=old_job if reuse else new_job
    valid=bool(chosen and chosen.get('head_sha')==HEAD and chosen['status']=='completed' and chosen['conclusion']=='success')
    if not reuse:
        valid=bool(valid and chosen.get('run_attempt')==2 and chosen['id']!=old_job['id'] and chosen.get('started_at') and chosen['started_at']>='2026-11-02T07:08:37Z')
    if not valid:findings.append('LOGICAL_JOB_NOT_VERIFIED:'+name)
    mirror=bool(reuse and new_job and all(new_job.get(k)==old_job.get(k) for k in ('started_at','completed_at','runner_id')))
    logical.append({'name':name,'mode':'reused-original-success' if reuse else 'new-execution-attempt2','evidenceAttempt':1 if reuse else 2,'selectedJobId':chosen['id'] if chosen else None,'selectedConclusion':chosen['conclusion'] if chosen else None,'selectedHead':chosen.get('head_sha') if chosen else None,'originalAttempt1':{'jobId':old_job['id'],'conclusion':old_job['conclusion']},'latestProviderRow':{'jobId':new_job['id'],'run_attempt':new_job.get('run_attempt'),'started_at':new_job.get('started_at'),'completed_at':new_job.get('completed_at'),'runner_id':new_job.get('runner_id')} if new_job else None,'providerInheritedExecutionMetadataMatchesOriginal':mirror if reuse else None,'verified':valid})
    if chosen:selected[name]=chosen
if len(logical)!=9:findings.append('LOGICAL_JOB_COUNT_NOT_NINE')
def cli_job(j):
    return {'databaseId':j['id'],'name':j['name'],'status':j['status'],'conclusion':j['conclusion'],'startedAt':j['started_at'],'completedAt':j['completed_at'],'steps':[{'name':x['name'],'status':x['status'],'conclusion':x['conclusion'],'startedAt':x['started_at'],'completedAt':x['completed_at']} for x in j.get('steps',[])]}
ref=gh(['api','repos/'+REPO+'/git/ref/tags/'+TAG],'final-tag-ref.json')
obj=gh(['api','repos/'+REPO+'/git/tags/'+ref['object']['sha']],'final-tag-object.json') if ref['object']['type']=='tag' else ref
if ref['object']['type']!='tag' or ref['object']['sha']!=TAGOBJ or obj.get('object',{}).get('type')!='commit' or obj.get('object',{}).get('sha')!=HEAD:findings.append('ANNOTATED_TAG_SOURCE_MISMATCH')
checks=cli_job(selected['build / checks / checks']) if 'build / checks / checks' in selected else None;checks_log=None;vitest=[];release_counts={};release_summary=[]
if checks:
    checks_log_path='checks-job-full.log'
    prior_log=first_root/'checks-stage-full.log';prior_receipt=first_root/'checks-stage-receipt.json'
    prior=json.loads(prior_receipt.read_text()) if prior_receipt.exists() else None
    if prior and prior.get('exitCode')==0 and prior.get('head')==HEAD and prior.get('jobId')==checks['databaseId'] and prior_log.exists() and digest(prior_log.read_bytes())==prior.get('sha256'):
        checks_log=prior_log.read_bytes();checks_log_path='../attempt001/'+prior_log.name
    else:
        checks_log=gh(['api','repos/'+REPO+'/actions/jobs/'+str(checks['databaseId'])+'/logs'],checks_log_path,optional=True)
    release_step=next((s for s in checks['steps'] if s['name']=='Run pnpm test:release'),None)
    if checks_log is not None:
        for line in plain(checks_log).splitlines():
            if re.search(r'\b(?:Test Files|Tests)\s+\d+',line):vitest.append(line)
            stamp=re.search(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z',line)
            m=re.search(r'(?:#|ℹ)\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)',line)
            if release_step and stamp and m and release_step['startedAt'][:19]<=stamp[0][:19]<=release_step['completedAt'][:19]:release_counts[m[1]]=int(m[2]);release_summary.append(line)
if release_counts.get('tests')!=24 or release_counts.get('pass')!=24 or release_counts.get('fail')!=0:findings.append('ACTUAL_RELEASE_TESTS_NOT_VERIFIED_24_PASS')
if not vitest:findings.append('ACTUAL_FULL_TEST_STATISTICS_UNAVAILABLE')
windows=json.loads((first_root/'windows-eol-metadata-observation.json').read_text()) if (first_root/'windows-eol-metadata-observation.json').exists() else None
if not windows or windows.get('head_sha')!=HEAD or windows.get('conclusion')!='success' or not any(re.search(r'i/lf\s+w/lf\s+attr/text eol=lf',x) for x in windows.get('eolObservations',[])):findings.append('WINDOWS_LF_METADATA_EVIDENCE_UNVERIFIED')
release=gh(['api','repos/'+REPO+'/releases/tags/'+TAG],'release-api.json',optional=True)
latest=gh(['api','repos/'+REPO+'/releases/latest'],'latest-release-api.json',optional=True)
latest404='HTTP 404' in (P/'latest-release-api.json.stderr.log').read_text()
nonlatest=bool(release and ((latest and latest.get('id')!=release['id']) or (latest is None and latest404)))
assets=[];downloaded=[];producer_rows=[];installer_rows=[];checksums={};release_info=None
if not release:findings.append('RELEASE_API_NOT_AVAILABLE')
else:
    if release.get('tag_name')!=TAG:findings.append('RELEASE_TAG_MISMATCH')
    if release.get('draft') is not False:findings.append('RELEASE_STILL_DRAFT')
    if release.get('prerelease') is not True:findings.append('PREVIEW_NOT_PRERELEASE')
    if not nonlatest:findings.append('NONLATEST_STATE_UNVERIFIED')
    assets=[{k:a.get(k) for k in ('id','name','size','state','digest','content_type','browser_download_url')} for a in release.get('assets',[])]
    installers=[a for a in assets if re.search(r'\.(dmg|exe|msi|AppImage|deb|rpm)$',a['name'],re.I)]
    manifests=[a for a in assets if a['name'].startswith('manifest-') and a['name'].endswith('.json')]
    sums=[a for a in assets if a['name']=='SHA256SUMS.txt']
    if len(installers)!=7:findings.append('INSTALLER_COUNT_NOT_SEVEN')
    if len(manifests)!=4:findings.append('PRODUCER_MANIFEST_COUNT_NOT_FOUR')
    if len(sums)!=1:findings.append('SHA256SUMS_MISSING_OR_AMBIGUOUS')
    expected={'manifest-mac-arm64.json':('mac','arm64',1),'manifest-mac-x64.json':('mac','x64',1),'manifest-win-x64.json':('win','x64',2),'manifest-linux-x64.json':('linux','x64',3)}
    if {a['name'] for a in manifests}!=set(expected):findings.append('PRODUCER_MANIFEST_NAME_SET_MISMATCH')
    selected=manifests+sums;directory=P/'small-assets';directory.mkdir(exist_ok=True)
    if any(a['size']>16*1024*1024 for a in selected):findings.append('SMALL_ASSET_SIZE_BUDGET_EXCEEDED')
    else:
        for a in selected:
            gh(['release','download',TAG,'--repo',REPO,'--dir',str(directory),'--pattern',a['name']],'download-'+a['name']+'.log')
            f=directory/a['name'];b=f.read_bytes();row={'name':a['name'],'bytes':len(b),'sha256':digest(b),'apiDigest':a.get('digest'),'apiDigestMatches':api_digest_matches(a,digest(b))};downloaded.append(row)
            if len(b)!=a['size'] or not row['apiDigestMatches']:findings.append('SMALL_ASSET_SIZE_OR_API_DIGEST_MISMATCH:'+a['name'])
        if len(sums)==1:
            for line in (directory/sums[0]['name']).read_text().splitlines():
                m=re.fullmatch(r'([a-fA-F0-9]{64})\s+\*?(.+)',line)
                if not m:findings.append('MALFORMED_SHA256SUMS_LINE');continue
                if m[2] in checksums:findings.append('DUPLICATE_SHA256SUMS_FILENAME:'+m[2])
                checksums[m[2]]=m[1].lower()
        if len(checksums)!=7 or set(checksums)!={x['name'] for x in installers}:findings.append('SHA256SUMS_NOT_EXACTLY_SEVEN_INSTALLERS')
        for a in manifests:
            m=json.loads((directory/a['name']).read_text());target=expected.get(a['name']);files=m.get('files',[])
            valid=bool(target and m.get('schemaVersion')==2 and m.get('version')==VERSION and m.get('commit')==HEAD and m.get('dirty') is False and m.get('platform')==target[0] and m.get('arch')==target[1] and len(files)==target[2] and m.get('verification')=='packaged-electron-sqlite-pty')
            producer_rows.append({'name':a['name'],'schemaVersion':m.get('schemaVersion'),'version':m.get('version'),'commit':m.get('commit'),'dirty':m.get('dirty'),'platform':m.get('platform'),'arch':m.get('arch'),'signed':m.get('signed'),'verification':m.get('verification'),'files':files,'provenanceValid':valid})
            if not valid:findings.append('PRODUCER_PROVENANCE_MISMATCH:'+a['name'])
            for f in files:
                asset=next((x for x in installers if x['name']==f.get('file')),None)
                valid=bool(asset and asset['state']=='uploaded' and asset['size']==f.get('size') and f.get('sha256')==checksums.get(f.get('file')) and api_digest_matches(asset,f.get('sha256','')) and asset['name'].startswith('WillYou-'+VERSION+'-'))
                row={'name':f.get('file'),'manifestSize':f.get('size'),'apiSize':asset['size'] if asset else None,'manifestSha256':f.get('sha256'),'sha256Sums':checksums.get(f.get('file')),'apiDigest':asset.get('digest') if asset else None,'matchesAllMetadata':valid};installer_rows.append(row)
                if not valid:findings.append('INSTALLER_METADATA_MISMATCH:'+str(f.get('file')))
        if len(installer_rows)!=7 or {x['name'] for x in installer_rows}!={x['name'] for x in installers}:findings.append('PRODUCER_INSTALLER_SET_NOT_SEVEN_UNIQUE')
    release_info={k:release.get(k) for k in ('id','html_url','tag_name','name','target_commitish','draft','prerelease','created_at','published_at')};release_info.update(assets=assets,installerCount=len(installers),producerManifestCount=len(manifests),sha256SumsPresent=len(sums)==1,nonlatestVerified=nonlatest)
arm=json.loads((P/'mac-arm64-artifact.json').read_text()) if (P/'mac-arm64-artifact.json').exists() else None
result={'schema':'v011-readonly-release-audit-v1','status':'passed-release-metadata-audit' if not findings else 'findings','runId':int(RUN),'tag':TAG,'version':VERSION,'expectedCommit':HEAD,'observerExitCode':obs['exitCode'],'runAttempt':run_rest.get('run_attempt'),'run':run,'logicalJobAggregate':logical,'logicalJobCounts':{'reusedOriginalSuccess':sum(x['mode']=='reused-original-success' for x in logical),'newExecutionsRequired':sum(x['mode']=='new-execution-attempt2' for x in logical),'verified':sum(x['verified'] for x in logical)},'firstAttemptFrozenManifestSha256':prior_manifest_sha,'firstAttemptOriginalFailurePreserved':{'jobId':125137046401,'conclusion':'failure','internalCause':'not confirmed','outerTimeoutMs':30000},'annotatedTag':{'refObject':ref['object'],'peeledTarget':obj.get('object')},'checks':{'jobId':checks['databaseId'] if checks else None,'rawLogPath':checks_log_path if checks else None,'rawLogSha256':digest(checks_log) if checks_log is not None else None,'actualReleaseTestCounts':release_counts,'actualReleaseTestSummary':release_summary,'actualVitestSummary':vitest},'windowsEolMetadataEvidence':windows,'release':release_info,'latestRelease':{k:latest.get(k) for k in ('id','tag_name','prerelease','draft')} if latest else None,'latestEndpointHTTP404':latest404,'downloadedSmallAssets':downloaded,'checksumEntries':checksums,'producerManifests':producer_rows,'installerCrossChecks':installer_rows,'macArm64ActionsArtifact':arm,'findings':findings,'queries':receipts,'formalAcceptanceDelta':0,'retryBoundary':'Coordinator performed exactly one controlled failed-task retry on unchanged tag/commit and original 30-second native-smoke limit. Executor did not retry. Seven original successes are reused; attempt2 inherited metadata is not claimed as seven reexecutions. First timeout remains in frozen attempt001; a green retry does not confirm its cause.','boundary':'Existing release/run/tag read-only. Only four producer JSON and SHA256SUMS downloaded, no installers or large Actions archives. Seven installer bytes verified through producer+SHA256SUMS+GitHub asset digests and sizes, not downloaded by this executor. Actual Mac download/install/native/start is coordinator-owned. Release target_commitish main is informational; provenance uses annotated tag peeled target + run head + producer commit. No workflows dispatched/retried/cancelled, no tag/release edits, no UI/native/Codex/local tests/builds.','finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(P/'final-query-receipts.json').write_text(json.dumps(receipts,indent=2)+'\n');(P/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':result['status'],'runConclusion':run['conclusion'],'findings':findings,'release':release_info,'releaseTestCounts':release_counts,'vitest':vitest,'installerCrossChecks':installer_rows},ensure_ascii=False))
