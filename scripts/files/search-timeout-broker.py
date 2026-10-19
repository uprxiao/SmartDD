#!/usr/bin/python3
"""Forward real broker bytes, holding one armed private-root walk until timeout.

Only a disposable acceptance App uses this wrapper. The real main-process
deadline and signal handling are exercised; no error/result is manufactured.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

config = json.loads(Path(__file__).with_suffix('.json').read_text())
request = json.load(sys.stdin)
eligible = request.get('operation') == 'walk' and request.get('root', {}).get('path') == config['root']
gates = Path(config['gates'])
held = False
if eligible:
    try:
        os.rename(gates / 'timeout.arm', gates / 'timeout.claimed')
        held = True
    except FileNotFoundError:
        pass

def record(event, **extra):
    if eligible:
        with open(config['log'], 'a') as output:
            output.write(json.dumps(dict(event=event, atMs=time.time() * 1000,
                                         pid=os.getpid(), held=held, **extra)) + '\n')

def cancelled(signum, _frame):
    record('cancelled', signal=signum)
    raise SystemExit(128 + signum)

signal.signal(signal.SIGTERM, cancelled)
child = subprocess.Popen([config['nativeBroker']], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    stdout, stderr = child.communicate(json.dumps(request).encode())
    digest = hashlib.sha256(stdout).hexdigest()
    if held:
        (gates / 'timeout.native-output.jsonl').write_bytes(stdout)
        record('waiting', outputSha256=digest, nativeExit=child.returncode)
        # Main's unchanged 15s deadline must kill us first.
        time.sleep(30)
    record('delivered', outputSha256=digest, nativeExit=child.returncode)
    sys.stdout.buffer.write(stdout)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(stderr)
    sys.stderr.buffer.flush()
    raise SystemExit(child.returncode)
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
