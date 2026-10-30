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


def image_input_launch(command, manifest):
    """Describe the resolved executable, without recording prompts or env values."""
    executable = Path(shutil.which(command[0])).resolve(strict=True)
    with executable.open('rb') as source:
        before = os.fstat(source.fileno())
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
        after = os.fstat(source.fileno())
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
    if identity(before) != identity(after) or identity(after) != identity(executable.stat()):
        raise OSError('runner changed')
    # Only reviewed interactive argv forms are certified. Unknown switches stay
    # unknown, rather than guessing from a runner label or executable basename.
    flags = {'--bare', '--strict-mcp-config', '--no-chrome'}
    values = {'--session-id', '--resume', '--append-system-prompt', '--mcp-config', '--plugin-dir', '--tools', '--setting-sources'}
    mode, at = 'interactive', 1
    while at < len(command):
        arg = command[at]
        if arg in {'-p', '--print', '--version', '-v', '--help', '-h', '--input-format', '--output-format'}:
            mode = 'noninteractive'
            break
        if arg in flags:
            at += 1
        elif arg in values and at + 1 < len(command):
            at += 2
        elif at == len(command) - 1 and arg and not arg.startswith('-'):
            at += 1  # a single initial prompt, never copied into the report
        else:
            mode = 'unknown'
            break
    return {'runId': manifest['runId'], 'pid': os.getpid(), 'executable': str(executable),
            'sha256': digest.hexdigest(), 'device': str(after.st_dev), 'inode': str(after.st_ino),
            'size': after.st_size, 'mtimeNs': str(after.st_mtime_ns), 'mode': mode}


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
    manifest, resolved = None, None
    try:
        content = Path(manifest_path).read_bytes()
        if hashlib.sha256(content).hexdigest() != expected_hash:
            issues = ["manifest_hash_mismatch"]
        else:
            manifest = json.loads(content)
            issues = check(manifest)
    except Exception:
        # No parser/driver exception text: it can contain credentials or file content.
        issues = ["manifest_invalid"]
    if not command or not shutil.which(command[0]):
        issues.append("runner_not_found")
    if not issues:
        # Capability discovery failure must not break an otherwise valid task.
        # Absence of this private report simply leaves image input unknown.
        try:
            launch = image_input_launch(command, manifest)
            resolved = launch['executable']
            target = report.parent / 'image-input-launch.json'
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as out:
                json.dump(launch, out)
        except Exception:
            pass
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
    os.execvpe(resolved or command[0], command, os.environ)


if __name__ == "__main__":
    sys.exit(main())
