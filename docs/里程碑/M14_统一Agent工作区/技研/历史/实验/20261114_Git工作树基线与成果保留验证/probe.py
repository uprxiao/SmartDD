"""Isolated native-Git evidence; does not execute either application's services."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import traceback

OUT = Path(__file__).resolve().parent
ROOT = Path(tempfile.mkdtemp(prefix='fixture-', dir=OUT))
HOME = ROOT / 'isolated-home'
HOME.mkdir()
ENV = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
ENV.update(HOME=str(HOME), XDG_CONFIG_HOME=str(HOME / 'xdg'),
           GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
           GIT_OPTIONAL_LOCKS='0', LC_ALL='C',
           GIT_AUTHOR_NAME='M14 Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
           GIT_COMMITTER_NAME='M14 Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid')
commands = []
results = []

def git(cwd, *args, ok=True):
    p = subprocess.run(['git', '-c', 'commit.gpgSign=false', '-C', str(cwd), *args],
                       env=ENV, capture_output=True, timeout=30)
    commands.append(dict(cwd=str(cwd), args=list(args), code=p.returncode,
                         stdout=p.stdout.decode(errors='backslashreplace'),
                         stderr=p.stderr.decode(errors='backslashreplace')))
    if ok and p.returncode:
        raise AssertionError(commands[-1])
    return p

def out(cwd, *args):
    return git(cwd, *args).stdout.decode().strip()

def write(root, name, content):
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content if isinstance(content, bytes) else content.encode())

def repo(name):
    p = ROOT / name
    p.mkdir()
    git(p, 'init', '-q', '-b', 'main')
    write(p, '.gitignore', 'ignored/\n')
    write(p, 'tracked.txt', 'base\n')
    write(p, 'delete.txt', 'delete baseline\n')
    write(p, 'rename.txt', 'rename baseline\n')
    write(p, 'blob.bin', b'\0base\xff')
    write(p, 'script.sh', '#!/bin/sh\nexit 0\n')
    (p / 'link').symlink_to('tracked.txt')
    git(p, 'add', '.')
    git(p, 'commit', '-qm', 'fixture baseline')
    return p

def wt(p, name, ref='HEAD'):
    q = ROOT / name
    git(p, 'worktree', 'add', '-b', name, '--', str(q), ref)
    return q

def fingerprint(p):
    files = {}
    for f in sorted(p.rglob('*')):
        rel = f.relative_to(p)
        if rel.parts[0] == '.git' or f.is_dir():
            continue
        files[str(rel)] = dict(link=os.readlink(f)) if f.is_symlink() else dict(
            sha256=hashlib.sha256(f.read_bytes()).hexdigest(), mode=f.stat().st_mode & 0o777)
    return dict(files=files, status=out(p, 'status', '--porcelain=v1', '-uall'),
                index=hashlib.sha256((p / '.git/index').read_bytes()).hexdigest(),
                head=out(p, 'rev-parse', 'HEAD'))

def case(id, title, fn):
    try:
        evidence = fn()
        results.append(dict(id=id, title=title, status='passed', evidence=evidence))
    except Exception:
        results.append(dict(id=id, title=title, status='failed', error=traceback.format_exc()))
    print(id, results[-1]['status'], flush=True)

def baseline():
    p = repo('dirty-parent')
    base = out(p, 'rev-parse', 'HEAD')
    write(p, 'tracked.txt', 'staged\n')
    git(p, 'add', 'tracked.txt')
    write(p, 'tracked.txt', 'unstaged\n')
    write(p, 'blob.bin', b'\0dirty\xfe')
    (p / 'delete.txt').unlink()
    git(p, 'mv', 'rename.txt', 'renamed.txt')
    (p / 'script.sh').chmod(0o755)
    (p / 'link').unlink()
    (p / 'link').symlink_to('renamed.txt')
    write(p, '未跟踪 空格.txt', 'untracked\n')
    write(p, 'ignored/result.txt', 'ignored artifact\n')
    before = fingerprint(p)
    q = wt(p, 'dirty-child', base)
    assert (q / 'tracked.txt').read_text() == 'base\n'
    assert (q / 'delete.txt').exists() and (q / 'rename.txt').exists()
    assert not (q / 'renamed.txt').exists() and not (q / '未跟踪 空格.txt').exists()
    assert not (q / 'ignored').exists()
    assert (q / 'blob.bin').read_bytes() == b'\0base\xff'
    assert os.readlink(q / 'link') == 'tracked.txt'
    assert not ((q / 'script.sh').stat().st_mode & 0o111)
    assert fingerprint(p) == before
    write(q, 'tracked.txt', 'child edit\n')
    assert fingerprint(p) == before
    return dict(baseCommit=base, parentBefore=before, parentAfter=fingerprint(p),
                childHead=out(q, 'rev-parse', 'HEAD'),
                childIndex=out(q, 'rev-parse', '--git-path', 'index'))

def pinned():
    p = repo('pin-parent')
    a = out(p, 'rev-parse', 'HEAD')
    write(p, 'tracked.txt', 'new branch head\n')
    git(p, 'add', '.')
    git(p, 'commit', '-qm', 'move reference after planning')
    b = out(p, 'rev-parse', 'HEAD')
    q = wt(p, 'pin-sha', a)
    r = wt(p, 'pin-name', 'main')
    assert out(q, 'rev-parse', 'HEAD') == a
    assert out(r, 'rev-parse', 'HEAD') == b and a != b
    return dict(planned=a, moved=b, pinnedChild=out(q, 'rev-parse', 'HEAD'),
                symbolicChild=out(r, 'rev-parse', 'HEAD'))

def shared():
    p = repo('shared-parent')
    q, r = wt(p, 'shared-a'), wt(p, 'shared-b')
    common = [out(x, 'rev-parse', '--path-format=absolute', '--git-common-dir') for x in (p, q, r)]
    indexes = [out(x, 'rev-parse', '--path-format=absolute', '--git-path', 'index') for x in (p, q, r)]
    git(q, 'config', '--local', 'm14.fixture', 'visible-to-siblings')
    assert len(set(common)) == 1 and len(set(indexes)) == 3
    assert out(r, 'config', '--local', 'm14.fixture') == 'visible-to-siblings'
    duplicate = git(p, 'worktree', 'add', '--', str(ROOT / 'same-branch'), 'shared-a', ok=False)
    assert duplicate.returncode != 0
    return dict(commonDirs=common, indexes=indexes, duplicateBranchCode=duplicate.returncode,
                configShared=True)

def dirty_remove():
    p = repo('remove-parent')
    q = wt(p, 'remove-dirty')
    write(q, 'tracked.txt', 'unintegrated\n')
    denied = git(p, '-c', 'status.showUntrackedFiles=normal', 'worktree', 'remove', '--', str(q), ok=False)
    assert denied.returncode != 0 and (q / 'tracked.txt').read_text() == 'unintegrated\n'
    return dict(code=denied.returncode, retained=True)

def hidden_untracked():
    p = repo('untracked-parent')
    q = wt(p, 'untracked-unsafe')
    write(q, 'new.txt', 'untracked result\n')
    unsafe = git(p, '-c', 'status.showUntrackedFiles=no', 'worktree', 'remove', '--', str(q), ok=False)
    assert unsafe.returncode == 0 and not q.exists()
    r = wt(p, 'untracked-guarded')
    write(r, 'new.txt', 'untracked result\n')
    git(p, 'config', '--local', 'status.showUntrackedFiles', 'no')
    safe = git(p, '-c', 'status.showUntrackedFiles=normal', 'worktree', 'remove', '--', str(r), ok=False)
    assert safe.returncode != 0 and (r / 'new.txt').exists()
    return dict(negativeControlDeleted=True, negativeCode=unsafe.returncode,
                t3ArgumentProtected=True, guardedCode=safe.returncode)

def committed_unmerged():
    p = repo('unmerged-parent')
    q = wt(p, 'unmerged-child')
    write(q, 'result.txt', 'committed but not integrated\n')
    git(q, 'add', '.')
    git(q, 'commit', '-qm', 'child result')
    sha = out(q, 'rev-parse', 'HEAD')
    assert out(q, 'status', '--porcelain') == ''
    unmerged = git(p, 'merge-base', '--is-ancestor', sha, 'main', ok=False)
    assert unmerged.returncode == 1
    git(p, '-c', 'status.showUntrackedFiles=normal', 'worktree', 'remove', '--', str(q))
    assert not q.exists() and out(p, 'rev-parse', 'unmerged-child') == sha
    denied = git(p, 'branch', '-d', 'unmerged-child', ok=False)
    assert denied.returncode != 0
    return dict(cleanButUnmerged=True, nativeRemovalSucceeded=True, retainedBranch=sha,
                safeBranchDeleteCode=denied.returncode)

def ignored_remove():
    p = repo('ignored-parent')
    q = wt(p, 'ignored-child')
    write(q, 'ignored/result.txt', 'important fixture artifact\n')
    normal = out(q, 'status', '--porcelain', '-uall')
    ignored = out(q, 'status', '--porcelain', '--ignored', '-uall')
    assert normal == '' and 'ignored/result.txt' in ignored
    git(p, '-c', 'status.showUntrackedFiles=normal', 'worktree', 'remove', '--', str(q))
    assert not q.exists()
    return dict(negativeControl=True, normalStatus=normal, ignoredStatus=ignored,
                artifactDeletedByOrdinaryRemoval=True)

def conflict():
    p = repo('conflict-parent')
    q, r = wt(p, 'conflict-a'), wt(p, 'conflict-b')
    for x, text in ((q, 'child A\n'), (r, 'child B\n')):
        write(x, 'tracked.txt', text)
        git(x, 'add', '.')
        git(x, 'commit', '-qm', text.strip())
    heads = {x.name: out(x, 'rev-parse', 'HEAD') for x in (q, r)}
    git(p, 'merge', '--ff-only', 'conflict-a')
    failed = git(p, 'merge', '--no-edit', 'conflict-b', ok=False)
    assert failed.returncode != 0 and out(p, 'ls-files', '-u')
    git(p, 'merge', '--abort')
    assert (p / 'tracked.txt').read_text() == 'child A\n'
    assert (r / 'tracked.txt').read_text() == 'child B\n'
    assert {x.name: out(x, 'rev-parse', 'HEAD') for x in (q, r)} == heads
    return dict(conflictCode=failed.returncode, childHeadsRetained=heads,
                parentAfterAbort='child A', siblingPreserved=True)

def hook_failure():
    p = repo('hook-parent')
    hook = p / '.git/hooks/post-checkout'
    hook.write_text('#!/bin/sh\nprintf "hook started\\n" > hook-started.txt\nexit 19\n')
    hook.chmod(0o755)
    q = ROOT / 'hook-child'
    result = git(p, 'worktree', 'add', '-b', 'hook-child', '--', str(q), 'HEAD', ok=False)
    assert result.returncode != 0 and q.exists()
    listing = out(p, 'worktree', 'list', '--porcelain')
    assert str(q) in listing and (q / 'hook-started.txt').exists()
    branch_delete = git(p, 'branch', '-D', 'hook-child', ok=False)
    assert branch_delete.returncode != 0
    hook.unlink()
    return dict(code=result.returncode, createdDespiteFailure=True, listing=listing,
                checkedOutBranchCannotDelete=branch_delete.returncode)

def submodule():
    source = repo('submodule-source')
    p = repo('submodule-parent')
    git(p, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--', str(source), 'deps/local')
    git(p, 'commit', '-qm', 'pin local submodule')
    write(p / 'deps/local', 'tracked.txt', 'parent submodule dirty\n')
    before = (p / 'deps/local/tracked.txt').read_bytes()
    q = wt(p, 'submodule-child')
    assert not (q / 'deps/local/tracked.txt').exists()
    before_status = out(q, 'submodule', 'status')
    git(q, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '--recursive')
    assert (q / 'deps/local/tracked.txt').read_text() == 'base\n'
    assert (p / 'deps/local/tracked.txt').read_bytes() == before
    return dict(beforeInitialization=before_status, afterInitialization=out(q, 'submodule', 'status'),
                parentSubmoduleDirtyPreserved=True, dirtySubmoduleNotTransferred=True)

def locked():
    p = repo('locked-parent')
    q = wt(p, 'locked-child')
    git(p, 'worktree', 'lock', '--reason', 'fixture ownership hold', str(q))
    denied = git(p, 'worktree', 'remove', '--force', '--', str(q), ok=False)
    assert denied.returncode != 0 and q.exists()
    return dict(singleForceCode=denied.returncode, retained=True)

def dirty_merge():
    p = repo('dirty-merge-parent')
    q = wt(p, 'dirty-merge-child')
    write(q, 'tracked.txt', 'child commit\n')
    git(q, 'add', '.')
    git(q, 'commit', '-qm', 'child commit')
    write(p, 'tracked.txt', 'parent uncommitted\n')
    before = fingerprint(p)
    denied = git(p, 'merge', '--ff-only', 'dirty-merge-child', ok=False)
    assert denied.returncode != 0 and fingerprint(p) == before
    return dict(mergeCode=denied.returncode, parentUnchanged=True,
                childCommit=out(q, 'rev-parse', 'HEAD'))

case('J01', 'Committed worktree excludes all parent dirty layers and preserves parent', baseline)
case('J02', 'Resolved commit remains stable when symbolic ref moves', pinned)
case('J03', 'Independent indexes but shared Git metadata and branch restrictions', shared)
case('J04', 'Ordinary removal rejects tracked dirty result', dirty_remove)
case('J05', 'Hidden untracked negative control and T3 explicit status argument', hidden_untracked)
case('J06', 'Clean unmerged child can be removed; branch retention remains necessary', committed_unmerged)
case('J07', 'Ignored artifacts disappear under ordinary removal negative control', ignored_remove)
case('J08', 'Conflicting sibling results survive failed integration and abort', conflict)
case('J09', 'Failed checkout hook leaves registered worktree and branch', hook_failure)
case('J10', 'Submodule initialization and dirty submodule boundary', submodule)
case('J11', 'Locked worktree resists single force removal', locked)
case('J12', 'Integration refuses conflicting parent dirty contents without loss', dirty_merge)

summary = dict(kind='native-git-isolated-probe-not-product-acceptance',
               git=out(ROOT, '--version'), fixture=str(ROOT),
               passed=sum(r['status'] == 'passed' for r in results), total=len(results),
               results=results, fixtureRetained=True,
               noExternalNetwork=True, noAppServiceExecuted=True)
(OUT / 'result.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
(OUT / 'commands.json').write_text(json.dumps(commands, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k:v for k,v in summary.items() if k != 'results'}, ensure_ascii=False))
raise SystemExit(0 if summary['passed'] == summary['total'] else 1)
