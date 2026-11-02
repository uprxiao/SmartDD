import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parent
app = root / 'Release Applications' / 'WillYou.app'
installed = json.loads((root / 'evidence/release-install-001/result.json').read_text())
assert installed['status'] == 'passed'
assert installed['candidate'] == '44b46ca42cc8fff192c4fd8ae051431f369a2b8b'
assert installed['installedApp'] == str(app)
evidence = root / 'evidence/release-native-001'
evidence.mkdir(exist_ok=False)
for name in ['home', 'tmp']:
    (evidence / name).mkdir()
repo = Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10')
script = repo / 'scripts/release/native-smoke.cjs'
original = subprocess.check_output(['git', 'show', installed['candidate'] + ':scripts/release/native-smoke.cjs'], cwd=repo)
assert script.read_bytes() == original
minimal = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(evidence/'home'),
           'TMPDIR': str(evidence/'tmp')+'/', 'LANG': 'en_US.UTF-8', 'ELECTRON_RUN_AS_NODE': '1',
           'HTTP_PROXY': 'http://127.0.0.1:9', 'HTTPS_PROXY': 'http://127.0.0.1:9',
           'ALL_PROXY': 'http://127.0.0.1:9', 'NO_PROXY': '127.0.0.1,localhost'}
command = [str(app/'Contents/MacOS/WillYou'), str(script), str(app/'Contents/Resources'), '0.1.1', 'arm64']
result = {'schema': 'willyou-v011-public-release-local-native-v1',
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'releaseCommit': installed['candidate'], 'artifactOrigin': 'github-release-arm64',
          'dmgSha256': installed['imageSha256'], 'asarSha256': installed['asarSha256'],
          'command': command, 'scriptSha256': hashlib.sha256(original).hexdigest(),
          'environmentKeys': sorted(minimal), 'dailyCredentialsUsed': False,
          'status': 'running', 'scope': 'Actual CI packaged Electron/native modules on local Mac arm64; no model or real mail calls.'}
start = time.monotonic()
try:
    with (evidence/'command.log').open('wb') as log:
        child = subprocess.Popen(command, cwd=evidence, env=minimal, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        result['pid'] = child.pid
        (evidence/'execution.json').write_text(json.dumps(result, indent=2)+'\n')
        try:
            result['exitCode'] = child.wait(timeout=180)
        except subprocess.TimeoutExpired:
            result['timedOut'] = True
            os.killpg(child.pid, 15)
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, 9)
                child.wait(timeout=5)
            raise
    assert result['exitCode'] == 0
    lines = (evidence/'command.log').read_text().strip().splitlines()
    output = json.loads(lines[-1])
    assert output['version'] == '0.1.1' and output['arch'] == 'arm64' and output['platform'] == 'darwin'
    for field in ['sqlite', 'pty', 'voiceBridge', 'fileBroker', 'officeRenderer', 'fileWatcher']:
        assert output[field] == 'passed'
    result['output'] = output
    result['status'] = 'passed'
except Exception as error:
    result['status'] = 'failed'
    result['error'] = type(error).__name__ + ': ' + str(error)
finally:
    result['elapsedSeconds'] = round(time.monotonic()-start, 3)
    result['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (evidence/'result.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result))
raise SystemExit(0 if result['status'] == 'passed' else 1)
