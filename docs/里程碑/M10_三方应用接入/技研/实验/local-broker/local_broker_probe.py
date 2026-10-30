#!/usr/bin/env python3
"""Synthetic stdio JSON-RPC child -> local AF_UNIX broker. Never uses TCP or credentials."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import platform
import secrets
import select
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time


ROOT = Path(__file__).resolve().parent
REQUEST_BUDGET = 1024
RESPONSE_BUDGET = 2048
BOOTSTRAP_BUDGET = 4096
TIMEOUT = 1.0


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"


def error(code):
    return {"ok": False, "error": code}


def read_frame(connection, budget):
    data = bytearray()
    while b"\n" not in data:
        chunk = connection.recv(min(256, budget + 1 - len(data)))
        if not chunk:
            raise ValueError("INCOMPLETE_FRAME")
        data.extend(chunk)
        if len(data) > budget:
            raise ValueError("REQUEST_TOO_LARGE")
    line, extra = bytes(data).split(b"\n", 1)
    if extra:
        raise ValueError("EXTRA_FRAME_DATA")
    try:
        return json.loads(line.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError("INVALID_JSON") from None


class Broker:
    def __init__(self, folder):
        self.path = folder / "b.sock"
        self.tokens = []
        self.policy_revision = 1
        self.writes_allowed = False
        self.write_count = 0
        self.dispatches = 0
        self.accepted_connections = 0
        self.stopping = threading.Event()
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(str(self.path))
        os.chmod(self.path, 0o600)
        self.inode = self.path.lstat().st_ino
        self.listener.listen(8)
        self.listener.settimeout(0.1)
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def issue(self, run_suffix):
        token = secrets.token_urlsafe(32)
        binding = {"digest": hashlib.sha256(token.encode()).digest(),
                   "projectId": "synthetic-project-A", "taskId": "synthetic-task-A",
                   "runId": "synthetic-run-" + run_suffix,
                   "capturedRevision": self.policy_revision, "enabled": True,
                   "expiresAt": time.monotonic() + 60,
                   "allowedOps": {"context.peek", "text.echo", "resource.large", "write.demo"},
                   "osReadOnlyMarker": True}
        self.tokens.append(binding)
        return token, binding

    def authenticate(self, token):
        digest = hashlib.sha256(token.encode()).digest()
        for binding in self.tokens:
            if hmac.compare_digest(digest, binding["digest"]):
                if binding["enabled"] and binding["expiresAt"] > time.monotonic():
                    return binding
        raise ValueError("AUTH_DENIED")

    def dispatch(self, request):
        if (not isinstance(request, dict) or set(request) != {"v", "id", "token", "op", "args"}
                or request.get("v") != 1 or not isinstance(request.get("id"), str)
                or len(request["id"]) > 64 or not isinstance(request.get("token"), str)
                or len(request["token"]) > 128 or not isinstance(request.get("op"), str)
                or not isinstance(request.get("args"), dict)):
            raise ValueError("INVALID_ENVELOPE")
        binding = self.authenticate(request["token"])
        if binding["capturedRevision"] != self.policy_revision:
            raise ValueError("POLICY_CHANGED")
        operation = request["op"]
        if operation not in binding["allowedOps"]:
            raise ValueError("UNKNOWN_OR_DENIED_OPERATION")
        arguments = request["args"]
        if operation in ("context.peek", "write.demo"):
            if arguments:
                raise ValueError("INVALID_ARGUMENTS")
        elif operation == "text.echo":
            if set(arguments) != {"text"} or not isinstance(arguments["text"], str) or len(arguments["text"]) > 100:
                raise ValueError("INVALID_ARGUMENTS")
        elif operation == "resource.large":
            if set(arguments) != {"bytes"} or type(arguments["bytes"]) is not int or not 0 <= arguments["bytes"] <= 5000:
                raise ValueError("INVALID_ARGUMENTS")
        if operation == "write.demo" and not self.writes_allowed:
            raise ValueError("EFFECT_DENIED")
        self.dispatches += 1
        if operation == "context.peek":
            result = {key: binding[key] for key in ("projectId", "taskId", "runId")}
        elif operation == "text.echo":
            result = {"text": arguments["text"]}
        elif operation == "resource.large":
            result = {"syntheticText": "x" * arguments["bytes"]}
        else:
            self.write_count += 1  # In-memory synthetic counter only, no external effect.
            result = {"syntheticWriteCount": self.write_count}
        return {"ok": True, "id": request["id"], "result": result}

    def serve(self):
        while not self.stopping.is_set():
            try:
                connection, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            self.accepted_connections += 1
            with connection:
                connection.settimeout(TIMEOUT)
                try:
                    result = self.dispatch(read_frame(connection, REQUEST_BUDGET))
                except ValueError as exc:
                    result = error(str(exc))
                except socket.timeout:
                    result = error("FRAME_TIMEOUT")
                except OSError:
                    continue
                encoded = encode(result)
                if len(encoded) > RESPONSE_BUDGET:
                    encoded = encode(error("RESPONSE_TOO_LARGE"))
                try:
                    connection.sendall(encoded)
                except OSError:
                    pass

    def close(self):
        self.tokens.clear()
        self.stopping.set()
        self.listener.close()
        self.thread.join(2)
        if self.thread.is_alive():
            raise AssertionError("server thread did not terminate")
        if self.path.exists() and self.path.lstat().st_ino == self.inode:
            self.path.unlink()


def local_request(path, token, operation, arguments=None, extra=None, raw=None):
    request = {"v": 1, "id": "synthetic-request", "token": token,
               "op": operation, "args": {} if arguments is None else arguments}
    if extra:
        request.update(extra)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(2)
        connection.connect(str(path))
        connection.sendall(encode(request) if raw is None else raw)
        return read_frame(connection, RESPONSE_BUDGET)


def bootstrap_read(path):
    info = path.lstat()
    parent = path.parent.lstat()
    if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_uid != os.getuid() or not stat.S_ISDIR(parent.st_mode)
            or stat.S_IMODE(parent.st_mode) != 0o700 or parent.st_uid != os.getuid()):
        raise ValueError("BOOTSTRAP_PERMISSIONS")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        current = os.fstat(stream.fileno())
        if current.st_ino != info.st_ino:
            raise ValueError("BOOTSTRAP_CHANGED")
        data = stream.read(BOOTSTRAP_BUDGET + 1)
    if len(data) > BOOTSTRAP_BUDGET:
        raise ValueError("BOOTSTRAP_TOO_LARGE")
    value = json.loads(data)
    if set(value) != {"v", "socketPath", "runToken"} or value["v"] != 1:
        raise ValueError("BOOTSTRAP_SCHEMA")
    path.unlink()
    return value


TOOLS = {
    "broker_context": ("context.peek", {"type": "object", "properties": {}, "additionalProperties": False}),
    "broker_echo": ("text.echo", {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"], "additionalProperties": False}),
    "broker_write_demo": ("write.demo", {"type": "object", "properties": {}, "additionalProperties": False}),
}


def stdio_child(path):
    bootstrap = bootstrap_read(path)
    initialized = False
    while True:
        raw = sys.stdin.buffer.readline(REQUEST_BUDGET + 1)
        if not raw:
            return
        if len(raw) > REQUEST_BUDGET or not raw.endswith(b"\n"):
            return
        try:
            request = json.loads(raw)
            if "id" not in request:
                continue
            method = request.get("method")
            if method == "initialize":
                initialized = True
                result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                          "serverInfo": {"name": "synthetic-local-broker-probe", "version": "0.0.0"}}
            elif not initialized:
                result = {"error": "NOT_INITIALIZED"}
            elif method == "tools/list":
                result = {"tools": [{"name": name, "description": "Synthetic research only", "inputSchema": tool[1]}
                                    for name, tool in TOOLS.items()]}
            elif method == "tools/call":
                params = request.get("params", {})
                tool = TOOLS.get(params.get("name"))
                if tool is None:
                    response = error("UNKNOWN_TOOL")
                else:
                    response = local_request(bootstrap["socketPath"], bootstrap["runToken"], tool[0], params.get("arguments", {}))
                result = {"content": [{"type": "text", "text": json.dumps(response, separators=(",", ":"))}],
                          "isError": not response["ok"]}
            else:
                result = {"error": "UNKNOWN_METHOD"}
            sys.stdout.buffer.write(encode({"jsonrpc": "2.0", "id": request["id"], "result": result}))
            sys.stdout.buffer.flush()
        except (ValueError, OSError, KeyError):
            return  # Do not expose bootstrap/token or internal exception text.


class Child:
    def __init__(self, folder, broker, suffix):
        self.token, self.binding = broker.issue(suffix)
        self.bootstrap_path = folder / ("bootstrap-" + suffix + ".json")
        descriptor = os.open(self.bootstrap_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encode({"v": 1, "socketPath": str(broker.path), "runToken": self.token}))
        self.bootstrap_mode = stat.S_IMODE(self.bootstrap_path.stat().st_mode)
        self.process = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "--stdio-child", str(self.bootstrap_path)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={"PATH": os.defpath, "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"})
        self.raw_stdout = bytearray()
        self.call_id = 0
        self.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "probe", "version": "0"}})
        self.process.stdin.write(encode({"jsonrpc": "2.0", "method": "notifications/initialized"}))
        self.process.stdin.flush()

    def call(self, method, params=None):
        self.call_id += 1
        self.process.stdin.write(encode({"jsonrpc": "2.0", "id": self.call_id, "method": method, "params": params or {}}))
        self.process.stdin.flush()
        if not select.select([self.process.stdout], [], [], 3)[0]:
            raise AssertionError("stdio response timeout")
        raw = self.process.stdout.readline(RESPONSE_BUDGET + 1)
        self.raw_stdout.extend(raw)
        response = json.loads(raw)
        assert response["jsonrpc"] == "2.0" and response["id"] == self.call_id
        return response["result"]

    def tool(self, name, arguments=None):
        result = self.call("tools/call", {"name": name, "arguments": arguments or {}})
        return json.loads(result["content"][0]["text"])

    def close(self):
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)
            raise AssertionError("child did not exit on EOF")
        assert self.process.returncode == 0
        diagnostic = self.process.stderr.read()
        assert self.token.encode() not in self.raw_stdout + diagnostic
        assert not diagnostic


def main():
    checks = []
    children = []
    folder = Path(tempfile.mkdtemp(prefix="wyb-", dir="/private/tmp"))
    os.chmod(folder, 0o700)
    broker = None

    def passed(name, detail):
        checks.append({"id": f"LB-{len(checks)+1:02d}", "name": name, "status": "passed", "detail": detail})

    try:
        broker = Broker(folder)
        assert stat.S_IMODE(folder.stat().st_mode) == 0o700
        assert stat.S_IMODE(broker.path.stat().st_mode) == 0o600
        assert len(os.fsencode(broker.path)) < 100
        passed("private-endpoint", "actual AF_UNIX listener under own 0700 short directory; socket 0600")
        child = Child(folder, broker, "A"); children.append(child)
        assert child.bootstrap_mode == 0o600 and not child.bootstrap_path.exists()
        assert child.process.pid != os.getpid()
        assert child.token not in " ".join(child.process.args)
        passed("private-bootstrap-subprocess", "real stdio child; one-time 0600 bootstrap consumed/unlinked; no token in argv or child env")
        assert len(child.call("tools/list")["tools"]) == 3
        result = child.tool("broker_context")
        assert result["ok"] and result["result"]["projectId"] == "synthetic-project-A"
        assert result["result"]["runId"] == "synthetic-run-A"
        passed("stdio-to-broker-run-binding", "initialize/tools-list/tools-call traversed real subprocess and AF_UNIX; actor derived in owner")
        assert local_request(broker.path, "synthetic-wrong-token", "context.peek")["error"] == "AUTH_DENIED"
        passed("wrong-token", "wrong bearer cannot access bound context")
        before = broker.dispatches
        assert local_request(broker.path, child.token, "context.peek", extra={"projectId": "synthetic-project-B"})["error"] == "INVALID_ENVELOPE"
        assert child.tool("broker_context", {"projectId": "synthetic-project-B"})["error"] == "INVALID_ARGUMENTS"
        assert broker.dispatches == before
        passed("no-caller-scope-switch", "top-level and nested project spoof rejected before dispatch; no project parameter controls identity")
        assert local_request(broker.path, child.token, "arbitrary.exec")["error"] == "UNKNOWN_OR_DENIED_OPERATION"
        passed("unknown-operation", "no generic exec/path/url dispatch")
        assert child.tool("broker_echo", {"text": "line one\nline two"})["result"]["text"] == "line one\nline two"
        malformed = b'{"v":1,"text":"literal\nnewline"}\n'
        assert local_request(broker.path, child.token, "context.peek", raw=malformed)["error"] in {"INVALID_JSON", "EXTRA_FRAME_DATA"}
        assert child.tool("broker_context")["ok"]
        passed("newline-framing", "escaped LF round-trips through JSON; literal LF malformed frame rejected; later valid request succeeds")
        assert local_request(broker.path, child.token, "context.peek", raw=b"x" * (REQUEST_BUDGET + 1))["error"] == "REQUEST_TOO_LARGE"
        assert local_request(broker.path, child.token, "resource.large", {"bytes": 3000})["error"] == "RESPONSE_TOO_LARGE"
        passed("request-and-response-budget", "1024-byte frame and 2048-byte result caps enforced on actual socket")
        assert child.binding["osReadOnlyMarker"]
        assert child.tool("broker_write_demo")["error"] == "EFFECT_DENIED" and broker.write_count == 0
        passed("broker-write-policy", "owner policy blocks write; OS read-only marker is not used as a business permission")
        broker.policy_revision += 1
        assert child.tool("broker_context")["error"] == "POLICY_CHANGED"
        passed("revision-recheck", "existing stdio child denied on next request after current policy revision changes")
        broker.writes_allowed = True
        child2 = Child(folder, broker, "B"); children.append(child2)
        assert child2.binding["osReadOnlyMarker"] and child2.tool("broker_write_demo")["ok"]
        assert broker.write_count == 1
        passed("os-marker-is-not-write-isolation", "synthetic policy-granted in-memory write succeeds despite marker; no real external write performed")
        child2.binding["expiresAt"] = time.monotonic() - 1
        assert child2.tool("broker_context")["error"] == "AUTH_DENIED"
        passed("token-expiry", "same running child loses access after owner expiry check")
        child3 = Child(folder, broker, "C"); children.append(child3)
        child3.binding["enabled"] = False
        assert child3.tool("broker_context")["error"] == "AUTH_DENIED"
        passed("run-revocation", "owner revocation applies to existing child at next request")
        for item in children:
            item.close()
        children.clear()
        passed("child-eof-protocol-cleanup", "all 3 children exit on stdin EOF; captured stdout is JSON-RPC; no token or diagnostics leaked")
        count = broker.accepted_connections
        broker.close()
        assert not broker.path.exists() and not broker.tokens and not broker.thread.is_alive()
        folder.rmdir()
        passed("owner-shutdown-cleanup", "normal owner shutdown clears run tokens and listener/thread/socket/private directory")
        report = {"kind": "synthetic-local-ipc-experiment", "date": "2026-10-17",
                  "python": platform.python_version(), "system": platform.system(), "machine": platform.machine(),
                  "passed": len(checks), "failed": 0, "checks": checks,
                  "transport": "stdio JSON-RPC subprocess -> private AF_UNIX -> synthetic owner broker",
                  "localSocketConnections": count, "tcpSockets": 0, "externalNetworkCalls": 0,
                  "realCredentials": False, "realProviders": False, "productionCodeChanged": False,
                  "actualElectronMain": False, "windowsVerified": False,
                  "normalShutdownCleanupVerified": True, "crashRecoveryVerified": False,
                  "tokenBytes": 32, "tokenLifetimeSeconds": 60,
                  "requestBudgetBytes": REQUEST_BUDGET, "responseBudgetBytes": RESPONSE_BUDGET,
                  "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  "limits": ["Minimal MCP subset, not SDK conformance or real CLI acceptance",
                             "Python owner substitutes Electron main; no production bridge implemented",
                             "No OS-strong isolation between processes of the same UID",
                             "One request/connection; no concurrency/backpressure or crash-restart acceptance",
                             "OS read-only is a synthetic marker, not an OS sandbox test"]}
        (ROOT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"passed": len(checks), "failed": 0, "externalNetworkCalls": 0, "localSocketConnections": count}))
    finally:
        for item in children:
            if item.process.poll() is None:
                item.process.kill(); item.process.wait(timeout=3)
        if broker and not broker.stopping.is_set():
            broker.close()
        if folder.exists():
            for file in folder.iterdir():
                file.unlink()
            folder.rmdir()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--stdio-child":
        stdio_child(Path(sys.argv[2]))
    else:
        main()
