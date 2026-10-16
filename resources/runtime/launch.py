#!/usr/bin/env python3
"""Runs inside the actual terminal, after shell rc/env setup, before exec of the CLI."""
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import sys
import time


def check(manifest):
    issues = []
    for filename, expected in manifest["files"].items():
        try:
            if hashlib.sha256(Path(filename).read_bytes()).hexdigest() != expected:
                issues.append("file_hash_mismatch")
        except OSError:
            issues.append("file_unreadable")
    for name in manifest["requiredEnv"]:
        if name not in os.environ:
            issues.append("missing_env:" + name)
    for name, path in manifest["pathEnv"].items():
        if os.environ.get(name) != path:
            issues.append("wrong_path_env:" + name)
    for name in manifest["pythonModules"]:
        try:
            importlib.import_module(name)
        except Exception:
            issues.append("missing_dependency:" + name)
    for name in manifest["commands"]:
        if not shutil.which(name):
            issues.append("missing_command:" + name)
    for filename in manifest["readablePaths"]:
        if not Path(filename).is_file() or not os.access(filename, os.R_OK):
            issues.append("resource_path_unreadable")
    return sorted(set(issues))


def main():
    manifest_path, expected_hash, *command = sys.argv[1:]
    report = Path(manifest_path).parent / "self-check.json"
    issues = []
    try:
        content = Path(manifest_path).read_bytes()
        if hashlib.sha256(content).hexdigest() != expected_hash:
            issues = ["manifest_hash_mismatch"]
        else:
            issues = check(json.loads(content))
    except Exception:
        # No parser/driver exception text: it can contain credentials or file content.
        issues = ["manifest_invalid"]
    if not command or not shutil.which(command[0]):
        issues.append("runner_not_found")
    result = {"status": "failed" if issues else "passed", "issues": issues, "at": int(time.time() * 1000)}
    try:
        temporary = report.with_suffix(".tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump(result, out)
        os.replace(temporary, report)
    except OSError:
        issues.append("self_check_report_failed")
    if issues:
        print("WillYou injection self-check failed: " + ", ".join(issues), file=sys.stderr)
        return 78
    os.execvpe(command[0], command, os.environ)


if __name__ == "__main__":
    sys.exit(main())
