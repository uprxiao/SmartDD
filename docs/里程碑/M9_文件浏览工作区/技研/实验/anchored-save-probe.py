#!/usr/bin/env python3
"""M9-GAP-08 隔离实验：针对 FS08（校验后、rename 前被外部写入）与 FS09（父目录被换成 symlink）的保护方案。

只用 Python 标准库（os.open/dir_fd/ctypes），在随机临时目录里运行，不读取用户文件，不连接任何服务。
本脚本验证的是“native 保存代理”的可行性：
  A. 目录句柄锚定：从根 fd 逐级 openat(O_NOFOLLOW|O_DIRECTORY)，之后所有写入/rename 都用 dir_fd，
     父目录事后被替换成 symlink 也不会越出根。
  B. 交换式提交：写临时文件 → renameatx_np(RENAME_SWAP) 与目标交换 → 对被换下的旧 inode 重算 hash，
     与基线不符则换回并报告冲突。把 FS08 的“静默覆盖”变为“检测并还原”。
  C. 边界负对照：仍然无法保护的情形（交换之后、还原之前的窗口；不合作写入者在交换后按路径打开新文件）。

结果写入 --output JSON；每个用例 status ∈ passed / observed-gap / failed / skipped。
仅在 macOS 验证 RENAME_SWAP（Linux 对应 renameat2(RENAME_EXCHANGE)，未在本机验证，标记 skipped）。
"""
import argparse, ctypes, ctypes.util, hashlib, json, os, platform, shutil, sys, tempfile, time

RENAME_SWAP = 0x2  # macOS renamex_np / renameatx_np flag
libc = ctypes.CDLL(ctypes.util.find_library('c'), use_errno=True)
HAS_SWAP = sys.platform == 'darwin' and hasattr(libc, 'renameatx_np')


def swap_at(dir_fd, a, b):
    """原子交换同目录下两个名字指向的 inode。失败抛 OSError。"""
    if not HAS_SWAP:
        raise OSError(0, 'RENAME_SWAP unavailable on this platform')
    libc.renameatx_np.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    if libc.renameatx_np(dir_fd, a.encode(), dir_fd, b.encode(), RENAME_SWAP) != 0:
        e = ctypes.get_errno(); raise OSError(e, os.strerror(e))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_at(dir_fd, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd)
    try:
        with os.fdopen(fd, 'rb', closefd=False) as f:
            return f.read()
    finally:
        os.close(fd)


def open_anchored(root_fd, parts):
    """从根 fd 逐级打开目录；任一级为 symlink 或非目录即失败（不跟随）。返回需调用者关闭的 fd 链最后一个。"""
    fds = []
    cur = root_fd
    try:
        for p in parts:
            nxt = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=cur)
            fds.append(nxt); cur = nxt
    except OSError:
        for f in fds: os.close(f)
        raise
    return cur, fds


def anchored_save(root_fd, parts, name, new_bytes, base_hash, *, before_swap=None, after_swap=None):
    """交换式提交。返回 dict(status=saved|conflict, ...)。before_swap/after_swap 是测试注入点。"""
    dir_fd, chain = open_anchored(root_fd, parts)
    tmp = f'.{name}.m9tmp-{os.getpid()}-{time.monotonic_ns()}'
    try:
        tfd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dir_fd)
        try:
            os.write(tfd, new_bytes); os.fsync(tfd)
            # 复制原文件 mode（不复制 ACL/xattr：见结论的限制）
            os.fchmod(tfd, os.stat(name, dir_fd=dir_fd, follow_symlinks=False).st_mode & 0o7777)
        finally:
            os.close(tfd)
        if before_swap: before_swap()
        swap_at(dir_fd, tmp, name)          # 现在 name→新内容；tmp→被换下的旧 inode
        if after_swap: after_swap()
        displaced = read_at(dir_fd, tmp)
        if sha(displaced) != base_hash:     # 校验后到交换前发生了外部写入：还原
            swap_at(dir_fd, tmp, name)      # 换回：name→外部写入的内容
            os.unlink(tmp, dir_fd=dir_fd)
            return {'status': 'conflict', 'externalHash': sha(displaced)}
        os.unlink(tmp, dir_fd=dir_fd)
        # 提交后回读：内容不是我们写的，说明有人在交换之后按路径写入。不还原（对方内容更新），报冲突并保留本地草稿。
        try:
            if read_at(dir_fd, name) != new_bytes:
                return {'status': 'conflict', 'kind': 'overwritten-after-commit'}
        except OSError as e:
            return {'status': 'conflict', 'kind': 'readback-failed', 'errno': e.errno}
        return {'status': 'saved'}
    finally:
        try: os.unlink(tmp, dir_fd=dir_fd)
        except OSError: pass
        for f in reversed(chain): os.close(f)


def case(cases, cid, title, fn):
    t0 = time.perf_counter()
    try:
        status, evidence = fn()
    except Exception as e:  # noqa
        status, evidence = 'failed', {'exception': repr(e)}
    cases.append({'id': cid, 'title': title, 'status': status, 'durationMs': round((time.perf_counter() - t0) * 1000, 2), 'evidence': evidence})


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--output', required=True); args = ap.parse_args()
    started = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    base = tempfile.mkdtemp(prefix='m9-anchored-')
    cases = []
    try:
        outside = os.path.join(base, 'outside'); os.mkdir(outside)
        sentinel = os.path.join(outside, 'file.txt'); open(sentinel, 'wb').write(b'OUTSIDE-ORIGINAL')

        def fresh_root(name):
            r = os.path.join(base, name); os.makedirs(os.path.join(r, 'a', 'b')); open(os.path.join(r, 'a', 'b', 'file.txt'), 'wb').write(b'BASE')
            return r

        # ---- A1：FS09 重放。检查之后、写入之前，把父目录 a 换成指向根外的 symlink ----
        def a1():
            root = fresh_root('root-a1'); rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                dir_fd, chain = open_anchored(rfd, ['a', 'b'])      # “检查”：已持有目录 fd
                os.rename(os.path.join(root, 'a'), os.path.join(root, 'a.moved'))
                os.symlink(outside, os.path.join(root, 'a'))        # 攻击者替换父目录
                tfd = os.open('file.txt.tmp', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dir_fd)
                os.write(tfd, b'NEW'); os.close(tfd)
                os.rename('file.txt.tmp', 'file.txt', src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
                for f in reversed(chain): os.close(f)
                landed = open(os.path.join(root, 'a.moved', 'b', 'file.txt'), 'rb').read()
                outside_now = open(sentinel, 'rb').read()
                ok = landed == b'NEW' and outside_now == b'OUTSIDE-ORIGINAL' and not os.path.exists(os.path.join(outside, 'file.txt.tmp')) and not os.path.exists(os.path.join(outside, 'b'))
                return ('passed' if ok else 'failed'), {'landedInOriginalDirectory': landed.decode(), 'outsideSentinel': outside_now.decode(),
                        'note': '写入落在被持有 fd 指向的原目录（现名 a.moved），没有越出根；这是“不越界”而非“写到用户期望的路径”，调用方需在提交后复核根内路径身份'}
            finally:
                os.close(rfd)
        case(cases, 'AFS01', 'FS09 重放：目录 fd 锚定后父目录被换成 symlink，写入不越根', a1)

        # ---- A2：symlink 在“打开链”之前已存在，逐级 O_NOFOLLOW 必须拒绝 ----
        def a2():
            root = fresh_root('root-a2'); rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                shutil.rmtree(os.path.join(root, 'a')); os.symlink(outside, os.path.join(root, 'a'))
                try:
                    open_anchored(rfd, ['a', 'b']); return 'failed', {'unexpected': 'opened through symlink'}
                except OSError as e:
                    return 'passed', {'errno': e.errno, 'name': os.strerror(e.errno)}
            finally:
                os.close(rfd)
        case(cases, 'AFS02', '已存在的目录 symlink 被逐级 O_NOFOLLOW 拒绝', a2)

        # ---- A3：根自身被替换（FS03 同类）。持有的根 fd 仍指向原根，与路径身份对比可检测 ----
        def a3():
            root = fresh_root('root-a3'); rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                held = os.fstat(rfd); os.rename(root, root + '.old'); os.mkdir(root)
                now = os.stat(root)
                return ('passed' if (held.st_dev, held.st_ino) != (now.st_dev, now.st_ino) else 'failed'), {'sameIdentity': (held.st_dev, held.st_ino) == (now.st_dev, now.st_ino)}
            finally:
                os.close(rfd)
        case(cases, 'AFS03', '根目录被替换后 fd 身份与路径身份不同，可作为 lease 失效依据', a3)

        # ---- B1：无竞争保存 ----
        def b1():
            if not HAS_SWAP: return 'skipped', {'reason': 'RENAME_SWAP unavailable'}
            root = fresh_root('root-b1'); rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                r = anchored_save(rfd, ['a', 'b'], 'file.txt', b'SAVED', sha(b'BASE'))
                left = [n for n in os.listdir(os.path.join(root, 'a', 'b'))]
                got = open(os.path.join(root, 'a', 'b', 'file.txt'), 'rb').read()
                return ('passed' if r['status'] == 'saved' and got == b'SAVED' and left == ['file.txt'] else 'failed'), {'result': r, 'content': got.decode(), 'dirEntries': left}
            finally:
                os.close(rfd)
        case(cases, 'AFS04', '交换式提交：无竞争时保存成功且无临时文件残留', b1)

        # ---- B2：FS08 重放。外部写入发生在最终校验之后、交换之前（已打开旧 inode 的外部进程） ----
        def b2():
            if not HAS_SWAP: return 'skipped', {'reason': 'RENAME_SWAP unavailable'}
            root = fresh_root('root-b2'); rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            p = os.path.join(root, 'a', 'b', 'file.txt')
            ext = os.open(p, os.O_WRONLY)  # 外部写入者早已打开旧 inode（不合作写入者的常见形态：编辑器/构建进程持有的 fd）
            try:
                def inject():
                    os.pwrite(ext, b'EXTERNAL', 0)
                r = anchored_save(rfd, ['a', 'b'], 'file.txt', b'SAVED', sha(b'BASE'), before_swap=inject)
                got = open(p, 'rb').read()
                ok = r['status'] == 'conflict' and got == b'EXTERNAL'.ljust(4, b'\0')[:max(len(b'EXTERNAL'), 4)] and r.get('externalHash') == sha(b'EXTERNAL')
                return ('passed' if ok else 'failed'), {'result': r, 'finalContent': got.decode(errors='replace'),
                        'meaning': '旧实现(FS08)在此时间点静默覆盖外部写入；交换式提交检测到被换下的 inode 与基线不符，已换回外部内容并返回冲突'}
            finally:
                os.close(ext); os.close(rfd)
        case(cases, 'AFS05', 'FS08 重放：外部写入在最终校验之后、提交之前 → 检测、还原并返回冲突', b2)

        # ---- B3：外部写入者在交换之后仍写旧 inode（fd 已持有）。数据落到被换下的文件，随后被检测并还原 ----
        def b3():
            if not HAS_SWAP: return 'skipped', {'reason': 'RENAME_SWAP unavailable'}
            root = fresh_root('root-b3'); rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            p = os.path.join(root, 'a', 'b', 'file.txt')
            ext = os.open(p, os.O_WRONLY)
            try:
                r = anchored_save(rfd, ['a', 'b'], 'file.txt', b'SAVED', sha(b'BASE'), after_swap=lambda: os.pwrite(ext, b'LATE', 0))
                got = open(p, 'rb').read()
                return ('passed' if r['status'] == 'conflict' and got.startswith(b'LATE') else 'failed'), {'result': r, 'finalContent': got.decode(errors='replace')}
            finally:
                os.close(ext); os.close(rfd)
        case(cases, 'AFS06', '交换之后仍向旧 inode 写入的外部进程：数据被检测并还原，不丢失', b3)

        # ---- C1：交换后、校验前，另一进程按路径新建写入。提交后回读把“静默覆盖”变成冲突 ----
        def c1():
            if not HAS_SWAP: return 'skipped', {'reason': 'RENAME_SWAP unavailable'}
            root = fresh_root('root-c1'); rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            p = os.path.join(root, 'a', 'b', 'file.txt')
            try:
                def late_path_writer():
                    fd = os.open(p, os.O_WRONLY | os.O_TRUNC); os.write(fd, b'PATH-WRITER'); os.close(fd)
                r = anchored_save(rfd, ['a', 'b'], 'file.txt', b'SAVED', sha(b'BASE'), after_swap=late_path_writer)
                got = open(p, 'rb').read()
                ok = r['status'] == 'conflict' and r.get('kind') == 'overwritten-after-commit' and got == b'PATH-WRITER'
                return ('passed' if ok else 'failed'), {'result': r, 'finalContent': got.decode(errors='replace'),
                        'meaning': '提交后回读发现内容不是我们写的，返回 conflict（不再显示已保存）；对方内容保留，本地草稿由调用方保留'}
            finally:
                os.close(rfd)
        case(cases, 'AFS07', '交换后按路径新写入的进程：提交后回读报冲突，不再静默显示已保存', c1)

        # ---- C2：负对照。回读之后才发生的写入仍无法检测 ----
        def c2():
            if not HAS_SWAP: return 'skipped', {'reason': 'RENAME_SWAP unavailable'}
            root = fresh_root('root-c2'); rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            p = os.path.join(root, 'a', 'b', 'file.txt')
            try:
                r = anchored_save(rfd, ['a', 'b'], 'file.txt', b'SAVED', sha(b'BASE'))
                fd = os.open(p, os.O_WRONLY | os.O_TRUNC); os.write(fd, b'AFTER-READBACK'); os.close(fd)
                return 'observed-gap', {'result': r, 'finalContent': open(p, 'rb').read().decode(),
                        'meaning': '回读结束之后的写入属于“保存之后的新外改”，只能由 watch 发现；保存时刻无法区分。残余窗口缩小到回读与返回之间的几微秒级，未测量'}
            finally:
                os.close(rfd)
        case(cases, 'AFS10', '回读之后的外部写入：保存已成功，只能由监听发现（残余窗口）', c2)

        # ---- D1：并发保存的应用内串行与 opId 幂等（模型）----
        def d1():
            seen = {}
            def submit(op_id, fn):
                if op_id in seen: return seen[op_id]
                seen[op_id] = fn(); return seen[op_id]
            root = fresh_root('root-d1'); rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                r1 = submit('op-1', lambda: anchored_save(rfd, ['a', 'b'], 'file.txt', b'ONE', sha(b'BASE'))) if HAS_SWAP else {'status': 'skipped'}
                r2 = submit('op-1', lambda: (_ for _ in ()).throw(AssertionError('重复请求不应再次执行')))
                got = open(os.path.join(root, 'a', 'b', 'file.txt'), 'rb').read()
                return ('passed' if r1 is r2 and (got == b'ONE' or not HAS_SWAP) else 'failed'), {'sameResultObject': r1 is r2, 'content': got.decode()}
            finally:
                os.close(rfd)
        case(cases, 'AFS08', '重复/旧回执的保存请求按 opId 幂等返回，不重复落盘', d1)

        # ---- E1：fsync 与权限保持 ----
        def e1():
            if not HAS_SWAP: return 'skipped', {'reason': 'RENAME_SWAP unavailable'}
            root = fresh_root('root-e1'); p = os.path.join(root, 'a', 'b', 'file.txt'); os.chmod(p, 0o640)
            rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                anchored_save(rfd, ['a', 'b'], 'file.txt', 'BOM中文\r\n'.encode('utf-8'), sha(b'BASE'))
                st = os.stat(p)
                return ('passed' if oct(st.st_mode & 0o7777) == '0o640' and open(p, 'rb').read() == 'BOM中文\r\n'.encode() else 'failed'), {'mode': oct(st.st_mode & 0o7777), 'limits': '不保持 ACL/xattr/owner；未做目录 fsync 与断电耐久性验证'}
            finally:
                os.close(rfd)
        case(cases, 'AFS09', '保存保持 mode 与字节（CRLF/中文）；ACL、xattr、owner、目录 fsync 不在保证内', e1)
    finally:
        shutil.rmtree(base, ignore_errors=True)

    summary = {}
    for c in cases: summary[c['status']] = summary.get(c['status'], 0) + 1
    report = {'schemaVersion': 1, 'startedAt': started, 'scriptSha256': hashlib.sha256(open(__file__, 'rb').read()).hexdigest(),
              'environment': {'python': platform.python_version(), 'platform': sys.platform, 'machine': platform.machine(), 'osRelease': platform.release(), 'hasRenameSwap': HAS_SWAP},
              'scope': 'Synthetic temporary directories; Python/dir_fd native-agent prototype; no Electron IPC or production implementation',
              'cases': cases, 'fixtureCleanup': {'removed': not os.path.exists(base)}, 'completedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'summary': summary}
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False))
    for c in cases: print(c['id'], c['status'], c['title'])
    return 1 if summary.get('failed') else 0


if __name__ == '__main__':
    sys.exit(main())
