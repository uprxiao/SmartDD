"""Runs the installed SmartDD Skills inside a real task PTY; no external config fallback."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


def main():
    if '--version' in sys.argv:
        print('SmartDD M5 resource probe 1.0')
        return
    if 'SMARTDD_PROJECT_CONTEXT' not in os.environ:
        print('M5 resource probe ready')
        return
    context = json.loads(Path(os.environ['SMARTDD_PROJECT_CONTEXT']).read_text())
    assert context['projectId'] == os.environ['SMARTDD_PROJECT_ID']
    database = next(s for s in context['skills'] if s['name'] == 'smartdd-project-db-diagnostics')
    ssh = next(s for s in context['skills'] if s['name'] == 'smartdd-remote-password-ssh')
    db_script = str(Path(database['path']).parent / 'scripts/db_query.py')
    ssh_script = str(Path(ssh['path']).parent / 'scripts/remote_ssh.py')
    is_control = context['name'].startswith('M5 control')
    sql = 'SELECT DATABASE() AS current_database, CURRENT_USER() AS current_user'
    if not is_control:
        sql = 'SELECT DATABASE() AS current_database, COUNT(*) AS scene_count FROM SA_SCENE'
    # The caller checks the audit target, not only this command's reply.
    db = subprocess.run(['python3', db_script, '--target', '开发库', '--sql', sql, '--format', 'json'], capture_output=True, text=True, timeout=40)
    if db.returncode:
        raise RuntimeError('Database Skill failed: ' + db.stderr[-1500:])
    server = context['servers'][0]
    command = 'hostname'
    if not is_control:
        log = shlex.quote(server['logsPath'])
        command = f"hostname; test -r {log} && printf 'M5_LOG_READABLE\\n'; tail -n 5 {log} | cut -c1-23"
    remote = subprocess.run(['python3', ssh_script, '--target', '开发', '--no-root', '--command', command], capture_output=True, text=True, timeout=30)
    if remote.returncode:
        raise RuntimeError('SSH Skill failed: ' + remote.stderr[-1500:])
    print('SMARTDD_M5_RESOURCE_RESULT=' + json.dumps({
        'projectId': context['projectId'], 'cwd': os.getcwd(), 'configHash': context['configHash'],
        'database': json.loads(db.stdout), 'ssh': remote.stdout.strip(),
    }, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error)
        for name, value in os.environ.items():
            if value and name.startswith(('SMARTDD_DB_', 'SMARTDD_SSH_')):
                message = message.replace(value, '***')
        print(message, file=sys.stderr)
        raise SystemExit(1)
