#!/usr/bin/env python3
import argparse
import json
import os
import pty
import re
import select
import shlex
import signal
import sys
import time
from pathlib import Path


DEFAULT_CONFIG = Path.home() / ".codex" / "remote-servers" / "servers.json"
PROJECT_CONFIG_RELATIVE_PATH = Path(".codex") / "remote-servers" / "servers.json"
PASSWORD_PROMPT = re.compile(rb"(?i)(password:|passphrase for key)")
SUDO_PROMPT = re.compile(rb"\[sudo\] password:")
HOSTKEY_PROMPT = re.compile(rb"(?i)are you sure you want to continue connecting")
ENVIRONMENT_ALIASES = {
    "dev": {"dev", "develop", "development", "test", "testing", "yanfa", "ceshi", "研发", "测试"},
    "prod": {"prod", "production", "shengchan", "生产"},
}
DANGEROUS_PATTERNS = [
    ("forced recursive delete", re.compile(r"\brm\s+[^;&|\n]*-(?:[A-Za-z]*r[A-Za-z]*f|[A-Za-z]*f[A-Za-z]*r)\b")),
    ("forced recursive delete", re.compile(r"\brm\s+[^;&|\n]*-[A-Za-z]*r\b[^;&|\n]*-[A-Za-z]*f\b")),
    ("forced recursive delete", re.compile(r"\brm\s+[^;&|\n]*-[A-Za-z]*f\b[^;&|\n]*-[A-Za-z]*r\b")),
    ("disk format", re.compile(r"\bmkfs(?:\.[A-Za-z0-9_+-]+)?\b")),
    ("raw disk write", re.compile(r"\bdd\s+[^;&|\n]*(?:\bof=/dev/|\bif=/dev/zero\b|\bif=/dev/random\b)")),
    ("partition table change", re.compile(r"\b(?:fdisk|parted|sfdisk)\b")),
    ("filesystem wipe", re.compile(r"\bwipefs\b")),
    ("block discard", re.compile(r"\bblkdiscard\b")),
    ("shutdown or poweroff", re.compile(r"\b(?:shutdown|poweroff|halt)\b")),
    ("reboot", re.compile(r"\breboot\b")),
    ("firewall reset/flush", re.compile(r"\b(?:iptables|ip6tables)\b[^;&|\n]*(?:\s-F\b|\s-X\b|--flush\b)")),
    ("firewall reset", re.compile(r"\bufw\s+reset\b")),
]


def find_git_root(start: Path):
    """Return the closest Git repository root containing *start*."""
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def project_config_path():
    """Return the current repository's private server config when present."""
    git_root = find_git_root(Path.cwd())
    if not git_root:
        return None
    candidate = git_root / PROJECT_CONFIG_RELATIVE_PATH
    return candidate if candidate.exists() else None


def config_path() -> Path:
    configured_path = os.environ.get("REMOTE_SERVERS_CONFIG")
    if configured_path:
        return Path(configured_path).expanduser()

    return project_config_path() or DEFAULT_CONFIG


def load_servers(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"Config not found: {path}")

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in server config {path}: {exc.msg}")

    if isinstance(data, list):
        servers = data
    elif isinstance(data, dict) and isinstance(data.get("servers"), list):
        servers = data["servers"]
    else:
        raise SystemExit("Config must be a JSON array or an object with a 'servers' array.")

    for index, server in enumerate(servers, start=1):
        if isinstance(data, dict):
            server["_projection"] = {key: data.get(key) for key in ("projectId", "configVersion", "configHash")}
        missing = [key for key in ("ip", "port", "username") if key not in server]
        if server.get("authType") == "key":
            if not server.get("privateKeyPath"):
                missing.append("privateKeyPath")
        elif not server.get("passwordEnv") and "password" not in server:
            missing.append("passwordEnv/password")
        if missing:
            raise SystemExit(f"Server #{index} is missing required field(s): {', '.join(missing)}")

    return servers


def normalize(value: object) -> str:
    return re.sub(r"\s+", "", str(value or "").lower())


def environment_tokens(environment: object) -> set[str]:
    normalized = normalize(environment)
    if not normalized:
        return set()
    tokens = {normalized}
    tokens.update(ENVIRONMENT_ALIASES.get(normalized, set()))
    return {normalize(token) for token in tokens}


def server_match_tokens(server: dict) -> set[str]:
    tokens = {normalize(server.get("ip")), normalize(server.get("alias"))}
    aliases = server.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [aliases]
    tokens.update(normalize(alias) for alias in aliases)
    tokens.update(environment_tokens(server.get("environment")))
    return {token for token in tokens if token}


def public_server(server: dict) -> str:
    alias = f" alias={server.get('alias')}" if server.get("alias") else ""
    aliases = server.get("aliases") or []
    aliases_text = f" aliases={','.join(map(str, aliases))}" if aliases else ""
    env = f" env={server.get('environment')}" if server.get("environment") else ""
    root = " defaultRoot=true" if server.get("defaultRoot") else ""
    note = f" note={server.get('note')}" if server.get("note") else ""
    return f"{server['username']}@{server['ip']}:{server['port']}{alias}{aliases_text}{env}{root}{note}"


def find_servers(servers: list[dict], target: str) -> list[dict]:
    raw_target = target.strip()
    normalized_target = normalize(raw_target)
    if not normalized_target:
        return []

    matches = []
    for server in servers:
        ip = str(server.get("ip", ""))
        tokens = server_match_tokens(server)
        if raw_target in ip or normalized_target in normalize(ip) or normalized_target in tokens:
            matches.append(server)
            continue
        if any(normalized_target == token or normalized_target in token for token in tokens):
            matches.append(server)
    return matches


def module_match_tokens(module_id: str, module: dict) -> set[str]:
    tokens = {normalize(module_id), normalize(module.get("applicationName"))}
    aliases = module.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [aliases]
    tokens.update(normalize(alias) for alias in aliases)
    return {token for token in tokens if token}


def find_modules(servers: list[dict], target: str) -> list[tuple[dict, str, str, dict]]:
    raw_target = target.strip()
    normalized_target = normalize(raw_target)
    if not normalized_target:
        return []

    matches = []
    for server in servers:
        deployments = server.get("deployments") or {}
        if not isinstance(deployments, dict):
            continue
        for deployment_name, deployment in deployments.items():
            if not isinstance(deployment, dict):
                continue
            modules = deployment.get("modules") or {}
            if not isinstance(modules, dict):
                continue
            for module_id, module in modules.items():
                if not isinstance(module, dict):
                    continue
                tokens = module_match_tokens(str(module_id), module)
                if normalized_target in tokens or any(normalized_target in token for token in tokens):
                    matches.append((server, str(deployment_name), str(module_id), module))
    return matches


def module_log_path(module_id: str, module: dict, log_name: str) -> str:
    logs = module.get("logs") or {}
    if not isinstance(logs, dict):
        raise SystemExit(f"Module '{module_id}' has no log configuration.")
    path = logs.get(log_name)
    if not isinstance(path, str) or not path.strip():
        raise SystemExit(f"Module '{module_id}' has no '{log_name}' log path.")
    return path.strip()


def print_module_match(match: tuple[dict, str, str, dict]) -> None:
    server, deployment_name, module_id, module = match
    application_name = module.get("applicationName") or ""
    print(f"{public_server(server)} deployment={deployment_name} module={module_id} application={application_name}")


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def print_servers(servers: list[dict]) -> None:
    if not servers:
        print("No servers configured.")
        return
    for index, server in enumerate(servers, start=1):
        print(f"{index}. {public_server(server)}")


def dangerous_matches(command: str) -> list[str]:
    matches = []
    for label, pattern in DANGEROUS_PATTERNS:
        if pattern.search(command):
            matches.append(label)
    return sorted(set(matches))


def should_use_root(server: dict, as_root: bool, no_root: bool) -> bool:
    if no_root:
        return False
    use_root = as_root or bool(server.get("defaultRoot"))
    if use_root and server.get("sudoPolicy") == "none":
        raise SystemExit("sudo is disabled for this server")
    return use_root


def secret_value(server: dict, field: str, optional: bool = False) -> str:
    env_name = server.get(field + "Env")
    if env_name:
        if env_name not in os.environ:
            raise SystemExit(f"Missing credential variable: {env_name}")
        return os.environ[env_name]
    value = server.get(field)
    if value is None and not optional:
        raise SystemExit(f"Missing credential: {field}")
    return str(value or "")


def sudo_password(server: dict) -> str:
    if server.get("sudoPasswordEnv"):
        return secret_value(server, "sudoPassword")
    value = server.get("sudoPassword")
    if value in (None, "", "same-as-login"):
        return secret_value(server, "password", optional=True)
    return str(value)


def command_for_execution(server: dict, command: str, use_root: bool) -> str:
    if not use_root:
        return command
    quoted_command = shlex.quote(command)
    return f"sudo -S -p '[sudo] password: ' -i -- sh -lc {quoted_command}"


def run_ssh(server: dict, command: str, use_root: bool = False) -> int:
    destination = f"{server['username']}@{server['ip']}"
    ssh_cmd = [
        "ssh",
        "-tt",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        "-p",
        str(server["port"]),
        destination,
        command_for_execution(server, command, use_root),
    ]

    if server.get("authType") == "key":
        ssh_cmd[1:1] = ["-i", str(Path(server["privateKeyPath"]).expanduser()), "-o", "IdentitiesOnly=yes", "-o", "PreferredAuthentications=publickey"]
    else:
        ssh_cmd[1:1] = ["-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "PubkeyAuthentication=no"]

    # Resolve before forking: a missing injection must not start SSH and wait for a password.
    login_password = secret_value(server, "password", optional=server.get("authType") == "key").encode("utf-8") + b"\n"
    key_passphrase = secret_value(server, "passphrase", optional=True).encode("utf-8") + b"\n"
    root_password = (sudo_password(server) if use_root else "").encode("utf-8") + b"\n"

    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("ssh", ssh_cmd)

    login_password_sent = 0
    sudo_password_sent = 0

    try:
        while True:
            ready, _, _ = select.select([fd], [], [], 0.2)
            if fd in ready:
                try:
                    chunk = os.read(fd, 4096)
                except OSError:
                    break
                if not chunk:
                    break

                os.write(sys.stdout.fileno(), chunk)

                if HOSTKEY_PROMPT.search(chunk):
                    os.write(fd, b"yes\n")
                elif SUDO_PROMPT.search(chunk) and sudo_password_sent < 3:
                    os.write(fd, root_password)
                    sudo_password_sent += 1
                elif PASSWORD_PROMPT.search(chunk) and login_password_sent < 3:
                    os.write(fd, key_passphrase if b"passphrase for key" in chunk.lower() else login_password)
                    login_password_sent += 1

            try:
                finished_pid, status = os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                return 0
            if finished_pid == pid:
                if os.WIFEXITED(status):
                    return os.WEXITSTATUS(status)
                if os.WIFSIGNALED(status):
                    return 128 + os.WTERMSIG(status)
                return 1
    except KeyboardInterrupt:
        os.kill(pid, signal.SIGTERM)
        raise

    _, status = os.waitpid(pid, 0)
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def record_resource(status: str, server: dict, code=None) -> None:
    path = os.environ.get("SMARTDD_RESOURCE_AUDIT")
    if not path:
        return
    record = {"kind": "ssh", "skill": "remote-password-ssh", "version": "1.0.0", "status": status, "at": int(time.time() * 1000), "exitCode": code}
    record.update(server.get("_projection", {}))
    record.update({key: server.get(key) for key in ("resourceId", "port", "username")})
    record["host"] = server.get("ip")
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "a") as out:
        out.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run SSH commands against configured password-based servers.")
    parser.add_argument("--config", type=Path, default=os.environ.get("REMOTE_SERVERS_CONFIG"), help="Path to servers.json")
    parser.add_argument("--target", help="Full IP, partial IP, environment name, or alias")
    parser.add_argument("--module", help="Configured deployment module ID, application name, or alias")
    parser.add_argument("--log", help="Configured module log name (default: primary; requires --module)")
    parser.add_argument("--command", help="Remote shell command to run")
    parser.add_argument("--list", action="store_true", help="List configured servers")
    parser.add_argument("--find", action="store_true", help="Find matching servers without running a command")
    log_action = parser.add_mutually_exclusive_group()
    log_action.add_argument("--show-log-path", action="store_true", help="Print the configured module log path")
    log_action.add_argument("--tail", type=positive_int, metavar="LINES", help="Print the last LINES from a configured module log")
    log_action.add_argument("--follow", action="store_true", help="Follow a configured module log")
    parser.add_argument("--as-root", action="store_true", help="Run the remote command through sudo -i")
    parser.add_argument("--no-root", action="store_true", help="Disable a server's defaultRoot behavior for this command")
    parser.add_argument(
        "--allow-dangerous",
        action="store_true",
        help="Allow commands that match the built-in dangerous command blacklist after explicit user confirmation.",
    )
    args = parser.parse_args()

    if not args.config:
        parser.error("REMOTE_SERVERS_CONFIG is missing. Start a SmartDD task or supply --config explicitly.")

    servers = load_servers(args.config.expanduser())

    if args.list:
        print_servers(servers)
        return 0

    if args.log and not args.module:
        parser.error("--log requires --module")
    if (args.show_log_path or args.tail or args.follow) and not args.module:
        parser.error("log actions require --module")
    if not args.target and not args.module:
        parser.error("--target or --module is required unless --list is used")

    server_matches = find_servers(servers, args.target) if args.target else servers
    if args.target and not server_matches:
        print(f"No configured server matched target: {args.target}", file=sys.stderr)
        return 2
    if args.target and len(server_matches) > 1:
        print(f"Multiple servers matched target: {args.target}", file=sys.stderr)
        print_servers(server_matches)
        return 3

    module_match = None
    if args.module:
        module_matches = find_modules(server_matches, args.module)
        if not module_matches:
            print(f"No configured module matched: {args.module}", file=sys.stderr)
            return 2
        if len(module_matches) > 1:
            print(f"Multiple modules matched: {args.module}", file=sys.stderr)
            for match in module_matches:
                print_module_match(match)
            return 3
        module_match = module_matches[0]
        server = module_match[0]
    else:
        server = server_matches[0]

    if args.find:
        if module_match:
            print_module_match(module_match)
        else:
            print_servers([server])
        return 0

    if module_match and (args.show_log_path or args.tail or args.follow):
        _, _, module_id, module = module_match
        log_path = module_log_path(module_id, module, args.log or "primary")
        if args.show_log_path:
            print(log_path)
            return 0
        if args.tail:
            command = f"tail -n {args.tail} -- {shlex.quote(log_path)}"
        else:
            command = f"tail -f -- {shlex.quote(log_path)}"
    elif args.command:
        command = args.command
    else:
        parser.error("--command is required unless --list, --find, or a log action is used")

    risks = dangerous_matches(command)
    if risks and not args.allow_dangerous:
        print("Blocked dangerous command. Matched risk(s): " + ", ".join(risks), file=sys.stderr)
        print("Re-run with --allow-dangerous only after explicit user confirmation.", file=sys.stderr)
        return 4

    use_root = should_use_root(server, args.as_root, args.no_root)
    record_resource("attempted", server)
    try:
        code = run_ssh(server, command, use_root=use_root)
    except BaseException:
        record_resource("failed", server)
        raise
    if code == 0:
        # OpenSSH exit 0 proves authentication and execution succeeded; recorded after completion.
        record_resource("connected", server, code)
    record_resource("completed" if code == 0 else "failed", server, code)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
