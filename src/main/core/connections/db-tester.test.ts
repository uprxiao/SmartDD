import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { testDatabase, type DbTarget } from './db-tester';

// Fake servers on 127.0.0.1 only: no real database is touched and no account can be locked.

const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.destroy());
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function listen(onConnection: (socket: Socket) => void): Promise<number> {
  const server = createServer((s) => {
    sockets.push(s);
    onConnection(s);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

/** A port that was free a moment ago: connecting to it is refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  await new Promise((r) => server.close(r));
  return port;
}

const target = (over: Partial<DbTarget>): DbTarget => ({
  transport: 'postgres',
  host: '127.0.0.1',
  port: 1,
  database: 'app',
  schema: null,
  username: 'app',
  password: 'Pw-under-test',
  ...over,
});

/** Backend message: type byte + int32 length (including itself) + body. */
function message(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeInt32BE(body.length + 4);
  return Buffer.concat([Buffer.from(type), len, body]);
}
const int32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const cstr = (s: string) => Buffer.from(`${s}\0`);

/** Answers the startup packet once with `reply`, then stays silent. */
const fakePostgres = (reply: Buffer) => listen((s) => s.once('data', () => s.write(reply)));

describe('testDatabase — network and timeout', () => {
  it.each(['mysql', 'postgres'] as const)('%s: a closed port is a network failure', async (transport) => {
    const r = await testDatabase(target({ transport, port: await closedPort() }), 2000);
    expect(r).toMatchObject({ ok: false, category: 'network' });
    expect(r.message).toContain('ECONNREFUSED');
  });

  it.each(['mysql', 'postgres'] as const)('%s: a server that accepts but never answers times out', async (transport) => {
    const port = await listen(() => {});
    const r = await testDatabase(target({ transport, port }), 300);
    expect(r).toMatchObject({ ok: false, category: 'timeout' });
    expect(r.ms).toBeGreaterThanOrEqual(250);
    expect(r.ms).toBeLessThan(2000);
  });

  it('an unresolvable host is a network failure', async () => {
    const r = await testDatabase(target({ transport: 'mysql', host: 'no-such-host.invalid', port: 3306 }), 3000);
    expect(r).toMatchObject({ ok: false, category: 'network' });
  });
});

describe('testDatabase — postgres protocol answers', () => {
  const pgError = (code: string, text: string) =>
    message('E', Buffer.concat([cstr('SFATAL'), cstr(`C${code}`), cstr(`M${text}`), Buffer.from([0])]));

  it('28P01 is an authentication failure', async () => {
    const port = await fakePostgres(pgError('28P01', 'password authentication failed for user "app"'));
    expect(await testDatabase(target({ port }), 2000)).toMatchObject({ ok: false, category: 'auth' });
  });

  it('3D000 is a missing database', async () => {
    const port = await fakePostgres(pgError('3D000', 'database "nope" does not exist'));
    const r = await testDatabase(target({ port, database: 'nope' }), 2000);
    expect(r).toMatchObject({ ok: false, category: 'database' });
    expect(r.message).toContain('"nope" does not exist');
  });

  it('a SASL mechanism other than SCRAM-SHA-256 (openGauss style) is unsupported auth', async () => {
    const port = await fakePostgres(message('R', Buffer.concat([int32(10), cstr('SM3'), Buffer.from([0])])));
    expect(await testDatabase(target({ port }), 2000)).toMatchObject({ ok: false, category: 'unsupported_auth' });
  });

  it('an authentication code the driver does not know is unsupported auth', async () => {
    const port = await fakePostgres(message('R', int32(99)));
    expect(await testDatabase(target({ port }), 2000)).toMatchObject({ ok: false, category: 'unsupported_auth' });
  });

  it('never echoes the password back in the message', async () => {
    const port = await fakePostgres(pgError('28P01', 'bad password Pw-under-test'));
    const r = await testDatabase(target({ port }), 2000);
    expect(r.message).not.toContain('Pw-under-test');
    expect(r.message).toContain('***');
  });
});
