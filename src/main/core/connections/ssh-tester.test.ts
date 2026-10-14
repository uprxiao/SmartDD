import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server, utils, type Connection } from 'ssh2';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SSH_TEST_COMMAND, testSsh, type SshTarget } from './ssh-tester';

// An in-process ssh2 server: no real host is contacted.

const hostKey = utils.generateKeyPairSync('ed25519');
const clientKey = utils.generateKeyPairSync('ed25519');
const lockedKey = utils.generateKeyPairSync('ed25519', { passphrase: 'right-pp', cipher: 'aes256-cbc', rounds: 16 });
const clientPublic = utils.parseKey(clientKey.public);
const lockedPublic = utils.parseKey(lockedKey.public);

let tmp: string;
let port = 0;
let server: Server;
const executed: string[] = [];
const clients: Connection[] = [];
const extras: TcpServer[] = [];
const extraSockets: Socket[] = [];

function keyMatches(ctx: { key: { algo: string; data: Buffer } }, pub: ReturnType<typeof utils.parseKey>): boolean {
  if (pub instanceof Error) return false;
  return ctx.key.algo === pub.type && ctx.key.data.equals(pub.getPublicSSH());
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'smartdd-ssh-'));
  writeFileSync(join(tmp, 'id_ed25519'), clientKey.private, { mode: 0o600 });
  writeFileSync(join(tmp, 'id_locked'), lockedKey.private, { mode: 0o600 });
  server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    clients.push(client);
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.username !== 'deploy') return ctx.reject();
      if (ctx.method === 'password' && ctx.password === 'right-pw') return ctx.accept();
      if (ctx.method === 'publickey' && (keyMatches(ctx, clientPublic) || keyMatches(ctx, lockedPublic))) return ctx.accept();
      ctx.reject(['password', 'publickey']);
    });
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        acceptSession().once('exec', (accept, _reject, info) => {
          executed.push(info.command);
          const stream = accept();
          stream.write('web-01\ndeploy\n');
          stream.exit(0);
          stream.end();
        });
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  extraSockets.splice(0).forEach((s) => s.destroy());
  extras.splice(0).forEach((s) => s.close());
});
afterAll(async () => {
  clients.forEach((c) => c.end());
  await new Promise((r) => server.close(r));
  rmSync(tmp, { recursive: true, force: true });
});

const target = (over: Partial<SshTarget>): SshTarget => ({
  host: '127.0.0.1',
  port,
  username: 'deploy',
  authType: 'password',
  password: 'right-pw',
  privateKeyPath: null,
  passphrase: '',
  ...over,
});

describe('testSsh', () => {
  it('logs in with a password, runs only the read-only command and reports the host fingerprint', async () => {
    executed.length = 0;
    const r = await testSsh(target({}), 5000);
    expect(r).toMatchObject({ ok: true, category: 'ok' });
    expect(r.detail).toMatch(/^web-01 \/ deploy；主机指纹 SHA256:[A-Za-z0-9+/]{43}$/);
    expect(executed).toEqual([SSH_TEST_COMMAND]);
  });

  it('logs in with a private key', async () => {
    const r = await testSsh(target({ authType: 'key', password: '', privateKeyPath: join(tmp, 'id_ed25519') }), 5000);
    expect(r).toMatchObject({ ok: true });
  });

  it('logs in with a passphrase-protected key', async () => {
    const r = await testSsh(target({ authType: 'key', privateKeyPath: join(tmp, 'id_locked'), passphrase: 'right-pp' }), 5000);
    expect(r).toMatchObject({ ok: true });
  });

  it('a wrong password is an authentication failure and is not echoed', async () => {
    const r = await testSsh(target({ password: 'wrong-pw' }), 5000);
    expect(r).toMatchObject({ ok: false, category: 'auth' });
    expect(r.message).not.toContain('wrong-pw');
  });

  it('a wrong user is an authentication failure', async () => {
    expect(await testSsh(target({ username: 'root' }), 5000)).toMatchObject({ ok: false, category: 'auth' });
  });

  it('a missing key file is a configuration problem, reported before connecting', async () => {
    const r = await testSsh(target({ authType: 'key', privateKeyPath: join(tmp, 'missing') }), 5000);
    expect(r).toMatchObject({ ok: false, category: 'config' });
    expect(r.message).toContain('私钥文件不可读');
  });

  it('a key that is not a key, or a wrong passphrase, is a configuration problem', async () => {
    writeFileSync(join(tmp, 'garbage'), 'not a key');
    expect(await testSsh(target({ authType: 'key', privateKeyPath: join(tmp, 'garbage') }), 5000)).toMatchObject({
      category: 'config',
    });
    expect(
      await testSsh(target({ authType: 'key', privateKeyPath: join(tmp, 'id_locked'), passphrase: 'wrong-pp' }), 5000)
    ).toMatchObject({ category: 'config' });
  });

  it('a closed port is a network failure', async () => {
    const tcp = createTcpServer();
    await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
    const closed = (tcp.address() as AddressInfo).port;
    await new Promise((r) => tcp.close(r));
    expect(await testSsh(target({ port: closed }), 3000)).toMatchObject({ ok: false, category: 'network' });
  });

  it('a server that never sends a banner times out', async () => {
    const silent = createTcpServer((s) => extraSockets.push(s));
    extras.push(silent);
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    const r = await testSsh(target({ port: (silent.address() as AddressInfo).port }), 300);
    expect(r).toMatchObject({ ok: false, category: 'timeout' });
    expect(r.ms).toBeLessThan(2000);
  });
});
