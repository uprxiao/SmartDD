"""P2：交互模式下 claude --session-id 是否按指定 ID 落盘。
用伪终端驱动 TUI；遇到信任弹窗直接中止，不代答。"""
import glob, os, pty, select, sys, time, uuid

cwd = sys.argv[1]
sid = str(uuid.uuid4())
env = {k: os.environ[k] for k in ('HOME', 'USER', 'LOGNAME', 'LANG') if k in os.environ}
env.update(SHELL='/bin/zsh', TERM='xterm-256color', PATH='/usr/bin:/bin:/usr/sbin:/sbin')
argv = ['/bin/zsh', '-l', '-i', '-c', 'exec "$0" "$@"', 'claude', '--session-id', sid]

pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execve(argv[0], argv, env)

buf = b''
def pump(seconds):
    global buf
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.3)
        if r:
            try:
                buf += os.read(fd, 65536)
            except OSError:
                return

def session_file():
    hits = glob.glob(os.path.expanduser(f'~/.claude/projects/*/{sid}.jsonl'))
    return hits[0] if hits else None

pump(12)
text = buf.decode('utf-8', 'ignore')
if 'trust this folder' in text or 'Quick safety check' in text:
    print('TRUST_PROMPT: 出现信任弹窗，已中止')
    os.kill(pid, 9)
    sys.exit(2)
print('启动后会话文件：', session_file())

for ch in '只回复 OK 两个字母，不要调用任何工具':
    os.write(fd, ch.encode())
time.sleep(0.8)
os.write(fd, b'\r')

found = None
for _ in range(60):
    pump(1)
    found = session_file()
    if found and '"type":"assistant"' in open(found, encoding='utf-8').read():
        break
print('发消息后会话文件：', found)
if found:
    lines = open(found, encoding='utf-8').read().splitlines()
    types = [l.split('"type":"', 1)[1].split('"', 1)[0] for l in lines if '"type":"' in l]
    print('行数：', len(lines), '类型：', sorted(set(types)))
    print('含 sessionId：', f'"sessionId":"{sid}"' in open(found, encoding='utf-8').read())

os.write(fd, b'/exit\r')
pump(3)
try:
    os.kill(pid, 9)
except ProcessLookupError:
    pass
print('SID', sid)
