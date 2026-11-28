"""Read-only aggregate and site-state evidence from this exact fresh fixture DB."""
import json
import os
import pathlib
import re
import sqlite3
import stat
import sys

root, path, mode = sys.argv[1:]
assert re.fullmatch(r"/private/tmp/willyou-m16-b08-permission-c28-[A-Za-z0-9]+", root)
assert path == root + "/data/smartdd.db"
for directory in (root, root + "/data"):
    info = os.lstat(directory)
    assert os.path.realpath(directory) == directory and stat.S_ISDIR(info.st_mode)
    assert info.st_mode & 0o077 == 0
assert os.path.realpath(path) == path and stat.S_ISREG(os.lstat(path).st_mode)
assert mode in ("live", "closed")
if mode == "closed":
    assert not os.path.exists(path + "-wal") and not os.path.exists(path + "-shm")
uri = pathlib.Path(path).as_uri() + "?mode=ro" + ("&immutable=1" if mode == "closed" else "")
with sqlite3.connect(uri, uri=True, timeout=2) as db:
    db.execute("PRAGMA query_only=ON")
    count = lambda query: db.execute(query).fetchone()[0]
    rows = db.execute("SELECT key,value FROM app_settings WHERE key LIKE 'browserProfileState.v1:%'").fetchall()
    states = [{"profileId": key[len("browserProfileState.v1:"):], "state": json.loads(value)}
              for key, value in rows]
    result = {
        "secretCount":count("SELECT count(*) FROM app_secrets"),
        "providerSecretCount":count("SELECT count(*) FROM ai_providers WHERE secret_ref IS NOT NULL"),
        "taskCount":count("SELECT count(*) FROM tasks"),
        "providerCount":count("SELECT count(*) FROM ai_providers"),
        "agentTurns":count("SELECT count(*) FROM agent_turns"),
        "browserWorkspaceCount":count("SELECT count(*) FROM app_settings WHERE key LIKE 'browserWorkspace.v1:%'"),
        "states":states
    }
    if mode == "closed":
        result["quickCheck"] = db.execute("PRAGMA quick_check").fetchone()[0]
    print(json.dumps(result, ensure_ascii=False))
