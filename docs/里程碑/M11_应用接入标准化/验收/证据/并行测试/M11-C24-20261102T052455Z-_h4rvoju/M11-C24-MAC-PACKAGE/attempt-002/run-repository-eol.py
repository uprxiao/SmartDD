import datetime
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(__file__).resolve().parent
session = json.loads((root / 'session.json').read_text())
manifest = json.loads((root / 'source-manifest-eol-fixed.json').read_text())
repository = Path(manifest['repository'])
name, *argv = sys.argv[1:]
assert name.replace('-', '').isalnum() and argv
directory = root / 'evidence' / name
directory.mkdir(exist_ok=False)

def drift():
    return [f['path'] for f in manifest['files']
            if hashlib.sha256((repository / f['path']).read_bytes()).hexdigest() != f['sha256']]

assert not drift(), 'Production/source drift before repository build'
head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repository,
                      capture_output=True, text=True, check=True).stdout.strip()
assert head == session['candidate']
record = {'argv': argv, 'cwd': str(repository), 'candidate': head,
          'sourceManifestSha256': session['sourceManifestSha256'],
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'outerTimeoutSeconds': 1800, 'coordinatorOwnsNativeBuildLease': True}
environment = dict(os.environ)
for key in list(environment):
    if key in ('GH_TOKEN', 'GITHUB_TOKEN', 'ELECTRON_RUN_AS_NODE') or key.startswith((
        'OPENAI_', 'ANTHROPIC_', 'CLAUDE_CODE_', 'CLAUDECODE', 'CSC_', 'WIN_CSC_',
        'APPLE_', 'SMARTDD_', 'WILLYOU_')):
        del environment[key]
environment.update(SMARTDD_SIGN='0', CSC_IDENTITY_AUTO_DISCOVERY='false')
start = time.monotonic()
with (directory / 'command.log').open('wb') as output:
    child = subprocess.Popen(argv, cwd=repository, env=environment,
                             stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    record.update(pid=child.pid, processGroup=child.pid)
    (directory / 'execution.json').write_text(json.dumps(record, indent=2) + '\n')
    try:
        status = child.wait(timeout=1800)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGTERM)
        status = child.wait(timeout=15)
        record['timedOut'] = True
record.update(exitCode=status, elapsedSeconds=round(time.monotonic()-start, 3),
              sourceDrift=drift(), finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
(directory / 'execution.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record))
raise SystemExit(status or int(bool(record['sourceDrift'])))
