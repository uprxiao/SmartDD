"""Create the exact A34 size/count boundary in a private local SVN worktree."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

prep = Path(sys.argv[1]).resolve()
assert prep.is_dir() and re.fullmatch(r"/private/tmp/willyou-m14-stage6\.[A-Za-z0-9]{6}/g04/a34-prep",str(prep))
marker = prep / "fixture-10gib.json"
assert not marker.exists()
target = 10 * 2**30
reserve = 4 * 2**30
assert shutil.disk_usage(prep).free >= target + reserve
root = Path(tempfile.mkdtemp(prefix="svn-sample-", dir=prep))
try:
    env = {"HOME":str(root / "home"),"PATH":"/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin","TMPDIR":str(root)}
    (root / "home").mkdir()
    wc = root / "wc"
    def run(*args):
        result = subprocess.run(args,cwd=root,env=env,text=True,capture_output=True,timeout=30)
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()
    repo = root / "svn-repository"
    run("/opt/homebrew/bin/svnadmin","create",str(repo))
    run("/opt/homebrew/bin/svn","checkout","--non-interactive",repo.as_uri(),str(wc))
    seed = wc / "versioned-seed.txt"
    seed.write_bytes(b"synthetic versioned seed\n")
    run("/opt/homebrew/bin/svn","add",str(seed))
    run("/opt/homebrew/bin/svn","commit","--non-interactive","-m","synthetic A34 seed",str(wc))
    seed_size = seed.stat().st_size
    allocated = seed.stat().st_blocks * 512
    logical = seed_size
    started = time.monotonic()
    for i in range(20_480):
        if i % 1024 == 0:
            assert shutil.disk_usage(prep).free >= reserve
        directory = wc / "src" / f"{i // 128:04}"
        directory.mkdir(parents=True,exist_ok=True)
        file = directory / f"file-{i:05}.txt"
        line = f'const item_{i:05} = "{hashlib.sha256(str(i).encode()).hexdigest()}";\n'.encode()
        size = 524_288 - (seed_size if i == 20_479 else 0)
        with file.open("xb") as stream:
            stream.write((line * (size // len(line) + 1))[:size])
        fact = file.stat()
        logical += fact.st_size
        allocated += fact.st_blocks * 512
    assert logical == target and allocated >= target
    assert not (wc / ".git").exists() and (wc / ".svn/wc.db").is_file()
    result = {"root":str(root),"privateCwd":str(wc),"files":20_481,"logicalBytes":logical,"allocatedBytes":allocated,
              "svnVersion":run("/opt/homebrew/bin/svn","--version","--quiet"),"versionedFiles":1,"freeBytesAfter":shutil.disk_usage(prep).free,
              "fixtureSeconds":round(time.monotonic()-started,3),"svnMetadataSha256":hashlib.sha256((wc/".svn/wc.db").read_bytes()).hexdigest()}
    with marker.open("x") as stream:
        json.dump(result,stream,ensure_ascii=False,indent=2)
        stream.write("\n")
    print(json.dumps(result))
except BaseException:
    shutil.rmtree(root)
    raise
