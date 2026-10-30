#!/usr/bin/python3
"""Actual external writer for own save-race fixtures; never fabricates App IO."""
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time

config_path = Path(sys.argv[1]).resolve()
config = json.loads(config_path.read_text())
base = Path(config['base']).resolve()
assert str(base).startswith('/private/tmp/willyou-save-race-')
assert config_path.is_relative_to(base)
target = Path(config['target'])
assert target.resolve().is_relative_to(base / 'project')
gate, ready, result = [Path(config[k]) for k in ('gate', 'ready', 'result')]
assert all(p.resolve().is_relative_to(base) for p in (gate, ready, result))
mode = config['mode']
assert mode in ('old-fd', 'path-inplace', 'path-replace')
data = base64.b64decode(config['base64'], validate=True)
fd = os.open(target, os.O_RDWR) if mode == 'old-fd' else None
identity = lambda s: {'device': str(s.st_dev), 'inode': str(s.st_ino)}
initial = identity(os.fstat(fd) if fd is not None else target.stat())
def publish(path, value):
    temporary = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    temporary.write_text(json.dumps(value))
    os.replace(temporary, path)
publish(ready, {'pid': os.getpid(), 'mode': mode, 'heldFd': fd is not None, 'identity': initial})
try:
    deadline = time.monotonic() + 12
    while not gate.exists():
        if time.monotonic() >= deadline:
            raise TimeoutError('Own writer gate was not released')
        time.sleep(.005)
    started = time.monotonic_ns()
    if mode == 'path-replace':
        assert target.parent.resolve().is_relative_to(base / 'project')
        fd, temporary = tempfile.mkstemp(prefix='.external-writer-', dir=target.parent)
    elif mode == 'path-inplace':
        assert target.resolve().is_relative_to(base / 'project')
        fd = os.open(target, os.O_RDWR)
    os.ftruncate(fd, 0)
    os.lseek(fd, 0, os.SEEK_SET)
    written = 0
    while written < len(data):
        written += os.write(fd, data[written:])
    os.fsync(fd)
    final = identity(os.fstat(fd))
    if mode == 'path-replace':
        os.replace(temporary, target)
        parent = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    publish(result, {'pid': os.getpid(), 'mode': mode, 'initialIdentity': initial, 'writtenIdentity': final, 'written': written, 'sha256': hashlib.sha256(data).hexdigest(), 'startedNs': str(started), 'finishedNs': str(time.monotonic_ns())})
except Exception as error:
    publish(result, {'pid': os.getpid(), 'mode': mode, 'error': repr(error)})
    raise
finally:
    if fd is not None:
        os.close(fd)
