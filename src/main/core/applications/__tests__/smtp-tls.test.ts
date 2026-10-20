import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server, type Socket } from 'node:net';
import { createSecureContext, getCACertificates, setDefaultCACertificates, TLSSocket } from 'node:tls';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionConfig } from '@shared/application-connections';
import { prepareSmtpMessage, submitSmtp, verifySmtp } from '../providers/smtp';
let directory: string, key: Buffer, cert: Buffer, server: Server | undefined;
const clients = new Set<Socket>(); let authentications = 0, submissions = 0, originalTrust: string[];
async function fixture(mode: 'starttls' | 'implicit-tls') {
  authentications = 0; submissions = 0; const context = createSecureContext({ key,cert });
  function session(socket: Socket,secured = false,greet = true) {
    clients.add(socket); socket.on('error',() => {}); socket.once('close',() => clients.delete(socket));
    if (greet) socket.write('220 isolated TLS fixture\r\n'); let buffer = '',data = false;
    const receive = (chunk: Buffer) => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const at = buffer.indexOf('\r\n'),line = buffer.slice(0,at); buffer = buffer.slice(at + 2);
        if (data) { if (line === '.') { submissions++; data = false; socket.write('250 queued fixture\r\n'); } continue; }
        if (line.startsWith('EHLO')) socket.write('250-fixture\r\n' + (secured ? '' : '250-STARTTLS\r\n') + '250 AUTH PLAIN\r\n');
        else if (line === 'STARTTLS' && !secured) {
          socket.removeListener('data',receive); socket.write('220 upgrade fixture\r\n');
          const tls = new TLSSocket(socket,{ isServer: true,secureContext: context }); tls.on('error',() => {}); session(tls,true,false); return;
        } else if (line.startsWith('AUTH')) { authentications++; socket.write(secured ? '235 authenticated fixture\r\n' : '530 TLS required\r\n'); }
        else if (line.startsWith('MAIL') || line.startsWith('RCPT')) socket.write('250 ok\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 start data\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('500 unsupported fixture\r\n');
      }
    };
    socket.on('data',receive);
  }
  server = createServer(socket => { if (mode === 'implicit-tls') { const tls = new TLSSocket(socket,{ isServer: true,secureContext: context }); tls.on('error',() => {}); session(tls,true); } else session(socket); });
  await new Promise<void>(resolve => server!.listen(0,'127.0.0.1',resolve)); const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('fixture');
  const config: Extract<ConnectionConfig,{ kind: 'smtp' }> = { kind: 'smtp',host: '127.0.0.1',port: addr.port,username: 'fixture@example.test',fromAddress: 'fixture@example.test',authMode: 'password',mode }; return config;
}
describe('SMTP explicit TLS modes with a process-local fixture CA', () => {
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(),'willyou-m10-smtp-tls-')); const keyPath = join(directory,'key.pem'),certPath = join(directory,'cert.pem'),cfg = join(directory,'openssl.conf');
    writeFileSync(cfg,'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',cfg,'-keyout',keyPath,'-out',certPath],{ stdio: 'ignore' });
    key = readFileSync(keyPath); cert = readFileSync(certPath); originalTrust = getCACertificates('default');
  });
  afterEach(async () => { setDefaultCACertificates(originalTrust); for (const c of clients) c.destroy(); clients.clear(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });
  afterAll(() => rmSync(directory,{ recursive: true,force: true }));
  it.each(['starttls','implicit-tls'] as const)('authenticates and submits through verified %s without disabling certificate checks',async mode => {
    setDefaultCACertificates([...originalTrust,cert.toString()]); const config = await fixture(mode),signal = new AbortController().signal;
    expect(await verifySmtp(config,'isolated-password',signal)).toMatchObject({ providerId: 'smtp' }); expect(authentications).toBe(1); expect(submissions).toBe(0);
    const prepared = await prepareSmtpMessage(config,{ to: ['to@example.test'],cc: [],bcc: [],subject: 'TLS fixture',text: 'isolated body',messageId: '<tls-fixture@example.test>',date: '2026-10-20T00:00:00Z',attachments: [] });
    expect(await submitSmtp(config,'isolated-password',prepared,signal)).toMatchObject({ state: 'server-accepted',complete: true }); expect(submissions).toBe(1);
  });
  it.each(['starttls','implicit-tls'] as const)('rejects an untrusted %s certificate before authentication',async mode => {
    const config = await fixture(mode);
    await expect(verifySmtp(config,'isolated-password',new AbortController().signal)).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' }); expect(authentications).toBe(0); expect(submissions).toBe(0);
  });
});
