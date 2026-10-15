import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import mysql, { type Connection } from 'mysql2';
import { Server as SshServer, utils } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLED_SKILLS } from './assets';
import { generateSshTestKey } from '../../test-ssh-keys';

// Real bundled Python helpers, real drivers and OpenSSH; only loopback protocol fixtures.
const exec = promisify(execFile);
let tmp: string;
const closers: (() => Promise<void>)[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'smartdd-resource-probe-'));
  for (const skill of BUNDLED_SKILLS) for (const [path, content] of Object.entries(skill.files)) {
    const target = join(tmp, skill.id, path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, content);
  }
});
afterEach(async () => { for (const close of closers.splice(0)) await close(); rmSync(tmp, { recursive: true, force: true }); });
const queryScript = () => join(tmp, 'project-db-diagnostics/scripts/db_query.py');
const sshScript = () => join(tmp, 'remote-password-ssh/scripts/remote_ssh.py');
const pyEnv = (extra: Record<string, string>) => ({ PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1', SMARTDD_RESOURCE_AUDIT: join(tmp, 'audit.jsonl'), ...extra });
const audit = () => readFileSync(join(tmp, 'audit.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
function dbConfig(type: string, port: number) {
  const path = join(tmp, 'databases.json');
  writeFileSync(path, JSON.stringify({ projectId: 'selected-project', configVersion: 7, configHash: 'fixture-hash', projects: [{ key: 'selected-project', databases: [{ key: 'selected-db', resourceId: 'selected-db', type, host: '127.0.0.1', port, database: 'selected_database', schema: type === 'postgres' ? 'selected_schema' : null, username: 'selected_user', passwordEnv: 'SMARTDD_DB_PROBE_PASSWORD', accessLevel: 'readonly' }] }] }));
  return path;
}

describe('reused DB script over native protocols', () => {
  it('requires an explicit project config outside Desktop instead of looking up global credentials', async () => {
    await expect(exec('python3', [queryScript(), '--list'], { env: pyEnv({}) })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('PROJECT_DB_CONFIG is missing') });
    await expect(exec('python3', [sshScript(), '--list'], { env: pyEnv({}) })).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('REMOTE_SERVERS_CONFIG is missing') });
  });
  it('connects to the selected MySQL target with the injected password and uses a read-only transaction', async () => {
    const seen: string[] = [];
    const authenticated: boolean[] = [];
    const connections: Connection[] = [];
    const sha1 = (b: string | Buffer) => createHash('sha1').update(b).digest();
    const server = mysql.createServer((connection) => {
      connections.push(connection); connection.on('error', () => {});
      connection.serverHandshake({ protocolVersion: 10, serverVersion: '8.0.0-smartdd-fixture', connectionId: 1, statusFlags: 2, characterSet: 45, capabilityFlags: 0x00088209,
        authCallback: (data: { user: string; database: string; authPluginData1: Buffer; authPluginData2: Buffer; authToken: Buffer }, cb: (error: unknown, mysqlError?: unknown) => void) => {
          const stage1 = sha1('fixture-password');
          const scramble = sha1(Buffer.concat([data.authPluginData1, data.authPluginData2, sha1(stage1)]));
          const expected = Buffer.from(stage1.map((v, i) => v ^ scramble[i]));
          const ok = data.user === 'selected_user' && data.database === 'selected_database' && expected.equals(data.authToken);
          authenticated.push(ok); cb(null, ok ? undefined : { message: 'fixture rejected credentials' });
          connection.sequenceId = 0;
        },
      });
      const answer = (sql: string) => {
        seen.push(sql);
        if (/^SELECT marker/i.test(sql)) {
          const wire = connection as unknown as { writeColumns: (columns: unknown[]) => void; writeTextRow: (row: string[]) => void };
          wire.writeColumns([{ catalog: 'def', schema: 'selected_database', table: 'probe', orgTable: 'probe', name: 'marker', orgName: 'marker', columnType: 253, characterSet: 45, columnLength: 40, flags: 0, decimals: 0 }]);
          wire.writeTextRow(['MYSQL_SELECTED']); connection.writeEof();
        }
        else connection.writeOk();
        connection.sequenceId = 0;
      };
      connection.on('query', answer);
      connection.on('stmt_prepare', answer); // mysql2's fixture server routes SET here.
    });
    // mysql2's Server type omits the standard listen/address overloads supported at runtime.
    const tcp = (server as unknown as { _server: TcpServer })._server;
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
    closers.push(async () => { connections.forEach((c) => c.destroy()); await new Promise<void>((resolve) => tcp.close(() => resolve())); });
    const result = await exec('python3', [queryScript(), '--db', 'selected-db', '--sql', 'SELECT marker FROM probe', '--format', 'json'], { env: pyEnv({ PROJECT_DB_CONFIG: dbConfig('mysql', (tcp.address() as AddressInfo).port), SMARTDD_DB_PROBE_PASSWORD: 'fixture-password' }), timeout: 7000 });
    expect(result.stdout).toContain('MYSQL_SELECTED'); expect(authenticated).toEqual([true]);
    expect(seen).toEqual(expect.arrayContaining(['SET TRANSACTION READ ONLY', 'BEGIN', 'SELECT marker FROM probe']));
    expect(result.stdout + result.stderr).not.toContain('fixture-password');
    expect(audit().map((r) => r.status)).toEqual(['attempted', 'connected', 'completed']);
    expect(audit()[1]).toMatchObject({ projectId: 'selected-project', resourceId: 'selected-db', configVersion: 7, configHash: 'fixture-hash', database: 'selected_database' });
    expect(JSON.stringify(audit())).not.toMatch(/fixture-password|SELECT marker/);
  });

  it('connects to the selected PostgreSQL target, applies the schema and sets a read-only transaction', async () => {
    const sockets: Socket[] = []; const queries: string[] = []; const credentials: string[] = [];
    const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
    const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
    const cstr = (s: string) => Buffer.from(s + '\0');
    const msg = (t: string, body: Buffer) => Buffer.concat([Buffer.from(t), i32(body.length + 4), body]);
    const ready = msg('Z', Buffer.from('I'));
    const server = createServer((socket) => {
      sockets.push(socket); let pending = Buffer.alloc(0); let startup = true;
      socket.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= (startup ? 4 : 5)) {
          const length = pending.readInt32BE(startup ? 0 : 1); const total = length + (startup ? 0 : 1);
          if (pending.length < total) break;
          const packet = pending.subarray(0, total); pending = pending.subarray(total);
          if (startup) {
            const protocol = packet.readInt32BE(4);
            if (protocol !== 196608) { socket.write('N'); continue; }
            credentials.push(packet.subarray(8).toString()); startup = false;
            socket.write(msg('R', i32(3))); continue;
          }
          const type = String.fromCharCode(packet[0]);
          if (type === 'p') {
            credentials.push(packet.subarray(5, -1).toString());
            socket.write(Buffer.concat([msg('R', i32(0)), msg('S', Buffer.concat([cstr('server_version'), cstr('16.1')])), msg('S', Buffer.concat([cstr('client_encoding'), cstr('UTF8')])), msg('S', Buffer.concat([cstr('standard_conforming_strings'), cstr('on')])), msg('K', Buffer.concat([i32(1), i32(2)])), ready]));
          } else if (type === 'Q') {
            const sql = packet.subarray(5, -1).toString(); queries.push(sql);
            if (/^SELECT/i.test(sql)) {
              const value = sql.includes('set_config') ? 'selected_schema' : 'PG_SELECTED';
              const field = sql.includes('set_config') ? 'set_config' : 'marker';
              socket.write(Buffer.concat([msg('T', Buffer.concat([i16(1), cstr(field), i32(0), i16(0), i32(25), i16(-1), i32(-1), i16(0)])), msg('D', Buffer.concat([i16(1), i32(value.length), Buffer.from(value)])), msg('C', cstr('SELECT 1')), ready]));
            } else socket.write(Buffer.concat([msg('C', cstr(sql.split(' ')[0])), ready]));
          } else if (type === 'X') socket.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(async () => { sockets.forEach((s) => s.destroy()); await new Promise<void>((resolve) => server.close(() => resolve())); });
    const result = await exec('python3', [queryScript(), '--db', 'selected-db', '--sql', 'SELECT marker FROM probe', '--format', 'json'], { env: pyEnv({ PROJECT_DB_CONFIG: dbConfig('postgres', (server.address() as AddressInfo).port), SMARTDD_DB_PROBE_PASSWORD: 'fixture-password' }), timeout: 7000 });
    expect(result.stdout).toContain('PG_SELECTED'); expect(credentials[0]).toContain('selected_user'); expect(credentials[0]).toContain('selected_database'); expect(credentials[1]).toBe('fixture-password');
    expect(queries.some((q) => q.includes('READ ONLY'))).toBe(true);
    expect(queries.some((q) => q.includes('set_config') && q.includes('"selected_schema"'))).toBe(true);
    expect(result.stdout + result.stderr).not.toContain('fixture-password');
    expect(audit()[1]).toMatchObject({ status: 'connected', resourceId: 'selected-db', schema: 'selected_schema' });
  });

  it('retains SQL guards and does not allow --allow-write on a readonly resource', async () => {
    const env = pyEnv({ PROJECT_DB_CONFIG: dbConfig('mysql', 1), SMARTDD_DB_PROBE_PASSWORD: 'fixture-password' });
    await expect(exec('python3', [queryScript(), '--db', 'selected-db', '--sql', 'DELETE FROM example'], { env })).rejects.toMatchObject({ code: 1 });
    await expect(exec('python3', [queryScript(), '--db', 'selected-db', '--sql', 'SELECT 1', '--allow-write'], { env })).rejects.toMatchObject({ stderr: expect.stringContaining('resource is readonly') });
  });
});

describe('reused SSH helper over OpenSSH', () => {
  it.each(['password', 'key', 'passphrase'] as const)('uses %s authentication against the selected loopback server', async (auth) => {
    const host = generateSshTestKey();
    const key = generateSshTestKey(auth === 'passphrase' ? 'fixture-passphrase' : '');
    const publicKey = utils.parseKey(key.public); if (publicKey instanceof Error) throw publicKey;
    const keyPath = join(tmp, 'id_key'); writeFileSync(keyPath, key.private, { mode: 0o600 });
    const executed: string[] = []; const accepted: string[] = []; const clients: { end: () => void }[] = [];
    const server = new SshServer({ hostKeys: [host.private] }, (client) => {
      clients.push(client); client.on('error', () => {});
      client.on('authentication', (ctx) => {
        if (ctx.username !== 'fixture-user') return ctx.reject();
        if (auth === 'password' && ctx.method === 'password' && ctx.password === 'fixture-password') { accepted.push('password'); return ctx.accept(); }
        if (auth !== 'password' && ctx.method === 'publickey' && ctx.key.data.equals(publicKey.getPublicSSH())) { accepted.push('key'); return ctx.accept(); }
        ctx.reject(['password', 'publickey']);
      });
      client.on('ready', () => client.on('session', (accept) => {
        const session = accept(); session.on('pty', (acceptPty) => acceptPty?.());
        session.on('exec', (acceptExec, _reject, info) => { executed.push(info.command); const stream = acceptExec(); stream.write('SSH_SELECTED\n'); stream.exit(0); stream.end(); });
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(async () => { clients.forEach((c) => c.end()); await new Promise<void>((resolve) => server.close(() => resolve())); });
    // OpenSSH does not honor HOME for its passwd-derived ~/.ssh path. Give it a private known_hosts
    // via a transparent test shim so this probe never modifies the user's known_hosts/config.
    const bin = join(tmp, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nexec /usr/bin/ssh -F /dev/null -o UserKnownHostsFile="$SMARTDD_TEST_KNOWN_HOSTS" "$@"\n', { mode: 0o700 });
    const config = join(tmp, 'servers.json');
    writeFileSync(config, JSON.stringify({ servers: [{ alias: 'selected-server', ip: '127.0.0.1', port: (server.address() as AddressInfo).port, username: 'fixture-user', authType: auth === 'password' ? 'password' : 'key', privateKeyPath: keyPath, passwordEnv: auth === 'password' ? 'SMARTDD_SSH_PASSWORD' : undefined, passphraseEnv: auth === 'passphrase' ? 'SMARTDD_SSH_PASSPHRASE' : undefined, defaultRoot: false, sudoPolicy: 'none' }] }));
    const result = await exec('python3', [sshScript(), '--target', 'selected-server', '--command', 'hostname'], { env: pyEnv({ PATH: bin + ':' + process.env.PATH, REMOTE_SERVERS_CONFIG: config, SMARTDD_TEST_KNOWN_HOSTS: join(tmp, 'known_hosts'), SMARTDD_SSH_PASSWORD: 'fixture-password', SMARTDD_SSH_PASSPHRASE: 'fixture-passphrase' }), timeout: 8000 });
    expect(result.stdout).toContain('SSH_SELECTED'); expect(executed).toEqual(['hostname']); expect(accepted.length).toBeGreaterThan(0);
    expect(result.stdout + result.stderr).not.toContain('fixture-password'); expect(result.stdout + result.stderr).not.toContain('fixture-passphrase');
    expect(audit().map((r) => r.status)).toEqual(['attempted', 'connected', 'completed']);
    expect(JSON.stringify(audit())).not.toMatch(/fixture-password|fixture-passphrase|hostname/);
  }, 10_000);

  it('blocks ambiguous targets and dangerous commands without starting SSH', async () => {
    const config = join(tmp, 'servers.json');
    const server = { alias: 'test', ip: '127.0.0.1', port: 1, username: 'nobody', passwordEnv: 'SMARTDD_SSH_PASSWORD' };
    writeFileSync(config, JSON.stringify({ servers: [server, { ...server, alias: 'test-other' }] }));
    const env = pyEnv({ REMOTE_SERVERS_CONFIG: config });
    await expect(exec('python3', [sshScript(), '--target', 'test', '--command', 'hostname'], { env })).rejects.toMatchObject({ code: 3 });
    writeFileSync(config, JSON.stringify({ servers: [server] }));
    await expect(exec('python3', [sshScript(), '--target', 'test', '--command', 'rm -rf /example'], { env })).rejects.toMatchObject({ code: 4 });
  });
});
