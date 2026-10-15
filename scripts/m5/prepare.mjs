import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const envFile = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (!match) return [];
  const raw = match[2]; return [[match[1], /^(".*"|'.*')$/.test(raw) ? raw.slice(1, -1) : raw]];
}));

export async function readLiveInputs() {
  const skillRoot = join(homedir(), '.codex', 'skills', 'project-db-diagnostics');
  const config = JSON.parse(await readFile(join(skillRoot, 'db_connections.json'), 'utf8'));
  const project = config.projects.find((p) => p.key === 'AIS');
  assert(project, 'AIS mapping not found');
  const databases = project.databases.filter((d) => d.environment === 'dev');
  assert.equal(databases.length, 1, 'AIS development database must be unambiguous');
  const database = databases[0];
  const values = envFile(await readFile(join(skillRoot, '.db_secrets.env'), 'utf8'));
  const dbPassword = process.env[database.passwordEnv] ?? values[database.passwordEnv];
  assert(typeof dbPassword === 'string', 'AIS development database credential unavailable');
  const raw = JSON.parse(await readFile(join(homedir(), '.codex', 'remote-servers', 'servers.json'), 'utf8'));
  const servers = (Array.isArray(raw) ? raw : raw.servers).filter((s) => s.environment === 'dev' && s.deployments?.AIS);
  assert.equal(servers.length, 1, 'AIS development server must be unambiguous');
  const server = servers[0];
  const sshPassword = server.passwordEnv ? process.env[server.passwordEnv] : server.password;
  assert(typeof sshPassword === 'string', 'AIS development SSH credential unavailable');
  const workdir = resolve(project.roots[0]);
  return {
    workdir, secretValues: [dbPassword, sshPassword],
    dbInput: { env: 'dev', label: 'AIS development', aliases: ['开发库', '研发库'], vendor: database.type, host: database.host, port: database.port, database: database.database, schema: database.schema ?? null, username: database.username, accessLevel: 'readonly', isDefault: true, note: 'M5 read-only acceptance', password: dbPassword },
    serverInput: { env: 'dev', label: 'AIS development', aliases: ['开发', '研发'], host: server.ip, port: server.port ?? 22, username: server.username, authType: 'password', privateKeyPath: null, defaultRoot: false, sudoPolicy: 'none', appRoot: server.deployments.AIS.root, logsPath: server.deployments.AIS.toolAgentLog, note: 'M5 read-only acceptance', password: sshPassword },
  };
}

export async function prepareLiveInputs(root) {
  const inputs = await readLiveInputs();
  await mkdir(join(root, 'userdata'), { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'cli'), { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'bin'), { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'control-work', '.svn'), { recursive: true, mode: 0o700 });
  // Copies encrypted AI credentials only. No plaintext is returned by this subprocess.
  execFileSync('python3', ['-c', `
import json, sqlite3, sys
source, target, cli_root, bin_path, known_hosts = sys.argv[1:]
s=sqlite3.connect('file:'+source+'?mode=ro',uri=True); t=sqlite3.connect(target)
s.backup(t); s.close()
for table in ['tasks','sessions','project_databases','project_dirs','project_servers','projects','project_capabilities','skill_versions']:
    t.execute('DELETE FROM '+table)
t.execute("DELETE FROM ai_profiles WHERE name NOT IN ('CC-work','CC-deepseek')")
ids=[r[0] for r in t.execute('SELECT id FROM ai_profiles')]
for key, in t.execute('SELECT key FROM app_secrets').fetchall():
    if not any(key.startswith('ai:'+id+':env:') for id in ids): t.execute('DELETE FROM app_secrets WHERE key=?',(key,))
for id, raw in t.execute('SELECT id,env FROM ai_profiles').fetchall():
    entries=[e for e in json.loads(raw) if e['name'] not in ('CLAUDE_CONFIG_DIR','CODEX_HOME','CLAUDE_CODE_MAX_RETRIES','PATH','M5_KNOWN_HOSTS')]
    entries.append({'name':'CLAUDE_CONFIG_DIR','secret':False,'value':cli_root})
    entries.append({'name':'CLAUDE_CODE_MAX_RETRIES','secret':False,'value':'0'})
    entries.append({'name':'PATH','secret':False,'value':bin_path})
    entries.append({'name':'M5_KNOWN_HOSTS','secret':False,'value':known_hosts})
    args=['--print','--output-format','stream-json','--verbose',
          '--tools','Read,Glob,Grep,Skill,Bash','--allowedTools','Read,Glob,Grep,Skill,Bash(python3 *),mcp__*',
          '--permission-prompts','none','--setting-sources','','--strict-mcp-config','--max-budget-usd','5']
    t.execute('UPDATE ai_profiles SET env=?,args=? WHERE id=?',(json.dumps(entries),json.dumps(args),id))
t.commit(); t.execute('VACUUM'); t.close()
`, join(homedir(), 'Library', 'Application Support', 'SmartDD', 'smartdd.db'), join(root, 'userdata', 'smartdd.db'), join(root, 'cli'), join(root, 'bin') + ':' + process.env.PATH, join(root, 'known_hosts')], { stdio: ['ignore', 'ignore', 'pipe'] });
  await writeFile(join(root, 'bin', 'ssh'), '#!/bin/sh\nexec /usr/bin/ssh -F /dev/null -o UserKnownHostsFile="$M5_KNOWN_HOSTS" "$@"\n', { mode: 0o700 });
  return inputs;
}
