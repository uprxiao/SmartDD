import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionConfig } from '@shared/application-connections';
import { prepareSmtpMessage, submitSmtp, verifySmtp, type FrozenMailInput } from '../providers/smtp';
let server: Server, sockets: Set<Socket>, commands: string[], messages: Buffer[], port: number;
let options: { rejectAuth?: boolean; rejectRecipient?: string; advertiseTls?: boolean; dropReceipt?: boolean; holdReceipt?: boolean };
const config = (mode: 'plain' | 'starttls' | 'implicit-tls' = 'plain'): Extract<ConnectionConfig, { kind: 'smtp' }> => ({ kind: 'smtp', host: '127.0.0.1', port, username: 'fixture@example.test', fromAddress: 'fixture@example.test', authMode: 'password', mode });
const input = (): FrozenMailInput => ({ to: ['to@example.test'], cc: [], bcc: ['private@example.test'], subject: '隔离邮件', text: 'fixture body\n.dot line', messageId: '<fixed-fixture@example.test>', date: '2026-10-20T00:00:00Z', attachments: [{ filename: 'fixture.txt', contentType: 'text/plain', content: Buffer.from('isolated attachment') }] });
const signal = () => new AbortController().signal;
beforeEach(async () => {
  sockets = new Set(); commands = []; messages = []; options = {};
  server = createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.write('220 fixture ESMTP\r\n'); let pending = '', data = false, raw: string[] = [], login = 0;
    socket.on('data', chunk => {
      pending += chunk.toString('utf8');
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n'), line = pending.slice(0, end); pending = pending.slice(end + 2);
        if (data) {
          if (line === '.') { messages.push(Buffer.from(raw.join('\r\n') + '\r\n')); raw = []; data = false; if (options.dropReceipt) socket.destroy(); else if(!options.holdReceipt)socket.write('250 2.0.0 queued fixture\r\n'); }
          else raw.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        commands.push(line.startsWith('AUTH') || login ? 'AUTH [fixture redacted]' : line);
        if (login) { login--; socket.write(login ? '334 UGFzc3dvcmQ6\r\n' : options.rejectAuth ? '535 5.7.8 auth refused\r\n' : '235 2.7.0 authenticated\r\n'); }
        else if (/^EHLO\b/.test(line)) socket.write('250-fixture\r\n' + (options.advertiseTls ? '250-STARTTLS\r\n' : '') + '250 AUTH PLAIN LOGIN\r\n');
        else if (/^HELO\b/.test(line)) socket.write('250 fixture\r\n');
        else if (/^AUTH PLAIN\b/.test(line)) socket.write(options.rejectAuth ? '535 5.7.8 auth refused\r\n' : '235 2.7.0 authenticated\r\n');
        else if (/^AUTH LOGIN\b/.test(line)) { login = 2; socket.write('334 VXNlcm5hbWU6\r\n'); }
        else if (/^MAIL FROM:/.test(line)) socket.write('250 2.1.0 sender ok\r\n');
        else if (/^RCPT TO:/.test(line)) socket.write(options.rejectRecipient && line.includes(options.rejectRecipient) ? '550 5.1.1 recipient refused\r\n' : '250 2.1.5 recipient ok\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 End with dot\r\n'); }
        else if (line === 'QUIT') { socket.end('221 bye\r\n'); }
        else socket.write('500 unsupported\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('fixture'); port = addr.port;
});
afterEach(async () => { for (const s of sockets) s.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });

describe('SMTP adapter over an isolated local protocol server', () => {
  it('verifies authentication without issuing MAIL, RCPT or DATA and obeys explicit plain mode', async () => {
    options.advertiseTls = true;
    expect(await verifySmtp(config(), 'fixture-private-password', signal())).toMatchObject({ providerId: 'smtp', accountId: 'fixture@example.test' });
    expect(commands.some(c => /^(MAIL|RCPT|DATA|STARTTLS)/.test(c))).toBe(false); expect(messages).toHaveLength(0);
  });
  it('does not authenticate if required STARTTLS is absent, and sanitizes auth failures', async () => {
    await expect(verifySmtp(config('starttls'), 'fixture-private-password', signal())).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' });
    expect(commands.some(c => c.startsWith('AUTH'))).toBe(false);
    options.rejectAuth = true;
    await expect(verifySmtp(config(), 'fixture-private-password', signal())).rejects.toMatchObject({ code: 'AUTH_FAILED', message: '发件账号认证失败' });
  });
  it('submits the exact frozen bytes with private BCC envelope and a stable message ID', async () => {
    const prepared = await prepareSmtpMessage(config(), input());
    const result = await submitSmtp(config(), 'fixture-private-password', prepared, signal());
    expect(result).toMatchObject({ state: 'server-accepted', complete: true, accepted: ['to@example.test', 'private@example.test'], rejected: [], smtpCode: 250, messageId: input().messageId });
    expect(messages).toHaveLength(1); expect(messages[0]).toEqual(prepared.raw); expect(messages[0].toString()).not.toMatch(/^Bcc:/mi);
    expect(commands.filter(c => c === 'DATA')).toHaveLength(1);
  });
  it('preserves a partial recipient receipt instead of claiming all recipients were accepted', async () => {
    options.rejectRecipient = 'private@example.test';
    const result = await submitSmtp(config(), 'fixture-private-password', await prepareSmtpMessage(config(), input()), signal());
    expect(result).toMatchObject({ state: 'server-accepted', complete: false, accepted: ['to@example.test'], rejected: ['private@example.test'] }); expect(messages).toHaveLength(1);
  });
  it('marks a lost DATA acknowledgement unknown and performs exactly one submission', async () => {
    options.dropReceipt = true;
    const result = await submitSmtp(config(), 'fixture-private-password', await prepareSmtpMessage(config(), input()), signal());
    expect(result.state).toBe('unknown'); expect(result.complete).toBe(false); expect(messages).toHaveLength(1); expect(commands.filter(c => c === 'DATA')).toHaveLength(1);
  });
  it('retries a refused connection boundedly and reports a definite failure when nothing was ever written', async () => {
    for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve()));
    const result = await submitSmtp(config(), 'fixture-private-password', await prepareSmtpMessage(config(), input()), signal());
    expect(result).toMatchObject({ state: 'failed', complete: false, errorCode: 'ECONNREFUSED', accepted: [], rejected: [] });
    expect(commands).toEqual([]); expect(messages).toEqual([]);
  });
  it('completes exactly one business submission when the server becomes reachable during connect retries', async () => {
    for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve()));
    const pending = submitSmtp(config(), 'fixture-private-password', await prepareSmtpMessage(config(), input()), signal());
    await new Promise(resolve => setTimeout(resolve, 150)); await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    expect(await pending).toMatchObject({ state: 'server-accepted', complete: true });
    expect(messages).toHaveLength(1); expect(commands.filter(c => c === 'DATA')).toHaveLength(1);
  });
  it('drains the actual SMTP callback and owned socket when canceled while DATA receipt is withheld',async()=>{
    options.holdReceipt=true;const controller=new AbortController(),prepared=await prepareSmtpMessage(config(),input()),pending=submitSmtp(config(),'fixture-private-password',prepared,controller.signal);await vi.waitFor(()=>expect(messages).toHaveLength(1));
    const closed=Promise.all([...sockets].map(socket=>new Promise<void>(done=>socket.once('close',()=>done()))));controller.abort();expect(await pending).toMatchObject({state:'unknown',complete:false,errorCode:'CANCELED'});await closed;expect(sockets.size).toBe(0);expect(commands.filter(command=>command==='DATA')).toHaveLength(1);expect(messages[0]).toEqual(prepared.raw);
  });
  it('rejects changed bytes, envelope or cancellation before opening a connection', async () => {
    const prepared = await prepareSmtpMessage(config(), input()), controller = new AbortController(); controller.abort();
    expect(await submitSmtp(config(), 'fixture', prepared, controller.signal)).toMatchObject({ state: 'failed', errorCode: 'CANCELED' });
    expect(await submitSmtp(config(), 'fixture', { ...prepared, raw: Buffer.from('mutated') }, signal())).toMatchObject({ state: 'failed', errorCode: 'CONTENT_CHANGED' });
    expect(await submitSmtp(config(), 'fixture', { ...prepared, envelope: { ...prepared.envelope, to: ['unapproved@example.test'] } }, signal())).toMatchObject({ state: 'failed', errorCode: 'CONTENT_CHANGED' });
    expect(commands).toEqual([]); expect(messages).toEqual([]);
  });
  it('rejects header injection, absent recipients and oversized attachment input before serialization', async () => {
    await expect(prepareSmtpMessage(config(), { ...input(), subject: 'injected\r\nBcc: outside@example.test' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(prepareSmtpMessage(config(), { ...input(), to: [], bcc: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(prepareSmtpMessage(config(), { ...input(), attachments: [{ filename: 'too-big', contentType: 'text/plain', content: Buffer.alloc(25 * 1024 * 1024 + 1) }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(commands).toEqual([]);
  });
});
