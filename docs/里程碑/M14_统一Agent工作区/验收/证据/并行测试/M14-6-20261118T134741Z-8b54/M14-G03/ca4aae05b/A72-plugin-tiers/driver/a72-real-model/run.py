import hashlib, os, subprocess, sys
from pathlib import Path
base = Path('/private/tmp/willyou-m14-stage6.WRvdST')
number, commit, digest = sys.argv[1], sys.argv[2], sys.argv[3]
assert number.isdigit() and len(commit) == 40 and len(digest) == 64
assert (base / 'source-commit.txt').read_text().strip() == commit
app = base / 'package/mac-arm64/WillYou.app/Contents'
exe = app / 'MacOS/WillYou'
with (app / 'Resources/app.asar').open('rb') as f:
    assert hashlib.file_digest(f, 'sha256').hexdigest() == digest
attempt = base / f'g03/attempt-{number}'
assert not attempt.exists()
driver = Path(__file__).resolve().with_name('a72-real-model.mjs')
node = '/Users/liubu/.local/bin/node'
subprocess.run([node, '--check', str(driver)], check=True)
subprocess.run([node, 'scripts/lib/check-cdp-expressions.mjs', str(driver)], check=True)
assert subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:3425', '-sTCP:LISTEN'], check=False, capture_output=True).returncode == 1
env = {
    'PATH': '/Users/liubu/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    'LANG': 'en_US.UTF-8', 'TMPDIR': '/private/tmp',
    'M14_G03_AUTHORIZED_REAL_GATEWAY': '1',
    'M14_LIVE_DEEPSEEK_KEY': os.environ['DEEPSEEK_API_KEY'],
    'M14_SMOKE_CLAUDE': '/Users/liubu/.local/share/claude/versions/2.1.326',
    'M14_ACCEPTANCE_APP': str(exe), 'M14_EXPECTED_ASAR_SHA256': digest,
}
os.execve(node, [node, str(driver), str(attempt), commit], env)
