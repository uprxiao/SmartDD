#!/usr/bin/env python3
"""R3.4 synthetic macOS save-race experiment; not a production save broker.

An exchange is NOT compare-and-swap. Never blindly exchange again on conflict:
another writer may already have changed the new inode. Keep a recovery journal,
the displaced inode, and a separate immutable draft. No user files are accessed.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import platform
import stat
import tempfile
import time
import uuid

HERE = pathlib.Path(__file__).resolve()
spec = importlib.util.spec_from_file_location('m9_old_save', HERE.with_name('anchored-save-probe.py'))
old = importlib.util.module_from_spec(spec); spec.loader.exec_module(old)
sha = old.sha


def full_write(fd, data):
    rest = memoryview(data)
    while rest:
        count = os.write(fd, rest)
        if count <= 0: raise OSError('short write')
        rest = rest[count:]
    os.fsync(fd)


def journal_save(root, name, draft, base_hash, before_swap=None, after_swap=None):
    if not name or name in ('.', '..') or '/' in name or '\x00' in name:
        raise ValueError('invalid leaf name')
    rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        target = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=rfd)
        try:
            info = os.fstat(target)
            if not stat.S_ISREG(info.st_mode): raise ValueError('not a regular file')
            base = old.read_at(rfd, name)
            if sha(base) != base_hash: return {'status': 'conflict-before-commit'}
        finally: os.close(target)
        try: os.mkdir('.m9-recovery', mode=0o700, dir_fd=rfd)
        except FileExistsError: pass
        jfd = os.open('.m9-recovery', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=rfd)
        token = str(uuid.uuid4()); staging = '.m9-stage-' + token
        draft_name = token + '.draft'; original_name = token + '.original'
        record_name = token + '.json'
        try:
            # Draft exists durably before target mutation. It is never used as the
            # new target inode, so a writer opening the target cannot mutate it.
            for parent, leaf, data in [(jfd, draft_name, draft), (rfd, staging, draft)]:
                fd = os.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
                try:
                    if parent == rfd: os.fchmod(fd, stat.S_IMODE(info.st_mode))
                    full_write(fd, data)
                finally: os.close(fd)
            record = {'opId': token, 'leaf': name, 'draft': draft_name, 'displaced': original_name,
                      'staging': staging, 'baseHash': base_hash, 'draftHash': sha(draft), 'state': 'prepared'}
            fd = os.open(record_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=jfd)
            try: full_write(fd, json.dumps(record).encode())
            finally: os.close(fd)
            os.fsync(jfd); os.fsync(rfd)
            if before_swap: before_swap()
            old.swap_at(rfd, staging, name)
            if after_swap: after_swap()
            # Keep the inode, not just bytes read once: existing external fds may
            # still write it later. No second exchange and no deletion here.
            os.rename(staging, original_name, src_dir_fd=rfd, dst_dir_fd=jfd)
            os.fsync(jfd); os.fsync(rfd)
            displaced = old.read_at(jfd, original_name)
            current = old.read_at(rfd, name)
            same_path = (os.fstat(rfd).st_dev, os.fstat(rfd).st_ino) == (os.stat(root).st_dev, os.stat(root).st_ino)
            conflict = sha(displaced) != base_hash or current != draft or not same_path
            return {'status': 'conflict-recovery' if conflict else 'saved', 'sameDirectoryIdentity': same_path,
                    'displacedPath': str(root / '.m9-recovery' / original_name),
                    'draftPath': str(root / '.m9-recovery' / draft_name), 'journalPath': str(root / '.m9-recovery' / record_name),
                    'displacedHash': sha(displaced), 'currentHash': sha(current),
                    'automaticRollback': False, 'powerLossDurability': 'not-proved'}
        finally: os.close(jfd)
    finally: os.close(rfd)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--output', required=True); args = ap.parse_args()
    report = {'revision': 'R3.4', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'scriptSha256': sha(HERE.read_bytes()), 'environment': platform.platform(),
              'scope': 'Synthetic macOS save-race/recovery feasibility. Not production, cross-platform, ACL/xattr or power-loss acceptance.', 'cases': []}
    def case(cid, title, fn, status='passed'):
        try: evidence = fn(); actual = status
        except Exception as e: evidence = {'error': repr(e)}; actual = 'failed'
        report['cases'].append({'id': cid, 'title': title, 'status': actual, 'evidence': evidence})
    with tempfile.TemporaryDirectory(prefix='m9-recovery-') as tmp:
        temp = pathlib.Path(tmp)
        def fresh(n):
            p = temp / n; p.mkdir(); (p/'file.txt').write_bytes(b'BASE'); return p
        def baseline():
            p = fresh('success'); result = journal_save(p, 'file.txt', b'DRAFT', sha(b'BASE'))
            assert result['status'] == 'saved' and (p/'file.txt').read_bytes() == b'DRAFT'
            assert pathlib.Path(result['displacedPath']).read_bytes() == b'BASE'
            assert pathlib.Path(result['draftPath']).read_bytes() == b'DRAFT'
            assert stat.S_IMODE((p/'.m9-recovery').stat().st_mode) == 0o700
            return result
        case('SR01', '成功保存仍保留独立草稿与被换下inode，恢复区权限受限', baseline)
        def old_race():
            p = fresh('old-race'); rfd = os.open(p, os.O_RDONLY | os.O_DIRECTORY)
            ext = os.open(p/'file.txt', os.O_WRONLY)
            try:
                def race(): os.pwrite(ext, b'EXTERNAL-OLD', 0); (p/'file.txt').write_bytes(b'EXTERNAL-NEW')
                result = old.anchored_save(rfd, [], 'file.txt', b'DRAFT', sha(b'BASE'), after_swap=race)
                got = (p/'file.txt').read_bytes()
                assert result['status'] == 'conflict' and got == b'EXTERNAL-OLD'
                assert all(f.read_bytes() != b'EXTERNAL-NEW' for f in p.iterdir() if f.is_file())
                return {'result': result, 'lostNewerPathWrite': True, 'final': got.decode(), 'meaning': '旧自动换回删除了新路径写入；此负对照不能列为保护通过'}
            finally: os.close(ext); os.close(rfd)
        case('SR02', '负对照：旧自动换回遇到两个写入者会丢失较新的路径内容', old_race, 'observed-gap')
        def double_race():
            p = fresh('two-writers'); ext = os.open(p/'file.txt', os.O_WRONLY)
            try:
                def race(): os.pwrite(ext, b'EXTERNAL-OLD', 0); (p/'file.txt').write_bytes(b'EXTERNAL-NEW')
                result = journal_save(p, 'file.txt', b'DRAFT', sha(b'BASE'), after_swap=race)
                assert result['status'] == 'conflict-recovery'
                assert (p/'file.txt').read_bytes() == b'EXTERNAL-NEW'
                assert pathlib.Path(result['displacedPath']).read_bytes() == b'EXTERNAL-OLD'
                assert pathlib.Path(result['draftPath']).read_bytes() == b'DRAFT'
                return {**result, 'allThreeVersionsPreserved': True}
            finally: os.close(ext)
        case('SR03', '两个写入者冲突：保留新路径、旧inode和我的草稿，不自动换回', double_race)
        def late_fd():
            p = fresh('late-fd'); ext = os.open(p/'file.txt', os.O_WRONLY)
            try:
                result = journal_save(p, 'file.txt', b'DRAFT', sha(b'BASE'))
                os.pwrite(ext, b'AFTER-RETURN', 0)
                assert pathlib.Path(result['displacedPath']).read_bytes() == b'AFTER-RETURN'
                assert (p/'file.txt').read_bytes() == b'DRAFT'
                return {'lateWriteRecoverable': True, 'detectionNeedsJournalWatchOrRescan': True, 'unboundedExternalFdLifetime': 'cannot-prove-safe-time-to-delete'}
            finally: os.close(ext)
        case('SR04', '旧fd在返回后继续写入仍有可恢复inode；不能过早回收日志', late_fd)
        def stale():
            p = fresh('stale'); (p/'file.txt').write_bytes(b'EXTERNAL')
            result = journal_save(p, 'file.txt', b'DRAFT', sha(b'BASE'))
            assert result['status'] == 'conflict-before-commit' and (p/'file.txt').read_bytes() == b'EXTERNAL'
            assert not (p/'.m9-recovery').exists()
            return result
        case('SR05', '提交前已知版本不符不触碰目标，也不创建恢复垃圾', stale)
        def symlink():
            p = fresh('symlink'); outside = temp/'outside'; outside.write_bytes(b'OUTSIDE')
            (p/'file.txt').unlink(); (p/'file.txt').symlink_to(outside)
            try: journal_save(p, 'file.txt', b'DRAFT', sha(b'BASE')); raise AssertionError('followed link')
            except OSError: pass
            assert outside.read_bytes() == b'OUTSIDE' and not (p/'.m9-recovery').exists()
            return {'rejected': True, 'outsideUnchanged': True}
        case('SR06', '目标为symlink时在首次写入前拒绝', symlink)
        def crash():
            p = fresh('crash')
            def interrupt(): raise RuntimeError('simulated interruption immediately after exchange')
            try: journal_save(p, 'file.txt', b'DRAFT', sha(b'BASE'), after_swap=interrupt); raise AssertionError('not interrupted')
            except RuntimeError: pass
            record = json.loads(next((p/'.m9-recovery').glob('*.json')).read_text())
            assert (p/record['staging']).read_bytes() == b'BASE'
            assert (p/'.m9-recovery'/record['draft']).read_bytes() == b'DRAFT'
            assert (p/'file.txt').read_bytes() == b'DRAFT'
            return {'journalState': record['state'], 'originalAndDraftRecoverable': True, 'recoveryMustReconcileInodeAndHash': True, 'actualProcessKill': False}
        case('SR07', '交换后异常不清除恢复物，准备日志可定位三个版本', crash)
        def before_commit():
            p = fresh('race-before'); result = journal_save(p, 'file.txt', b'DRAFT', sha(b'BASE'), before_swap=lambda: (p/'file.txt').write_bytes(b'BETWEEN-CHECK-AND-SWAP'))
            assert result['status'] == 'conflict-recovery'
            assert pathlib.Path(result['displacedPath']).read_bytes() == b'BETWEEN-CHECK-AND-SWAP'
            return {**result, 'externalRecoverableButNotAutomaticallyRestoredAtTarget': True}
        case('SR08', '校验和交换之间的外改进入恢复冲突，不承诺自动还原到路径', before_commit)
    report['summary'] = {k: sum(c['status'] == k for c in report['cases']) for k in ['passed', 'observed-gap', 'failed']}
    report['limits'] = ['No OS-level CAS', 'An external process can mutate/unlink any accessible journal; not adversarial OS isolation',
                        'No safe finite deletion time for an externally held fd; production needs quota/retention/conflict UX',
                        'Directory fsync requested but power-loss/full-disk/native crash not tested', 'ACL/xattr/owner and Linux/Windows remain unverified']
    pathlib.Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report['summary'])); return bool(report['summary']['failed'])


if __name__ == '__main__': raise SystemExit(main())
