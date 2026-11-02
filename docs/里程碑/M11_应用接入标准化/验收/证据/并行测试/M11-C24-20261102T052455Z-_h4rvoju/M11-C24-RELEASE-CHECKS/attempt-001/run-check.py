import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parent
session = json.loads((root / 'session.json').read_text())
source = Path(session['source'])
manifest = json.loads((root / 'source-manifest.json').read_text())
name, *argv = sys.argv[1:]
assert name.replace('-', '').isalnum() and argv
directory = root / 'evidence' / name
directory.mkdir(exist_ok=False)

def drift():
    return [item['path'] for item in manifest['files'] + manifest['fixtures']
            if not (source / item['path']).is_file() or
            hashlib.sha256((source / item['path']).read_bytes()).hexdigest() != item['sha256']]

assert not drift(), 'Frozen code or fixture drift before command'
record = {'argv': argv, 'cwd': str(source), 'sourceManifestSha256': session['sourceManifestSha256'],
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'privateCache': str(root / 'cache' / name), 'outerTimeoutSeconds': 900}
start = time.monotonic()
environment = dict(os.environ)
environment['VITEST_CACHE_DIR'] = str(root / 'cache' / name)
with (directory / 'command.log').open('wb') as output:
    child = subprocess.Popen(argv, cwd=source, env=environment, stdout=output,
                             stderr=subprocess.STDOUT, start_new_session=True)
    record.update(pid=child.pid, processGroup=child.pid)
    (directory / 'execution.json').write_text(json.dumps(record, indent=2) + '\n')
    try:
        result = child.wait(timeout=900)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, 15)
        result = child.wait(timeout=15)
        record['timedOut'] = True
record.update(exitCode=result, elapsedSeconds=round(time.monotonic()-start, 3),
              finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
              sourceAndFixtureDrift=drift())
(directory / 'execution.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record))
raise SystemExit(result or int(bool(record['sourceAndFixtureDrift'])))
