#!/usr/bin/env python3
"""C16: real, allocated 10 GiB synthetic SVN worktree; isolated shadow Git.

No user repository is touched. JSON results survive cleanup. The fixture is
compressible source-like data, not a representative enterprise repository.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import subprocess
import tempfile
import time

p = argparse.ArgumentParser()
p.add_argument('--output', required=True)
p.add_argument('--gib', type=int, default=10)
args = p.parse_args()
output = Path(args.output).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
root = Path(tempfile.mkdtemp(prefix='m14-c16-'))
result = {'scope': 'isolated synthetic real SVN WC, allocated source-like bytes',
          'gib': args.gib, 'sparse': False, 'root': str(root), 'measurements': {}}

def command(cmd, env=None, timeout=120, cwd=None):
    started = time.perf_counter()
    r = subprocess.run(cmd, cwd=cwd or root, env=env, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(f'{cmd[:4]}: {r.stderr.decode(errors="replace")[:800]}')
    return r.stdout.decode().strip(), round(time.perf_counter() - started, 4)

def save():
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')

try:
    free = shutil.disk_usage(root).free
    if free < args.gib * 2**30 + 2 * 2**30:
        raise RuntimeError('Insufficient space for fixture plus 2 GiB reserve')
    result['versions'] = {x: command([x, '--version', '--quiet'] if x == 'svn' else [x, '--version'])[0]
                          for x in ['git', 'svn']}
    command(['svnadmin', 'create', str(root / 'svn-repository')])
    command(['svn', 'checkout', '--non-interactive', (root / 'svn-repository').as_uri(), str(root / 'wc')])
    wc = root / 'wc'
    (wc / 'versioned.txt').write_text('original versioned seed\n')
    command(['svn', 'add', str(wc / 'versioned.txt')])
    command(['svn', 'commit', '--non-interactive', '-m', 'synthetic seed', str(wc)])
    count = args.gib * 2048
    started = time.perf_counter()
    total = allocated = 0
    for i in range(count):
        if i % 1024 == 0:
            print(f'creating {i}/{count}', flush=True)
            if shutil.disk_usage(root).free < 2 * 2**30:
                raise RuntimeError('Stopped at 2 GiB disk reserve')
        d = wc / 'src' / f'{i // 128:04d}'
        d.mkdir(parents=True, exist_ok=True)
        f = d / f'file-{i:05d}.txt'
        # Unique source-like text per file; no truncate, sparse allocation or clones.
        line = f'const item_{i:05d} = "{hashlib.sha256(str(i).encode()).hexdigest()}";\n'.encode()
        payload = (line * (524288 // len(line) + 1))[:524288]
        f.write_bytes(payload)
        st = f.stat()
        total += st.st_size
        allocated += st.st_blocks * 512
    result['fixture'] = {'files': count + 1, 'directories': (count + 127) // 128,
                         'logicalBytes': total, 'allocatedBytes': allocated,
                         'creationSeconds': round(time.perf_counter() - started, 4),
                         'svnVersionedFiles': 1, 'remainingFiles': 'unversioned, included by shadow Git',
                         'compressible': True}
    print('fixture complete; first shadow snapshot', flush=True)
    shadow = root / 'shadow.git'
    command(['git', 'init', '--bare', str(shadow)])
    (shadow / 'info/exclude').write_text('/.svn/\n')
    env = {**os.environ, 'GIT_DIR': str(shadow), 'GIT_WORK_TREE': str(wc),
           'GIT_INDEX_FILE': str(root / 'shadow-index'),
           'GIT_AUTHOR_NAME': 'M14 probe', 'GIT_AUTHOR_EMAIL': 'probe@example.invalid',
           'GIT_COMMITTER_NAME': 'M14 probe', 'GIT_COMMITTER_EMAIL': 'probe@example.invalid'}
    def git(*a):
        return command(['git', '-c', 'core.compression=1', '-c', 'core.fsmonitor=false', *a], env, cwd=wc)
    def snapshot(label, parent=None):
        _, add = git('add', '-A', '--', '.')
        tree, write = git('write-tree')
        commit, commit_time = git('commit-tree', tree, *(['-p', parent] if parent else []), '-m', label)
        _, ref_time = git('update-ref', 'refs/willyou/turns/' + label, commit)
        result['measurements'][label] = {'addSeconds': add, 'writeTreeSeconds': write,
            'commitAndRefSeconds': round(commit_time + ref_time, 4),
            'totalSeconds': round(add + write + commit_time + ref_time, 4)}
        save()
        return commit
    before = snapshot('before')
    print('first complete; incremental snapshots', flush=True)
    snapshot('unchanged', before)
    (wc / 'src/0000/file-00000.txt').write_text('changed\n')
    (wc / 'src/0000/file-00001.txt').unlink()
    (wc / 'src/0000/new.txt').write_text('new\n')
    after = snapshot('after', before)
    diff, _ = git('diff-tree', '--no-commit-id', '--name-status', '-r', before, after)
    paths, _ = git('ls-tree', '-r', '--name-only', after)
    result['diff'] = diff.splitlines()
    result['checks'] = {
        'allocatedAtLeastRequestedSize': allocated >= args.gib * 2**30,
        'svnMetadataExcluded': not any(s.startswith('.svn/') for s in paths.splitlines()),
        'threeChangesOnly': len(diff.splitlines()) == 3,
        'modifiedAddedDeleted': {s[0] for s in diff.splitlines()} == {'M', 'A', 'D'},
        'noGitInWorktree': not (wc / '.git').exists(),
        'svnMetadataStillPresent': (wc / '.svn/wc.db').exists(),
    }
    result['shadowBytes'] = sum(f.stat().st_size for f in shadow.rglob('*') if f.is_file())
    result['childPeakRssNativeUnits'] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    result['status'] = 'passed' if all(result['checks'].values()) else 'failed'
except Exception as e:
    result['status'] = 'failed'
    result['error'] = str(e)
finally:
    shutil.rmtree(root)
    result['cleanup'] = {'fixtureRemoved': not root.exists()}
    save()
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
raise SystemExit(0 if result['status'] == 'passed' else 1)
