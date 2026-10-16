import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TRANSFER_LIMITS, passphraseIssue } from '@shared/project-transfer';
import { decryptProject, encryptProject, inspectEnvelope, strictJson, validatePayload } from './transfer-format';
import { transferFixture } from './transfer-fixtures';

// A sender can authenticate malformed JSON. Bypass the producer validator in this
// test only, so receiver-side validation is exercised after successful GCM auth.
function authenticatedInvalidPayload(json: string): Buffer {
  const kdf = { name: 'scrypt', N: 131072, r: 8, p: 1, salt: randomBytes(16).toString('base64') };
  const cipherHeader = { name: 'aes-256-gcm', nonce: randomBytes(12).toString('base64') };
  const header = { format: 'willyou.project', version: 1, kdf, cipher: cipherHeader };
  const key = scryptSync('12345678', Buffer.from(kdf.salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 });
  try {
    const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(cipherHeader.nonce, 'base64'));
    cipher.setAAD(Buffer.from(JSON.stringify(header)));
    const ciphertext = Buffer.concat([cipher.update(json), cipher.final()]).toString('base64');
    return Buffer.from(JSON.stringify({ ...header, cipher: { ...cipherHeader, tag: cipher.getAuthTag().toString('base64') }, ciphertext }));
  } finally { key.fill(0); }
}

describe('M8 portable encryption and strict input', () => {
  it('E02 accepts eight characters, preserves whitespace/Chinese, and enforces UTF-8 length', async () => {
    expect(passphraseIssue('1234567')).toBeTruthy(); expect(passphraseIssue('12345678')).toBeNull();
    expect(passphraseIssue('你好'.repeat(172))).toBeTruthy(); expect(passphraseIssue('12345678', '12345679')).toBeTruthy();
    for (const password of ['12345678', ' 中文口令1234 ']) expect(await decryptProject(await encryptProject(transferFixture(), password), password)).toEqual(transferFixture());
    await expect(encryptProject(transferFixture(), '1234567')).rejects.toThrow('8');
  });
  it('I01/S01 authenticates before exposing data and uses a fresh salt and nonce', async () => {
    const a = await encryptProject(transferFixture(), 'sample-password'), b = await encryptProject(transferFixture(), 'sample-password');
    expect(a.toString()).not.toContain('synthetic'); expect(a.toString()).not.toContain('迁移项目');
    expect(inspectEnvelope(a).kdf.salt).not.toBe(inspectEnvelope(b).kdf.salt);
    expect(inspectEnvelope(a).cipher.nonce).not.toBe(inspectEnvelope(b).cipher.nonce);
    await expect(decryptProject(a, 'wrong-password')).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
  });
  it('I03 rejects tampered ciphertext, nonce, salt and tag', async () => {
    const raw = await encryptProject(transferFixture(), 'sample-password');
    for (const field of ['ciphertext', 'nonce', 'salt', 'tag']) {
      const h = JSON.parse(raw.toString()), node = field === 'ciphertext' ? h : field === 'salt' ? h.kdf : h.cipher;
      const data = Buffer.from(node[field], 'base64'); data[0] ^= 1; node[field] = data.toString('base64');
      await expect(decryptProject(Buffer.from(JSON.stringify(h)), 'sample-password')).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
    }
    expect(() => inspectEnvelope(raw.subarray(0, raw.length - 4))).toThrow();
  });
  it('I04/I05 rejects unsupported versions, limits, invalid encoding and expensive KDFs before deriving', async () => {
    const h = inspectEnvelope(await encryptProject(transferFixture(), 'sample-password'));
    for (const changed of [{ ...h, version: 99 }, { ...h, format: 'other' }, { ...h, extra: true }, { ...h, kdf: { ...h.kdf, N: 2 ** 30 } }, { ...h, cipher: { ...h.cipher, tag: '!!!' } }, { ...h, cipher: { ...h.cipher, nonce: '' } }]) expect(() => inspectEnvelope(Buffer.from(JSON.stringify(changed)))).toThrow();
    expect(() => inspectEnvelope(Buffer.alloc(TRANSFER_LIMITS.file + 1))).toThrow();
    expect(() => inspectEnvelope(Buffer.from([0xff]))).toThrow();
    expect(() => validatePayload({ ...transferFixture(), schemaVersion: 2 })).toThrow();
  });
  it('I06 rejects duplicate JSON keys including escaped equivalents and excessive nesting', () => {
    for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"__proto__":{}}', '[1,]', '{"a":01}', '1 trailing', '['.repeat(66) + '1' + ']'.repeat(66)]) expect(() => strictJson(text)).toThrow();
    expect(strictJson('{"a":[true,false,null,-1.2e3,"escaped \\\" value"]}')).toEqual({ a: [true, false, null, -1200, 'escaped " value'] });
  });
  it('I06 rejects unknown fields, orphan credentials, missing credentials and invalid defaults', () => {
    const variants: unknown[] = [];
    let p: any = transferFixture(); p.project.extra = 'ignored?'; variants.push(p);
    p = transferFixture(); p.credentials.orphan = { password: 'x' }; variants.push(p);
    p = transferFixture(); delete p.credentials['db-1']; variants.push(p);
    p = transferFixture(); p.directories[0].isDefault = false; variants.push(p);
    p = transferFixture(); p.databases.push({ ...p.databases[0], ref: 'db-2' }); p.credentials['db-2'] = { password: '' }; variants.push(p);
    p = transferFixture(); p.servers[0].ref = 'db-1'; variants.push(p);
    p = transferFixture(); p.capabilities[0].id = 'unknown'; variants.push(p);
    p = transferFixture(); p.databases[0].port = 70000; variants.push(p);
    p = transferFixture(); p.databases[0].vendor = 'unknown'; variants.push(p);
    p = transferFixture(); p.profiles[0].env[0].secret = false; p.profiles[0].env[0].value = 'secret'; variants.push(p);
    for (const variant of variants) expect(() => validatePayload(variant)).toThrow();
    p = transferFixture(); p.credentials['db-1'].password = ''; expect(validatePayload(p).credentials['db-1'].password).toBe('');
  });
  it('I05 bounds resource counts and private key size', () => {
    const p = transferFixture(); p.directories = Array.from({ length: 51 }, (_, i) => ({ ref: `d-${i}`, path: `/p/${i}`, label: '', isDefault: i === 0 })); expect(() => validatePayload(p)).toThrow();
    const k = transferFixture(); k.servers[0].authType = 'key'; k.credentials['ssh-1'] = { privateKey: { encoding: 'base64', data: Buffer.alloc(TRANSFER_LIMITS.key + 1).toString('base64') }, sudoPassword: '' }; expect(() => validatePayload(k)).toThrow();
    k.credentials['ssh-1'].privateKey!.data = ''; expect(() => validatePayload(k)).toThrow();
  });
  it('I05 rejects ciphertext over the plaintext cap before any password derivation', async () => {
    const h = inspectEnvelope(await encryptProject(transferFixture(), '12345678'));
    h.ciphertext = Buffer.alloc(TRANSFER_LIMITS.payload + 1).toString('base64');
    const oversized = Buffer.from(JSON.stringify(h));
    expect(oversized.length).toBeLessThan(TRANSFER_LIMITS.file);
    expect(() => inspectEnvelope(oversized)).toThrow();
    await expect(decryptProject(oversized, 'wrong')).rejects.not.toMatchObject({ code: 'UNLOCK_FAILED' });
  });
  it('I04/I06 rejects authenticated malformed payloads without exposing the values', async () => {
    const inputs: string[] = [];
    const changed = (edit: (p: any) => void) => { const p = transferFixture(); edit(p); inputs.push(JSON.stringify(p)); };
    changed(p => { p.schemaVersion = 2; });
    changed(p => { p.databases[0].port = 0; });
    changed(p => { p.databases[0].vendor = 'unsupported'; });
    changed(p => { p.servers[0].ref = p.databases[0].ref; });
    changed(p => { p.credentials.orphan = { password: 'must-not-appear-in-error' }; });
    changed(p => { p.directories[0].isDefault = false; });
    changed(p => { p.capabilities[0].id = 'unsupported'; });
    changed(p => { p.credentials['db-1'].unrecognized = 'must-not-appear-in-error'; });
    inputs.push(JSON.stringify(transferFixture()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'));
    for (const json of inputs) {
      try { await decryptProject(authenticatedInvalidPayload(json), '12345678'); expect.fail('Authenticated invalid payload was accepted'); }
      catch (error) {
        expect(error).toHaveProperty('code');
        expect(error).not.toMatchObject({ code: 'UNLOCK_FAILED' });
        expect(String(error)).not.toMatch(/must-not-appear-in-error|synthetic-db-password|synthetic-token/);
      }
    }
  }, 20_000);
});
