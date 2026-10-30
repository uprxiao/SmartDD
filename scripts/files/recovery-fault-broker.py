#!/usr/bin/python3
"""Private App fault fixture. Forward actual native IO; never fabricate receipts.

Only an exact synthetic root and fixed fixture filenames can enable test hooks.
The normal App and its native executable remain untouched.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

config = json.loads(Path(__file__).with_suffix('.json').read_text())
request = json.load(sys.stdin)
fixture = request.get('operation') == 'save' and request.get('root', {}).get('path') == config['projectPath']
name = request.get('relativePath')
old_fd = None
if fixture:
    if name == 'failed-io-before.txt':
        request['testFailAt'] = 'before-swap'
    elif name == 'unknown-after.txt':
        request['testFailAt'] = 'swapped'
    elif name == 'conflict-after.txt':
        old_fd = os.open(str(Path(config['projectPath']) / name), os.O_RDWR)
        request['testStopAt'] = 'swapped'
    elif name in ('unmount.txt', 'quit.txt', 'while-save.txt'):
        request['testStopAt'] = 'before-swap'

child = subprocess.Popen([config['testBroker']], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr)
child.stdin.write(json.dumps(request).encode())
child.stdin.close()
try:
    for line in child.stdout:
        if fixture:
            event = json.loads(line)
            with open(config['log'], 'a') as log:
                log.write(json.dumps({'at': time.time(), 'name': name, 'opId': request['opId'], 'event': event}) + '\n')
            if event.get('event') == 'test-stop':
                if old_fd is not None:
                    os.ftruncate(old_fd, 0)
                    os.write(old_fd, config['externalText'].encode())
                    os.fsync(old_fd)
                else:
                    marker = Path(config['gateDirectory']) / (name + '.waiting')
                    marker.write_text(json.dumps({'pid': child.pid, 'opId': request['opId'], 'phase': event['phase']}))
                    deadline = time.monotonic() + 10
                    while not marker.with_suffix('.release').exists() and time.monotonic() < deadline:
                        time.sleep(.02)
                os.kill(child.pid, signal.SIGCONT)
        sys.stdout.buffer.write(line)
        sys.stdout.buffer.flush()
    sys.exit(child.wait())
finally:
    if old_fd is not None:
        os.close(old_fd)
