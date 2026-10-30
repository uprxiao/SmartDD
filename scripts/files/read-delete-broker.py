#!/usr/bin/python3
"""Gate only the private B read before genuine native IO; preserve every reply."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
config = json.loads(Path(__file__).with_suffix('.json').read_text())
request = json.load(sys.stdin)
eligible = request.get('root', {}).get('path') == config['root']
gate = Path(config['gate'])
operation = request.get('operation')
relative = request.get('relativePath')
def record(event, **fields):
    if eligible:
        with open(config['log'], 'a') as f:
            f.write(json.dumps(dict(event=event, atMs=time.time()*1000,
                                   operation=operation, relativePath=relative, pid=os.getpid(), **fields))+'\n')
def cancelled(number, _frame):
    record('cancelled')
    raise SystemExit(128+number)
signal.signal(signal.SIGTERM, cancelled)
held = False
if eligible and operation == 'read' and relative == 'B.txt':
    try:
        os.rename(gate / 'arm', gate / 'claimed')
        held = True
    except FileNotFoundError:
        pass
if held:
    (gate / 'waiting.json').write_text(json.dumps(dict(atMs=time.time()*1000, pid=os.getpid(), beforeNativeRead=True)))
    record('before-native-read')
    end = time.monotonic()+12
    while not (gate / 'release').exists():
        if time.monotonic()>end:
            raise RuntimeError('Private before-read gate timed out')
        time.sleep(.01)
child = None
try:
    child = subprocess.Popen([config['nativeBroker']], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = child.communicate(json.dumps(request).encode())
    if held:
        (gate / 'native-output.jsonl').write_bytes(stdout)
    record('native-returned', nativeExit=child.returncode, heldBeforeRead=held)
    sys.stdout.buffer.write(stdout)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(stderr)
    sys.stderr.buffer.flush()
    raise SystemExit(child.returncode)
finally:
    if child is not None and child.poll() is None:
        child.kill()
        child.wait()
