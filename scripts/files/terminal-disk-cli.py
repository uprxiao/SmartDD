"""Real, bounded test CLI for Y28. Reads explicit user lines from a real PTY.

Only its cwd's synthetic files are writable; never invokes a model or shell.
The App does not approve, perform, or acknowledge this program's filesystem IO.
"""
import hashlib
import json
import os
from pathlib import Path
import select
import sys
import time

if "--version" in sys.argv:
    print("WillYou isolated disk CLI 1.0")
    sys.exit(0)
if not os.isatty(0):
    print("SMARTDD_OK: isolated disk CLI requires an interactive PTY")
    sys.exit(0)

state_dir = Path(sys.argv[1])
state_dir.mkdir(parents=True, exist_ok=True)
root = Path.cwd().resolve()
state = {"pid": os.getpid(), "cwd": str(root), "tty": True, "receipts": [], "outputTicks": 0, "ready": True}


def persist():
    temporary = state_dir / "state.pending.json"
    temporary.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    temporary.replace(state_dir / "state.json")


def target(relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError("Only this synthetic project cwd")
    return path


def execute(command):
    op = command["op"]
    if op == "batch":
        directory = target(command["directory"])
        value = command["value"].encode("utf-8")
        for name in ["opened.txt", "unopened.txt", "created.txt"]:
            (directory / name).write_bytes(value + name.encode("ascii") + b"\n")
        (directory / "deleted.txt").unlink()
        receipt = {"id": command["id"], "op": op, "files": {
            name: hashlib.sha256((directory / name).read_bytes()).hexdigest()
            for name in ["opened.txt", "unopened.txt", "created.txt"]}}
    elif op == "write":
        path = target(command["path"])
        path.write_bytes(command["value"].encode("utf-8"))
        receipt = {"id": command["id"], "op": op, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    elif op == "exit":
        receipt = {"id": command["id"], "op": op}
    else:
        raise ValueError("Unsupported diagnostic CLI command")
    state["receipts"].append(receipt)
    persist()
    print("Y28 completed " + command["id"], flush=True)
    return op == "exit" or command.get("exitAfter", False)


persist()
print("Y28 test CLI ready; explicit JSON line + Enter executes IO in " + str(root), flush=True)
while True:
    ready, _, _ = select.select([sys.stdin], [], [], 0.1)
    if ready:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            if execute(json.loads(line)):
                state["normalExit"] = True
                persist()
                break
        except Exception as error:
            state["error"] = str(error)
            persist()
            print("Y28 error " + str(error), flush=True)
    else:
        state["outputTicks"] += 1
        persist()
        print("Y28 active " + str(state["outputTicks"]), flush=True)
