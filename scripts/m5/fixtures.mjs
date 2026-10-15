// Loopback control project. Wire fixtures are adapted from M4 resource-execution.test.ts.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2';
import ssh2 from 'ssh2';

const { Server: SshServer } = ssh2;

export async function controlResources(root) {
  const password = randomBytes(24).toString('hex');
  const seen = { database: [], ssh: [], authenticated: [] };
  const connections = [];
  const sha1 = (value) => createHash('sha1').update(value).digest();
  const database = mysql.createServer((connection) => {
    connections.push(connection); connection.on('error', () => {});
    connection.serverHandshake({ protocolVersion: 10, serverVersion: '8.0.0-smartdd-control', connectionId: 1, statusFlags: 2, characterSet: 45, capabilityFlags: 0x00088209,
      authCallback: (data, callback) => {
        const stage1 = sha1(password);
        const scramble = sha1(Buffer.concat([data.authPluginData1, data.authPluginData2, sha1(stage1)]));
        const expected = Buffer.from(stage1.map((v, i) => v ^ scramble[i]));
        const ok = data.user === 'm5_control' && data.database === 'smartdd_m5_control' && expected.equals(data.authToken);
        seen.authenticated.push(ok);
        callback(null, ok ? undefined : { message: 'Access denied for control fixture user', code: 1045, sqlState: '28000' });
        connection.sequenceId = 0;
      },
    });
    const answer = (sql) => {
      seen.database.push(sql);
      if (/^SELECT/i.test(sql)) {
        const names = ['current_database', 'current_user'];
        connection.writeColumns(names.map((name) => ({ catalog: 'def', schema: 'smartdd_m5_control', table: 'probe', orgTable: 'probe', name, orgName: name, columnType: 253, characterSet: 45, columnLength: 64, flags: 0, decimals: 0 })));
        connection.writeTextRow(['smartdd_m5_control', 'm5_control@loopback']); connection.writeEof();
      } else connection.writeOk();
      connection.sequenceId = 0;
    };
    connection.on('query', answer); connection.on('stmt_prepare', answer);
  });
  await new Promise((r) => database._server.listen(0, '127.0.0.1', r));
  const key = join(root, 'ssh-fixture-key');
  execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  const clients = [];
  const ssh = new SshServer({ hostKeys: [readFileSync(key)] }, (client) => {
    clients.push(client); client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'm5_control' && ctx.password === password) ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept(); session.on('pty', (acceptPty) => acceptPty?.());
      session.on('exec', (acceptExec, _reject, info) => {
        seen.ssh.push(info.command); const stream = acceptExec(); stream.write('SMARTDD_M5_CONTROL_SERVER\n'); stream.exit(0); stream.end();
      });
    }));
  });
  await new Promise((r) => ssh.listen(0, '127.0.0.1', r));
  return {
    password, seen, dbPort: database._server.address().port, sshPort: ssh.address().port,
    close: async () => {
      connections.forEach((c) => c.destroy()); clients.forEach((c) => c.end());
      await Promise.all([new Promise((r) => database.close(r)), new Promise((r) => ssh.close(r))]);
    },
  };
}
