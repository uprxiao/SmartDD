"""Capture strict A60 persisted work and teardown facts from a closed private App."""
import hashlib
import json
import pathlib
import sqlite3
import subprocess
import sys

base = pathlib.Path(__file__).resolve().parents[1]
case = pathlib.Path(sys.argv[1]).resolve(strict=True)
assert case.parent == base and case.name.startswith("attempt-") and case.name[8:].isdigit()
mode = sys.argv[2]
assert mode in ("red", "green")
release = "--verify-release" in sys.argv[3:]
result_path = case / "result.json"
result = json.loads(result_path.read_text())
original = result["original"]
run_id = original["turn"]["run_id"]
turn_id = original["turn"]["turn_id"]
task_id = original["pending"]["origin"]["taskId"]
native_id = original["native"]["itemId"]
request_id = original["pending"]["requestId"]
db, = case.glob("runtime-*/data/smartdd.db")
wal = db.with_name(db.name + "-wal")
assert not wal.exists() or wal.stat().st_size == 0, "Finish exact isolated App first"


def capture_row(connection, item_id):
    return connection.execute(
        "SELECT item_id,turn_id,type,revision,terminal_state,payload_ref FROM agent_items WHERE item_id=?",
        (item_id,),
    ).fetchone()


def item_fields(row):
    raw = row["payload_ref"]
    return {
        "itemId": row["item_id"], "turnId": row["turn_id"], "type": row["type"],
        "revision": row["revision"], "terminal": row["terminal_state"], "body": raw,
        "bodySha256": hashlib.sha256(raw.encode()).hexdigest(),
    }


with sqlite3.connect(db.as_uri() + "?mode=ro&immutable=1", uri=True) as connection:
    connection.row_factory = sqlite3.Row
    turn = connection.execute("SELECT status,run_id,native_turn_id FROM agent_turns WHERE turn_id=?", (turn_id,)).fetchone()
    assert dict(turn) == {"status": "interrupted", "run_id": run_id, "native_turn_id": original["native"]["turnId"]}
    request = connection.execute("SELECT status,revision,origin_json FROM agent_requests WHERE request_id=?", (request_id,)).fetchone()
    assert request["status"] == "retired"
    assert request["revision"] == original["pending"]["revision"]
    origin = json.loads(request["origin_json"])
    assert origin["turnId"] == turn_id and origin["runId"] == run_id
    native_rows = connection.execute(
        """SELECT item_id,native_key FROM agent_items WHERE turn_id=? AND run_id=?
           AND type='command_execution' AND native_key LIKE ?""",
        (turn_id, run_id, "%:" + native_id),
    ).fetchall()
    assert len(native_rows) == 1
    stopped_item = item_fields(capture_row(connection, native_rows[0]["item_id"]))
    assert json.loads(stopped_item["body"])["status"] == "running", "Preserve original native payload"
    assert stopped_item["terminal"] == ("unconfirmed" if mode == "green" else None), stopped_item
    persisted_completed = None
    if mode == "green":
        evidence = result["foregroundOutcome"]
        assert stopped_item == evidence["after"] == evidence["afterHealthy"]
        assert evidence["before"]["terminal"] is None
        assert evidence["before"]["body"] == stopped_item["body"]
        assert evidence["before"]["revision"] == stopped_item["revision"]
        control = result["completedToolControl"]
        persisted_completed = item_fields(capture_row(connection, control["before"]["itemId"]))
        assert persisted_completed["terminal"] == "completed"
        assert persisted_completed == control["before"] == control["after"]
        assert evidence["ui"]["rows"][0]["label"].startswith("未收到工具结果")
        assert not evidence["ui"]["rows"][0]["running"]
    processes = [dict(r) for r in connection.execute(
        """SELECT p.run_id,p.kind,p.pid,p.process_started_at,p.state FROM capability_run_processes p
           JOIN capability_runs r ON r.run_id=p.run_id WHERE r.task_id=? ORDER BY p.rowid""",
        (task_id,),
    )]
assert result["exit"]["code"] == 0 and result["exit"]["signal"] is None
assert not result["rendererErrors"]
assert processes and all(p["state"] == "exited" and p["process_started_at"] and p["pid"] for p in processes)
assert {"cli", "bridge"} <= {p["kind"] for p in processes}
assert result["nativeObserver"]["pid"] in {p["pid"] for p in processes if p["kind"] == "cli"}
pids = sorted({p["pid"] for p in processes} | {result["exit"]["pid"]})
if release:
    for pid in pids:
        probe = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "pid="], capture_output=True, text=True)
        assert probe.returncode == 1 and not probe.stdout.strip(), ("PID remains or probe unavailable", pid, probe)
    probe = subprocess.run(["/usr/sbin/lsof", "-nP", "-iTCP:3425", "-sTCP:LISTEN"], capture_output=True, text=True)
    assert probe.returncode == 1 and not probe.stdout.strip() and not probe.stderr.strip(), probe
print(json.dumps({
    "mode": mode, "case": case.name, "sourceCommit": result["sourceCommit"], "asar": result["asar"],
    "sha256": {"result": hashlib.sha256(result_path.read_bytes()).hexdigest(), "sqlite": hashlib.sha256(db.read_bytes()).hexdigest()},
    "body": stopped_item, "retiredRequest": {"id": request_id, "revision": request["revision"]},
    "completedControl": persisted_completed, "exit": result["exit"],
    "processes": processes, "checkedPids": pids, "liveResourceCheck": release,
}, ensure_ascii=False, indent=2))
