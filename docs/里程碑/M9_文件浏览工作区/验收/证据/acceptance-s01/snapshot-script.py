import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

root = Path('/private/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-m9-ui-4nPmew/project')
output = Path(sys.argv[1])

def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(8 * 1024 * 1024):
            result.update(chunk)
    return result.hexdigest()

def entry(path):
    s = path.lstat()
    value = {'device': str(s.st_dev), 'inode': str(s.st_ino), 'mode': oct(s.st_mode), 'size': s.st_size, 'mtimeNs': str(s.st_mtime_ns), 'ctimeNs': str(s.st_ctime_ns)}
    if stat.S_ISREG(s.st_mode):
        value.update(kind='file', sha256=digest(path))
    elif stat.S_ISDIR(s.st_mode):
        value['kind'] = 'directory'
    elif stat.S_ISLNK(s.st_mode):
        value.update(kind='symlink', target=os.readlink(path))
    else:
        value['kind'] = 'special-unread'
    after = path.lstat()
    if (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise RuntimeError('Changed during snapshot: ' + str(path))
    return value

started = datetime.datetime.now(datetime.timezone.utc).isoformat()
entries = {'.': entry(root)}
excluded = []
for parent, dirs, files in os.walk(root, followlinks=False):
    dirs.sort()
    for name in sorted(dirs + files):
        path = Path(parent) / name
        relative = str(path.relative_to(root))
        if name == '.DS_Store':
            excluded.append(relative)
            continue
        entries[relative] = entry(path)

index_before = entry(root / '.git/index')
command = ['/Library/Developer/CommandLineTools/usr/bin/git', '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=/dev/null', '-C', str(root), 'status', '--porcelain=v1', '-z', '--untracked-files=all']
environment = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0', 'GIT_TERMINAL_PROMPT': '0'}
result = subprocess.run(command, env=environment, check=True, capture_output=True)
index_after = entry(root / '.git/index')
assert index_before == index_after, 'Read-only git status changed index'
assert entries['.git/index'] == index_after, 'Index changed during snapshot'
rows = [row.decode('utf8') for row in result.stdout.split(b'\0') if row]
snapshot = {
    'kind': 'M9-T-S01 read-only filesystem snapshot', 'startedAt': started,
    'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'root': str(root),
    'scope': 'Every fixture entry and the complete .git tree, including HEAD/index/refs; no symlink traversal, no special-file reads.',
    'exclusionRule': 'Only Finder .DS_Store files are excluded from byte/inode/mtime comparison. Parent directory metadata remains captured; any change must be explained separately. atime is intentionally omitted because read-only access can update it.',
    'excluded': excluded, 'entries': entries,
    'gitStatus': {'command': command, 'environmentOverrides': {'GIT_OPTIONAL_LOCKS': '0', 'GIT_TERMINAL_PROMPT': '0'}, 'exitCode': result.returncode, 'porcelainRows': rows, 'rawBase64': base64.b64encode(result.stdout).decode('ascii'), 'stderr': result.stderr.decode('utf8'), 'indexUnchangedAcrossStatusCommand': True},
    'entryCount': len(entries), 'regularFileCount': sum(e['kind'] == 'file' for e in entries.values()),
    'regularFileBytes': sum(e['size'] for e in entries.values() if e['kind'] == 'file'),
}
output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'path': str(output), 'sha256': digest(output), 'entries': snapshot['entryCount'], 'files': snapshot['regularFileCount'], 'bytes': snapshot['regularFileBytes'], 'excluded': excluded, 'statusRows': [r for r in rows if 'git-' in r]} , ensure_ascii=False))
