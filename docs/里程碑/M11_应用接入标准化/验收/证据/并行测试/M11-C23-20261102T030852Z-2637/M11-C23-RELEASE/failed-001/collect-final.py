"""Read-only final metadata/download collector. Run only after gh watch exits."""
import datetime, hashlib, json, os, re, subprocess
from pathlib import Path

root=Path('/private/tmp/willyou-m11-c23-2637/release-watch/attempt-001')
repo='uprxiao/SmartDD'; tag='v0.1.0'; run='41390093647'
expected='5471b7ec73fbe82340dd9051bffec66e8ca3e9d0'
commands=[]
def gh(args, name, optional=False):
    argv=['env','-u','GH_TOKEN','-u','GITHUB_TOKEN','gh']+args
    p=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
    commands.append({'argv':argv,'exitCode':p.returncode})
    (root/(name+'.stderr.log')).write_bytes(p.stderr)
    if p.returncode:
        if optional:return None
        raise RuntimeError(name+' readonly command failed')
    (root/name).write_bytes(p.stdout)
    return json.loads(p.stdout) if name.endswith('.json') else p.stdout

watch=json.loads((root/'watch-execution.json').read_text())
if 'exitCode' not in watch:raise RuntimeError('Original gh watch has not actually exited')
status=gh(['run','view',run,'--repo',repo,'--json','databaseId,headSha,headBranch,status,conclusion,url,workflowName,createdAt,updatedAt,jobs'],'final-run.json')
joblog=gh(['run','view',run,'--repo',repo,'--job','125099680803','--log'],'checks-job-full-attempt-002.log',optional=True)
ci_summary=[]
if joblog is not None:
    plain=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',joblog.decode(errors='replace'))
    for line in plain.splitlines():
        if re.search(r'\b(?:Test Files|Tests)\s+\d+',line):
            ci_summary.append({'line':line,'counts':{state:int(n) for n,state in re.findall(r'(\d+)\s+(passed|failed|skipped|todo)',line)}})
ref=gh(['api','repos/'+repo+'/git/ref/tags/'+tag],'final-tag-ref.json')
obj=gh(['api','repos/'+repo+'/git/tags/'+ref['object']['sha']],'final-tag-object.json') if ref['object']['type']=='tag' else ref
release=gh(['api','repos/'+repo+'/releases/tags/'+tag],'release-api.json',optional=True)
findings=[]; assets=[]; downloaded=[]; checksums={}; producers=[]; installer_checks=[]
if status['status']!='completed':findings.append('WORKFLOW_NOT_COMPLETED')
if status['conclusion']!='success':findings.append('WORKFLOW_NOT_SUCCESS')
if status['headSha']!=expected:findings.append('WORKFLOW_HEAD_MISMATCH')
if ref['object']['type']!='tag' or obj['object']['type']!='commit' or obj['object']['sha']!=expected:findings.append('ANNOTATED_TAG_COMMIT_MISMATCH')
if not release:findings.append('RELEASE_NOT_FOUND')
else:
    assets=[{k:a.get(k) for k in ('id','name','size','state','digest','content_type','browser_download_url')} for a in release.get('assets',[])]
    if release.get('draft'):findings.append('RELEASE_STILL_DRAFT')
    if not release.get('prerelease'):findings.append('PREVIEW_NOT_PRERELEASE')
    if release.get('tag_name')!=tag:findings.append('RELEASE_TAG_MISMATCH')
    installers=[a for a in assets if re.search(r'\.(?:dmg|exe|msi|AppImage|deb|rpm)$',a['name'],re.I)]
    manifests=[a for a in assets if 'manifest' in a['name'].lower() and a['name'].endswith('.json')]
    sums=[a for a in assets if re.fullmatch(r'SHA256SUMS(?:\.txt)?',a['name'])]
    if len(installers)!=7:findings.append('INSTALLER_COUNT_NOT_SEVEN')
    if len(manifests)!=4:findings.append('MANIFEST_COUNT_NOT_FOUR')
    if len(sums)!=1:findings.append('SHA256SUMS_MISSING_OR_AMBIGUOUS')
    selected=manifests+sums
    if any(a['size']>16*1024*1024 for a in selected):findings.append('SMALL_METADATA_SIZE_BUDGET_EXCEEDED')
    else:
        directory=root/'small-assets'; directory.mkdir(exist_ok=True)
        if selected:
            args=['release','download',tag,'--repo',repo,'--dir',str(directory)]
            for a in selected:args+=['--pattern',a['name']]
            gh(args,'download.log')
        sums_path=directory/sums[0]['name'] if len(sums)==1 else None
        if sums_path and sums_path.exists():
            for line in sums_path.read_text().splitlines():
                m=re.fullmatch(r'([a-fA-F0-9]{64})\s+\*?(.+)',line)
                if not m:findings.append('MALFORMED_SHA256SUMS_LINE');continue
                checksums[m[2]]=m[1].lower()
        for a in selected:
            path=directory/a['name']; actual=hashlib.sha256(path.read_bytes()).hexdigest()
            expected_hash=checksums.get(a['name'])
            recorded={'name':a['name'],'bytes':path.stat().st_size,'sha256':actual,'sha256Sums':expected_hash,'matchesSum':actual==expected_hash if expected_hash else None}
            downloaded.append(recorded)
            # Publisher's SHA256SUMS.txt covers seven installers only. Producer
            # manifests are independently hashed here and compared to API digest.
            if expected_hash and actual!=expected_hash:findings.append('DOWNLOADED_SMALL_ASSET_HASH_MISMATCH:'+a['name'])
            if a.get('digest') and a['digest'].startswith('sha256:') and a['digest'][7:]!=actual:findings.append('SMALL_ASSET_API_DIGEST_MISMATCH:'+a['name'])
        expected_targets={'manifest-mac-arm64.json':('mac','arm64',1),'manifest-mac-x64.json':('mac','x64',1),'manifest-win-x64.json':('win','x64',2),'manifest-linux-x64.json':('linux','x64',3)}
        if {a['name'] for a in manifests}!=set(expected_targets):findings.append('PRODUCER_MANIFEST_NAME_SET_MISMATCH')
        for a in manifests:
            m=json.loads((directory/a['name']).read_text())
            target=expected_targets.get(a['name'])
            valid=bool(target and m.get('schemaVersion')==2 and m.get('version')=='0.1.0' and m.get('commit')==expected and m.get('dirty') is False and m.get('platform')==target[0] and m.get('arch')==target[1] and len(m.get('files',[]))==target[2] and m.get('verification')=='packaged-electron-sqlite-pty')
            if not valid:findings.append('PRODUCER_PROVENANCE_MISMATCH:'+a['name'])
            producers.append({'name':a['name'],'version':m.get('version'),'commit':m.get('commit'),'dirty':m.get('dirty'),'platform':m.get('platform'),'arch':m.get('arch'),'signed':m.get('signed'),'verification':m.get('verification'),'files':m.get('files'),'provenanceValid':valid})
            for entry in m.get('files',[]):
                current=next((x for x in installers if x['name']==entry.get('file')),None)
                api_hash=current.get('digest','') if current else ''
                valid=bool(current and current['size']==entry.get('size') and entry.get('sha256')==checksums.get(entry.get('file')) and (not api_hash or api_hash=='sha256:'+entry.get('sha256','')))
                installer_checks.append({'name':entry.get('file'),'manifestSize':entry.get('size'),'apiSize':current['size'] if current else None,'manifestSha256':entry.get('sha256'),'sha256Sums':checksums.get(entry.get('file')),'apiDigest':api_hash,'matchesAllAvailableMetadata':valid})
                if not valid:findings.append('INSTALLER_PRODUCER_VS_SUM_API_MISMATCH:'+str(entry.get('file')))
        if len(installer_checks)!=7 or len({x['name'] for x in installer_checks})!=7:findings.append('PRODUCER_INSTALLER_SET_NOT_SEVEN_UNIQUE')
        for a in installers:
            if a['name'] not in checksums:findings.append('INSTALLER_CHECKSUM_ENTRY_MISSING:'+a['name'])
            if a.get('digest') and a['digest'].startswith('sha256:') and a['digest'][7:]!=checksums.get(a['name']):findings.append('INSTALLER_API_DIGEST_VS_SUM_MISMATCH:'+a['name'])
    release_summary={k:release.get(k) for k in ('id','html_url','tag_name','name','target_commitish','draft','prerelease','created_at','published_at')}
    release_summary.update(assets=assets,installers=len(installers),manifests=len(manifests),sha256SumsPresent=len(sums)==1)

result={'schema':'v010-readonly-release-watch-v1','status':'passed-metadata-and-small-assets' if not findings else 'findings',
 'runId':int(run),'tag':tag,'expectedCommit':expected,'watchExitCode':watch['exitCode'],
 'completedChecksJobLog':{'path':'checks-job-full-attempt-002.log','available':joblog is not None,'sha256':hashlib.sha256(joblog).hexdigest() if joblog is not None else None,'actualVitestSummary':ci_summary,'firstAttempt':'gh CLI refused logs until overall run complete; original empty log and stderr retained, no workflow retry'},
 'run':status,'tagObject':{'type':ref['object']['type'],'sha':ref['object']['sha'],'target':obj.get('object')},
 'release':release_summary if release else None,'downloadedSmallAssets':downloaded,'checksumEntries':checksums,'producerManifests':producers,'installerCrossChecks':installer_checks,
 'findings':findings,'commands':commands,'boundary':'Read-only existing run/tag/release. No workflow dispatch/rerun/retry/edit, no large installer downloaded, no App/native/UI resources. Installer checksums verified from published metadata/digest where supplied; actual Mac installer download/install/start belongs to coordinator.',
 'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(root/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':result['status'],'conclusion':status['conclusion'],'findings':findings,'release':release_summary if release else None,'downloadedSmallAssets':len(downloaded)}))
