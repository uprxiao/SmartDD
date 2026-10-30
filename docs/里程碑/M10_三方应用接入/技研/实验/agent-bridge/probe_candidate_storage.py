#!/usr/bin/env python3
"""Isolated SQLite feasibility experiment; no production schema is changed."""
import argparse
import json
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path


SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE connections(id TEXT PRIMARY KEY, provider TEXT NOT NULL,
  credential_ref TEXT, revision INTEGER NOT NULL, enabled INTEGER NOT NULL);
CREATE TABLE bindings(project_id TEXT NOT NULL, connection_id TEXT NOT NULL,
  allowed_operation TEXT NOT NULL,
  PRIMARY KEY(project_id, connection_id, allowed_operation),
  FOREIGN KEY(connection_id) REFERENCES connections(id));
CREATE TABLE external_objects(connection_id TEXT NOT NULL, object_type TEXT NOT NULL,
  external_id TEXT NOT NULL, revision TEXT,
  PRIMARY KEY(connection_id, object_type, external_id),
  FOREIGN KEY(connection_id) REFERENCES connections(id));
CREATE TABLE invocations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL, operation TEXT NOT NULL, intent_key TEXT NOT NULL,
  connection_revision INTEGER NOT NULL, status TEXT NOT NULL,
  UNIQUE(project_id, connection_id, operation, intent_key),
  FOREIGN KEY(connection_id) REFERENCES connections(id));
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    checks = []

    def check(identifier, title, condition):
        checks.append({'id': identifier, 'observation': title, 'assertion_met': bool(condition)})

    def rejected(db, statement, values):
        try:
            db.execute(statement, values)
        except sqlite3.IntegrityError:
            db.rollback()
            return True
        return False

    with tempfile.TemporaryDirectory(prefix='m10-storage-research-') as folder:
        database = Path(folder) / 'candidate.sqlite'
        db = sqlite3.connect(database)
        db.executescript(SCHEMA)
        db.executemany('INSERT INTO connections VALUES(?,?,?,?,?)', [
            ('conn-A', 'zentao', 'connection:conn-A:token', 1, 1),
            ('conn-B', 'zentao', 'connection:conn-B:token', 1, 1)])
        db.execute('INSERT INTO bindings VALUES(?,?,?)', ('project-A', 'conn-A', 'story.read'))
        db.executemany('INSERT INTO external_objects VALUES(?,?,?,?)', [
            ('conn-A', 'bug', '42', '1'), ('conn-A', 'story', '42', '1'),
            ('conn-B', 'story', '42', '1')])
        db.commit()
        check('DB-01', 'same numeric ID remains distinct by object type and connection',
              db.execute('SELECT COUNT(*) FROM external_objects').fetchone()[0] == 3)
        check('DB-02', 'duplicate external identity rejected by storage constraint', rejected(
            db, 'INSERT INTO external_objects VALUES(?,?,?,?)', ('conn-A', 'story', '42', '2')))
        check('DB-03', 'binding to nonexistent connection rejected', rejected(
            db, 'INSERT INTO bindings VALUES(?,?,?)', ('project-X', 'missing', 'story.read')))

        def permitted(project):
            return db.execute('''SELECT c.id FROM connections c JOIN bindings b
              ON c.id=b.connection_id WHERE b.project_id=? AND c.id=? AND
              b.allowed_operation=? AND c.enabled=1 AND c.revision=?''',
                              (project, 'conn-A', 'story.read', 1)).fetchone() is not None
        check('DB-04', 'project-bound query rejects another project',
              permitted('project-A') and not permitted('project-B'))
        db.execute('UPDATE connections SET enabled=0, revision=2 WHERE id=?', ('conn-A',))
        db.commit()
        check('DB-05', 'disabled/revised connection cannot be reused under old snapshot',
              not permitted('project-A'))
        db.execute('INSERT INTO invocations VALUES(?,?,?,?,?,?,?)',
                   ('call-1', 'project-A', 'conn-A', 'story.read', 'intent-1', 1, 'outcome_unknown'))
        db.commit()
        check('DB-06', 'local duplicate intent prevented independently of call ID', rejected(
            db, 'INSERT INTO invocations VALUES(?,?,?,?,?,?,?)',
            ('call-2', 'project-A', 'conn-A', 'story.read', 'intent-1', 1, 'queued')))
        db.execute('UPDATE connections SET enabled=1 WHERE id=?', ('conn-A',))
        db.rollback()
        check('DB-07', 'failed transaction preserves prior connection state',
              db.execute('SELECT enabled FROM connections WHERE id=?', ('conn-A',)).fetchone()[0] == 0)
        db.close()
        db = sqlite3.connect(database)
        check('DB-08', 'reopen preserves unknown outcome and credential reference, not a raw secret',
              db.execute('SELECT status FROM invocations WHERE id=?', ('call-1',)).fetchone()[0]
              == 'outcome_unknown' and db.execute('SELECT credential_ref FROM connections WHERE id=?',
                                                 ('conn-A',)).fetchone()[0] == 'connection:conn-A:token')
        db.close()
    report = {'schema': 'm10-candidate-storage-research-v1',
              'time': datetime.now(timezone.utc).isoformat(), 'sqlite_version': sqlite3.sqlite_version,
              'checks': checks, 'fixture': 'synthetic temporary SQLite only',
              'limitations': ['candidate schema, not production migration or confirmed product rules',
                              'local uniqueness cannot guarantee remote exactly-once execution',
                              'no network request, real secret, safeStorage, UI or real service tested',
                              'revocation check does not undo an operation already sent to a remote service']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'checks': len(checks), 'assertions_met': sum(x['assertion_met'] for x in checks)}))
    return 0 if all(x['assertion_met'] for x in checks) else 1


if __name__ == '__main__':
    raise SystemExit(main())
