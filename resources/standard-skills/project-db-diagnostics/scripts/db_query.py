#!/usr/bin/env python3
"""Project-aware database query helper for Codex diagnostics."""

import argparse
import getpass
import json
import os
import re
import sys
import time
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_CONFIG = SKILL_DIR / "db_connections.json"
DEFAULT_SECRETS = SKILL_DIR / ".db_secrets.env"

READ_PREFIXES = ("select", "show", "describe", "desc", "explain", "with")
WRITE_PATTERN = re.compile(
    r"\b(insert|update|delete|truncate|alter|drop|create|replace|grant|revoke|call|load)\b",
    re.IGNORECASE,
)
ENVIRONMENT_ALIASES = {
    "dev": {"dev", "develop", "development", "yanfa", "开发", "开发库", "研发", "研发库"},
    "test": {"test", "testing", "ceshi", "测试", "测试库"},
    "prod": {"prod", "production", "shengchan", "生产", "生产库", "正式", "正式库"},
}
ENVIRONMENTS = {alias: environment for environment, aliases in ENVIRONMENT_ALIASES.items() for alias in aliases}


def parse_args():
    parser = argparse.ArgumentParser(description="Run a focused project database diagnostic query.")
    parser.add_argument("--config", default=os.environ.get("PROJECT_DB_CONFIG"))
    parser.add_argument("--secrets", default=str(DEFAULT_SECRETS), help="Optional local env file with database passwords.")
    parser.add_argument("--cwd", default=os.getcwd(), help="Directory used for project auto-match.")
    parser.add_argument("--project", help="Project key or alias.")
    parser.add_argument("--db", help="Database key/name/label under the selected project.")
    parser.add_argument("--env", help="Environment (dev, test, prod, or an exact custom value).")
    parser.add_argument("--target", help="Exact name, alias, database name, host, or host:port. Use --env for environment.")
    parser.add_argument("--type", help="Database type or vendor, for example mysql, postgres, opengauss, oracle.")
    parser.add_argument("--sql", help="SQL to run. Omit for --list or --show-selected metadata only.")
    parser.add_argument("--format", choices=("table", "json"), default="table")
    parser.add_argument("--limit", type=int, default=200, help="Maximum rows printed for result sets.")
    parser.add_argument("--connect-timeout", type=int, default=8)
    parser.add_argument("--read-timeout", type=int, default=30)
    parser.add_argument("--allow-write", action="store_true", help="Allow non-read-only SQL.")
    parser.add_argument("--list", action="store_true", help="List configured projects/databases and exit.")
    parser.add_argument("--show-selected", action="store_true", help="Print selected project/database metadata.")
    return parser.parse_args()


def load_config(path):
    config_path = Path(path).expanduser()
    if not config_path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")
    with config_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def load_secrets(path):
    secrets_path = Path(path).expanduser()
    if not secrets_path.exists():
        return {}
    secrets = {}
    with secrets_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if key:
                secrets[key] = value
    return secrets


def normalize(value):
    return str(value or "").strip().casefold()


def normalize_environment(environment):
    normalized = normalize(environment)
    return ENVIRONMENTS.get(normalized, normalized)


def is_under(path, root):
    if not root:
        return False
    try:
        path_obj = Path(path).expanduser().resolve()
        root_obj = Path(root).expanduser().resolve()
        return path_obj == root_obj or root_obj in path_obj.parents
    except Exception:
        path_norm = os.path.abspath(os.path.expanduser(path))
        root_norm = os.path.abspath(os.path.expanduser(root))
        return path_norm == root_norm or path_norm.startswith(root_norm.rstrip(os.sep) + os.sep)


def project_matches(project, query):
    q = normalize(query)
    keys = [project.get("key"), *(project.get("aliases") or [])]
    return any(normalize(key) == q for key in keys)


def select_project(config, project_query, cwd):
    projects = config.get("projects") or []
    if not projects:
        raise ValueError("No projects configured")
    if project_query:
        for project in projects:
            if project_matches(project, project_query):
                return project
        raise ValueError(f"Project not found: {project_query}")
    for project in projects:
        if any(is_under(cwd, root) for root in project.get("roots") or []):
            return project
    return projects[0]


def aliases_list(value):
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    return list(value)


def db_matches(db, query):
    q = normalize(query)
    keys = [db.get("key"), db.get("name"), db.get("label"), *aliases_list(db.get("aliases"))]
    return bool(q) and any(normalize(key) == q for key in keys)


def db_target_matches(db, target):
    if db_matches(db, target):
        return True
    q = normalize(target)
    host = normalize(db.get("host"))
    endpoint_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
    endpoint = f"{endpoint_host}:{db['port']}" if host and db.get("port") else ""
    return q in {value for value in (host, endpoint, normalize(db.get("database"))) if value}


def describe_db(db):
    aliases = ", ".join(aliases_list(db.get("aliases"))) or "<empty>"
    return (
        f"{db.get('key')}: name={db.get('label') or db.get('name') or '<empty>'} aliases={aliases} "
        f"env={db.get('environment') or '<empty>'} "
        f"type={db.get('vendor') or db.get('type')} "
        f"host={db.get('host') or '<empty>'} port={db.get('port') or '<empty>'} "
        f"database={db.get('database') or db.get('serviceName') or db.get('sid') or '<empty>'}"
    )


def selection_error(message, databases):
    choices = "\n".join(f"  - {describe_db(db)}" for db in databases)
    return ValueError(f"{message} Please clarify with --env and/or --db.\n{choices}")


def select_database(project, db_query=None, target_query=None, type_query=None, env_query=None):
    databases = project.get("databases") or []
    if not databases:
        raise ValueError(f"No databases configured for project {project.get('key')}")
    # Preserve the existing shorthand --target 开发库, but an explicit --env
    # lets callers use a reserved environment word as a database alias.
    if env_query is None and normalize(target_query) in ENVIRONMENTS:
        env_query, target_query = target_query, None
    if all(query is None for query in (db_query, target_query, type_query, env_query)):
        default_key = project.get("defaultDatabase")
        defaults = [db for db in databases if default_key and db.get("key") == default_key]
        if len(defaults) == 1 and normalize_environment(defaults[0].get("environment")) not in ("", "prod"):
            return defaults[0]
        raise selection_error("No non-production default database is configured.", databases)

    in_environment = databases
    if env_query is not None:
        wanted = normalize_environment(env_query)
        in_environment = [db for db in databases if wanted and normalize_environment(db.get("environment")) == wanted]
    matches = in_environment
    if db_query is not None:
        # A stable key must never resolve to a different database whose alias happens to match it.
        wanted = normalize(db_query)
        if wanted and any(normalize(db.get("key")) == wanted for db in databases):
            matches = [db for db in matches if normalize(db.get("key")) == wanted]
        else:
            matches = [db for db in matches if db_matches(db, db_query)]
    if target_query is not None:
        matches = [db for db in matches if db_target_matches(db, target_query)]
    if type_query is not None:
        wanted = normalize(type_query)
        matches = [db for db in matches if wanted and wanted in {normalize(db.get("type")), normalize(db.get("vendor"))}]
    if len(matches) == 1:
        return matches[0]
    selectors = ", ".join(f"{label}={value!r}" for label, value in (
        ("env", env_query), ("db", db_query), ("target", target_query), ("type", type_query)
    ) if value is not None)
    if not matches:
        raise selection_error(f"No database matches {selectors}.", in_environment or databases)
    raise selection_error(f"Multiple databases match {selectors}.", matches)


def list_config(config):
    for project in config.get("projects") or []:
        print(f"Project {project.get('key')}")
        for db in project.get("databases") or []:
            marker = " (default)" if db.get("key") == project.get("defaultDatabase") else ""
            print(f"  - {describe_db(db)}{marker}")


def assert_safe_sql(sql, allow_write):
    stripped = (sql or "").strip().strip(";")
    lowered = stripped.lower()
    if not stripped:
        raise ValueError("SQL is empty")
    if allow_write:
        return stripped
    if WRITE_PATTERN.search(stripped) or not lowered.startswith(READ_PREFIXES):
        raise ValueError("Refusing non-read-only SQL without --allow-write")
    return stripped


def encode_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return f"<{len(value)} bytes>"
    return value


def print_json(rows):
    normalized_rows = [
        {key: encode_value(value) for key, value in row.items()}
        for row in rows
    ]
    print(json.dumps(normalized_rows, ensure_ascii=False, indent=2))


def print_table(rows, limit):
    if not rows:
        print("(0 rows)")
        return
    columns = list(rows[0].keys())
    display_rows = rows[:limit]
    rendered = []
    for row in display_rows:
        rendered.append([
            "" if row.get(col) is None else str(encode_value(row.get(col)))
            for col in columns
        ])
    widths = [
        min(max(len(str(col)), *(len(row[i]) for row in rendered)), 80)
        for i, col in enumerate(columns)
    ]
    print(" | ".join(str(col)[:widths[i]].ljust(widths[i]) for i, col in enumerate(columns)))
    print("-+-".join("-" * width for width in widths))
    for row in rendered:
        print(" | ".join(row[i][:widths[i]].ljust(widths[i]) for i in range(len(columns))))
    if len(rows) > limit:
        print(f"... truncated: showing {limit} of {len(rows)} rows")
    else:
        print(f"({len(rows)} rows)")


def get_password(db, secrets):
    env_name = db.get("passwordEnv")
    if env_name:
        password = os.environ.get(env_name)
        if password is not None:
            return password
        if env_name in secrets:
            return secrets[env_name]
        raise ValueError(
            f"Password is not set. Set environment variable {env_name} "
            f"or add it to {DEFAULT_SECRETS}"
        )
    if db.get("password") is not None:
        return str(db.get("password"))
    return getpass.getpass("Database password: ")


def connect_mysql(db, password, args):
    try:
        import pymysql
    except ImportError:
        raise RuntimeError("Missing dependency: pymysql")
    return pymysql.connect(
        host=db.get("host"),
        port=int(db.get("port") or 3306),
        user=db.get("username"),
        password=password,
        database=db.get("database"),
        charset=db.get("charset") or "utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=args.connect_timeout,
        read_timeout=args.read_timeout,
    )


def connect_postgres(db, password, args):
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        raise RuntimeError("Missing dependency: psycopg2")
    return psycopg2.connect(
        host=db.get("host"),
        port=int(db.get("port") or 5432),
        user=db.get("username"),
        password=password,
        dbname=db.get("database"),
        connect_timeout=args.connect_timeout,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def connect_oracle(db, password, args):
    try:
        import oracledb
    except ImportError:
        raise RuntimeError("Missing dependency: oracledb")
    host = db.get("host")
    port = int(db.get("port") or 1521)
    service_name = db.get("serviceName")
    sid = db.get("sid")
    if service_name:
        dsn = oracledb.makedsn(host, port, service_name=service_name)
    elif sid:
        dsn = oracledb.makedsn(host, port, sid=sid)
    else:
        dsn = db.get("dsn")
    return oracledb.connect(user=db.get("username"), password=password, dsn=dsn)


def rows_from_cursor(cursor):
    rows = cursor.fetchall()
    if rows is None:
        return []
    result = []
    for row in rows:
        if isinstance(row, dict):
            result.append(dict(row))
        else:
            columns = [desc[0] for desc in cursor.description]
            result.append(dict(zip(columns, row)))
    return result


def execute_query(db, sql, args, secrets):
    if db.get("accessLevel") == "readonly" and args.allow_write:
        raise ValueError("This resource is readonly; --allow-write is not permitted")
    db_type = normalize(db.get("type"))
    password = get_password(db, secrets)
    if db_type in ("mysql", "mariadb"):
        conn = connect_mysql(db, password, args)
    elif db_type in ("postgres", "postgresql", "pg", "opengauss"):
        conn = connect_postgres(db, password, args)
    elif db_type == "oracle":
        conn = connect_oracle(db, password, args)
    else:
        raise ValueError(f"Unsupported database type: {db.get('type')}")

    try:
        record_resource("connected", db, args)
        if db.get("accessLevel") == "readonly" and db_type in ("postgres", "postgresql", "pg", "opengauss"):
            conn.set_session(readonly=True)
        cursor = conn.cursor()
        try:
            if db.get("accessLevel") == "readonly" and db_type in ("mysql", "mariadb"):
                cursor.execute("SET TRANSACTION READ ONLY")
                conn.begin()
            if db.get("schema") and db_type in ("postgres", "postgresql", "pg", "opengauss"):
                cursor.execute("SELECT pg_catalog.set_config('search_path', %s, false)", ('"' + str(db['schema']).replace('"', '""') + '"',))
            cursor.execute(sql)
            if cursor.description:
                rows = rows_from_cursor(cursor)
                record_resource("completed", db, args)
                return rows, None
            if args.allow_write:
                conn.commit()
            record_resource("completed", db, args)
            return [], cursor.rowcount
        finally:
            cursor.close()
    finally:
        conn.close()


def redacted_selected(project, db):
    safe = {key: value for key, value in db.items() if key.lower() not in ("password", "url", "dsn")}
    return {"project": project.get("key"), "database": safe}


def record_resource(status, db, args):
    path = os.environ.get("SMARTDD_RESOURCE_AUDIT")
    if not path:
        return
    metadata = getattr(args, "projection_metadata", {})
    record = {"kind": "database", "skill": "project-db-diagnostics", "version": "1.0.0", "status": status, "at": int(time.time() * 1000)}
    record.update({key: metadata.get(key) for key in ("projectId", "configVersion", "configHash")})
    record.update({key: db.get(key) for key in ("resourceId", "host", "port", "database", "schema", "username")})
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "a") as out:
        out.write(json.dumps(record, ensure_ascii=False) + "\n")


def main():
    args = parse_args()
    if not args.config:
        raise ValueError("PROJECT_DB_CONFIG is missing. Start a WillYou task or supply --config explicitly.")
    config = load_config(args.config)
    args.projection_metadata = config
    secrets = {} if os.environ.get("PROJECT_DB_CONFIG") else load_secrets(args.secrets)
    if args.list:
        list_config(config)
        return

    project = select_project(config, args.project, args.cwd)
    db = select_database(project, args.db, args.target, args.type, args.env)
    if args.show_selected:
        print(json.dumps(redacted_selected(project, db), ensure_ascii=False, indent=2))
        if not args.sql:
            return

    sql = assert_safe_sql(args.sql, args.allow_write)
    record_resource("attempted", db, args)
    try:
        rows, affected_rows = execute_query(db, sql, args, secrets)
    except Exception:
        record_resource("failed", db, args)
        raise
    if affected_rows is not None:
        print(f"affected_rows={affected_rows}")
    elif args.format == "json":
        print_json(rows[:args.limit])
        if len(rows) > args.limit:
            sys.stderr.write(f"truncated: showing {args.limit} of {len(rows)} rows\n")
    else:
        print_table(rows, args.limit)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        message = str(exc)
        for name, value in os.environ.items():
            if name.startswith("SMARTDD_DB_") and value:
                message = message.replace(value, "***")
        sys.stderr.write(f"db_query failed: {message}\n")
        sys.exit(1)
