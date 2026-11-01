# 交互式 Codex 的最小 PTY 驱动：只回应终端查询（光标位置、设备属性、颜色），不替用户作任何选择。
import os, pty, sys, select, signal, fcntl, termios, struct
log, cmd = sys.argv[1], sys.argv[sys.argv.index('--') + 1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 220, 0, 0))
def stop(*_):
    try: os.killpg(os.getpgid(pid), signal.SIGTERM)
    except Exception: pass
    try: os.kill(pid, signal.SIGTERM)
    except Exception: pass
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
replies = {b'\x1b[6n': b'\x1b[1;1R', b'\x1b[c': b'\x1b[?1;2c', b'\x1b]10;?': b'\x1b]10;rgb:ffff/ffff/ffff\x1b\\', b'\x1b]11;?': b'\x1b]11;rgb:0000/0000/0000\x1b\\'}
with open(log, 'ab') as out:
    while True:
        r, _, _ = select.select([fd], [], [], 0.5)
        if fd in r:
            try: data = os.read(fd, 65536)
            except OSError: break
            if not data: break
            out.write(data); out.flush()
            for q, a in replies.items():
                if q in data: os.write(fd, a)
        try:
            if os.waitpid(pid, os.WNOHANG)[0] == pid: break
        except ChildProcessError: break
