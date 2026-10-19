#!/usr/bin/python3
"""Delay genuine native replies for this private App's exact synthetic roots.

UI directory request IDs distinguish cancellable directory requests from the
unchanged watcher snapshots. Bytes/receipts are forwarded without substitution.
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
root = request.get('root', {}).get('path')
operation = request.get('operation')
relative = request.get('relativePath', '')
eligible = root in config['roots'] and (
    operation == 'list' and bool(request.get('requestId')) or operation == 'read')
label = None
if root == config['roots'][0]:
    if operation == 'list' and request.get('requestId'):
        label = 'slow' if relative == 'slow' else 'rootA' if relative == '' else None
    elif operation == 'read' and relative == 'a.txt':
        label = 'readA'
gates = Path(config['gates'])
held = False
if eligible and label:
    try:
        os.rename(gates / (label + '.arm'), gates / (label + '.claimed'))
        held = True
    except FileNotFoundError:
        pass

def record(event, **fields):
    if not eligible:
        return
    row = dict(atMs=time.time() * 1000, event=event, operation=operation,
               root=root, relativePath=relative, requestId=request.get('requestId'),
               label=label if held else None, pid=os.getpid(), **fields)
    with open(config['log'], 'a') as output:
        output.write(json.dumps(row, ensure_ascii=False) + '\n')

child = None

def cancelled(_signal, _frame):
    record('cancelled')
    raise SystemExit(128 + _signal)

signal.signal(signal.SIGTERM, cancelled)
try:
    child = subprocess.Popen([config['nativeBroker']], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = child.communicate(json.dumps(request).encode())
    digest = hashlib.sha256(stdout).hexdigest()
    if held:
        (gates / (label + '.native-output.jsonl')).write_bytes(stdout)
        marker = dict(atMs=time.time() * 1000, pid=os.getpid(), nativePid=child.pid,
                      nativeExit=child.returncode, outputSha256=digest,
                      requestId=request.get('requestId'), operation=operation,
                      root=root, relativePath=relative)
        (gates / (label + '.waiting.json')).write_text(json.dumps(marker))
        record('waiting', outputSha256=digest, nativeExit=child.returncode)
        deadline = time.monotonic() + 10
        while not (gates / (label + '.release')).exists():
            if time.monotonic() > deadline:
                raise RuntimeError('Synthetic native delivery gate expired')
            time.sleep(.01)
    record('delivered', outputSha256=digest, nativeExit=child.returncode)
    sys.stdout.buffer.write(stdout)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(stderr)
    sys.stderr.buffer.flush()
    raise SystemExit(child.returncode)
finally:
    if child is not None and child.poll() is None:
        child.kill()
        child.wait()
