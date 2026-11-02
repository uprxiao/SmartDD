import datetime, hashlib, json, os, shutil, subprocess, time, zipfile
from pathlib import Path

root = Path(__file__).resolve().parent
artifact = json.loads((root/'release-watch/attempt001/mac-arm64-artifact.json').read_text())
assert artifact['id'] == 13121743482 and artifact['name'] == 'willyou-mac-arm64' and not artifact['expired']
assert artifact['workflow_run']['id'] == 41399417380
assert artifact['workflow_run']['head_sha'] == '44b46ca42cc8fff192c4fd8ae051431f369a2b8b'
assert artifact['workflow_run']['head_branch'] == 'v0.1.1'
evidence = root/'evidence/ci-download-001'
evidence.mkdir(exist_ok=False)
package = root/'downloaded-release/ci-artifact'
package.mkdir(parents=True, exist_ok=False)
archive = package.parent/'artifact-13121743482.zip'
assert not archive.exists()
env = dict(os.environ)
for key in ['GH_TOKEN', 'GITHUB_TOKEN']: env.pop(key, None)
command = ['gh','api','repos/uprxiao/SmartDD/actions/artifacts/13121743482/zip']
result = {'schema':'willyou-ci-artifact-download-v1','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'artifact':artifact,'command':command,'status':'running','dailyAppOrCredentialsUsed':False}
start = time.monotonic()
try:
    with archive.open('xb') as output, (evidence/'command.stderr.log').open('xb') as error:
        child = subprocess.Popen(command,env=env,stdin=subprocess.DEVNULL,stdout=output,stderr=error,start_new_session=True)
        result['pid']=child.pid
        (evidence/'execution.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'status':'downloading','pid':child.pid,'artifactId':artifact['id']}),flush=True)
        try: result['exitCode']=child.wait(timeout=900)
        except subprocess.TimeoutExpired:
            child.terminate(); child.wait(timeout=10); raise
    assert result['exitCode'] == 0
    def digest(path):
        h=hashlib.sha256()
        with path.open('rb') as f:
            while chunk:=f.read(1024*1024): h.update(chunk)
        return h.hexdigest()
    result['archiveBytes']=archive.stat().st_size
    result['archiveSha256']=digest(archive)
    assert result['archiveBytes']==artifact['size_in_bytes']
    assert 'sha256:'+result['archiveSha256']==artifact['digest']
    expected={'WillYou-0.1.1-mac-arm64.dmg','manifest-mac-arm64.json'}
    with zipfile.ZipFile(archive) as z:
        assert set(z.namelist())==expected
        for item in z.infolist():
            assert item.filename in expected and not item.is_dir() and item.file_size < 1024*1024*1024
            with z.open(item) as source,(package/item.filename).open('xb') as target: shutil.copyfileobj(source,target)
    manifest=json.loads((package/'manifest-mac-arm64.json').read_text())
    assert manifest['schemaVersion']==2 and manifest['version']=='0.1.1'
    assert manifest['commit']==artifact['workflow_run']['head_sha'] and manifest['dirty'] is False
    assert manifest['platform']=='mac' and manifest['arch']=='arm64' and len(manifest['files'])==1
    image=manifest['files'][0]
    assert image['file']=='WillYou-0.1.1-mac-arm64.dmg'
    assert image['size']==(package/image['file']).stat().st_size
    assert image['sha256']==digest(package/image['file'])
    result.update(status='passed',producer=manifest,package=str(package))
except Exception as error:
    result.update(status='failed',error=type(error).__name__+': '+str(error))
finally:
    result['elapsedSeconds']=round(time.monotonic()-start,3)
    result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    (evidence/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
raise SystemExit(0 if result['status']=='passed' else 1)
