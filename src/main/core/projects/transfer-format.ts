import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { z } from 'zod';
import { aiProfileInputSchema, isSecretEnvName } from '@shared/ai-profiles';
import { databaseInputSchema, dirInputSchema, projectInputSchema, serverInputSchema } from '@shared/projects';
import { passphraseIssue, TRANSFER_CAPABILITIES, TRANSFER_LIMITS, type TransferErrorCode } from '@shared/project-transfer';

export class TransferError extends Error {
  constructor(public readonly code: TransferErrorCode, message: string) { super(message); }
}
const bad = (code: TransferErrorCode, message: string): never => { throw new TransferError(code, message); };

/** A bounded JSON reader that rejects duplicate decoded keys, before schema validation. */
export function strictJson(text: string): unknown {
  let i = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const fail = (): never => bad('MALFORMED', '文件格式无效，请重新选择有效的 WillYou 文件');
  const ws = () => { while (/[\x20\t\r\n]/.test(text[i] ?? '\0')) i++; };
  const string = (): string => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') {
        try { return JSON.parse(text.slice(start, i)) as string; } catch { return fail(); }
      }
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 64) return fail();
    ws();
    if (text[i] === '"') return string();
    if (text[i] === '{') {
      i++; ws();
      const out: Record<string, unknown> = Object.create(null);
      const keys = new Set<string>();
      if (text[i] === '}') { i++; return out; }
      for (;;) {
        ws(); if (text[i] !== '"') return fail();
        const key = string();
        if (keys.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) return fail();
        keys.add(key); ws(); if (text[i++] !== ':') return fail();
        out[key] = value(depth + 1); ws();
        if (text[i] === '}') { i++; return out; }
        if (text[i++] !== ',') return fail();
      }
    }
    if (text[i] === '[') {
      i++; ws(); const out: unknown[] = [];
      if (text[i] === ']') { i++; return out; }
      for (;;) {
        out.push(value(depth + 1)); ws();
        if (text[i] === ']') { i++; return out; }
        if (text[i++] !== ',') return fail();
      }
    }
    for (const [word, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(word, i)) { i += word.length; return result; }
    }
    number.lastIndex = i;
    const match = number.exec(text);
    if (!match) return fail();
    i += match[0].length;
    const n = Number(match[0]); if (!Number.isFinite(n)) return fail();
    return n;
  };
  const result = value(0); ws(); if (i !== text.length) return fail(); return result;
}

const refSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const { password: _dbPassword, ...dbShape } = databaseInputSchema.shape;
const { password: _srvPassword, passphrase: _passphrase, sudoPassword: _sudo, privateKeyPath: _keyPath, ...serverShape } = serverInputSchema.shape;
const { isDefault: _default, env: _env, ...profileShape } = aiProfileInputSchema.shape;
const secretSchema = z.strictObject({
  password: z.string().max(4096).optional(), passphrase: z.string().max(4096).optional(), sudoPassword: z.string().max(4096).optional(),
  privateKey: z.strictObject({ encoding: z.literal('base64'), data: z.string().max(Math.ceil(TRANSFER_LIMITS.key / 3) * 4) }).optional(),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(255), z.string().max(8192)).optional(),
});
export const payloadSchema = z.strictObject({
  schemaVersion: z.literal(1), exportedAt: z.string().datetime(),
  producer: z.strictObject({ name: z.string().max(100), appVersion: z.string().max(40), platform: z.string().max(40) }),
  project: projectInputSchema.strict(),
  directories: z.array(z.strictObject({ ref: refSchema, ...dirInputSchema.shape, isDefault: z.boolean() })).max(50),
  databases: z.array(z.strictObject({ ref: refSchema, ...dbShape })).max(100),
  servers: z.array(z.strictObject({ ref: refSchema, ...serverShape, privateKeyPath: z.null() })).max(100),
  capabilities: z.array(z.strictObject({ id: z.enum(TRANSFER_CAPABILITIES), enabled: z.boolean() })).length(3),
  profiles: z.array(z.strictObject({ ref: refSchema, ...profileShape, env: z.array(z.strictObject({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(255), secret: z.boolean(), value: z.string().max(8192).nullable() })).max(100) })).max(50),
  credentials: z.record(refSchema, secretSchema),
});
export type PortableProject = z.infer<typeof payloadSchema>;

export function strictBase64(input: string, length?: number): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input)) return bad('MALFORMED', '文件编码无效');
  const result = Buffer.from(input, 'base64');
  if (result.toString('base64') !== input || (length !== undefined && result.length !== length)) return bad('MALFORMED', '文件编码长度无效');
  return result;
}
export function validatePayload(input: unknown): PortableProject {
  if (input && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion !== 1) bad('UNSUPPORTED_VERSION', '此项目文件版本暂不支持，请升级 WillYou 或重新导出');
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    // Never echo a value or a parser message containing a secret.
    const path = parsed.error.issues[0]?.path.filter(k => typeof k === 'number' || /^[A-Za-z_]+$/.test(String(k))).join('.') || 'package';
    return bad('INVALID_PAYLOAD', `项目文件字段无效（${path}），未导入任何数据`);
  }
  const p = parsed.data;
  const invalid = () => bad('INVALID_PAYLOAD', '项目文件的默认项、能力或资源引用无效，未导入任何数据');
  const refs = [...p.directories, ...p.databases, ...p.servers, ...p.profiles].map(r => r.ref);
  if (new Set(refs).size !== refs.length || new Set(p.capabilities.map(c => c.id)).size !== 3) invalid();
  if (p.directories.length && p.directories.filter(d => d.isDefault).length !== 1) invalid();
  if (p.databases.filter(d => d.isDefault).length > 1) invalid();
  const used = new Set<string>();
  const credential = (ref: string, fields: string[], required: string[]) => {
    const c = p.credentials[ref];
    if (required.some(k => !c || !Object.hasOwn(c, k))) bad('MISSING_CREDENTIAL', '项目文件缺少必要凭据，请让发送方重新导出');
    if (c) { used.add(ref); if (Object.keys(c).some(k => !fields.includes(k))) invalid(); }
    return c;
  };
  for (const d of p.databases) credential(d.ref, ['password'], ['password']);
  for (const s of p.servers) {
    const allowed = s.authType === 'key' ? ['privateKey', 'passphrase'] : ['password'];
    const required = [s.authType === 'key' ? 'privateKey' : 'password'];
    if (s.sudoPolicy === 'separate') { allowed.push('sudoPassword'); required.push('sudoPassword'); }
    if (s.defaultRoot && s.sudoPolicy === 'same-as-login' && s.authType === 'key') invalid();
    const c = credential(s.ref, allowed, required);
    if (c?.privateKey) { const b = strictBase64(c.privateKey.data); const valid = b.length > 0 && b.length <= TRANSFER_LIMITS.key; b.fill(0); if (!valid) invalid(); }
  }
  for (const profile of p.profiles) {
    if (!aiProfileInputSchema.safeParse({ ...profile, isDefault: false }).success) invalid();
    const names = profile.env.filter(e => e.secret).map(e => e.name);
    if (profile.env.some(e => (e.secret && e.value !== null) || (!e.secret && (e.value === null || isSecretEnvName(e.name))))) invalid();
    const c = credential(profile.ref, ['env'], names.length ? ['env'] : []);
    if (names.some(n => !c?.env || !Object.hasOwn(c.env, n)) || Object.keys(c?.env ?? {}).some(n => !names.includes(n))) invalid();
  }
  if (Object.keys(p.credentials).some(k => !used.has(k))) invalid();
  return p;
}

const PARAMS = { name: 'scrypt', N: 131072, r: 8, p: 1 } as const;
const envelopeSchema = z.strictObject({
  format: z.literal('willyou.project'), version: z.literal(1),
  kdf: z.strictObject({ name: z.literal(PARAMS.name), N: z.literal(PARAMS.N), r: z.literal(PARAMS.r), p: z.literal(PARAMS.p), salt: z.string().max(32) }),
  cipher: z.strictObject({ name: z.literal('aes-256-gcm'), nonce: z.string().max(24), tag: z.string().max(32) }),
  ciphertext: z.string().max(Math.ceil(TRANSFER_LIMITS.payload / 3) * 4),
});
type Envelope = z.infer<typeof envelopeSchema>;
const aad = (h: Envelope) => Buffer.from(JSON.stringify({ format: h.format, version: h.version, kdf: { ...PARAMS, salt: h.kdf.salt }, cipher: { name: h.cipher.name, nonce: h.cipher.nonce } }));
const decodeUtf8 = (b: Uint8Array) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return bad('MALFORMED', '文件编码无效'); } };
export function inspectEnvelope(raw: Uint8Array): Envelope {
  if (raw.byteLength > TRANSFER_LIMITS.file) bad('TOO_LARGE', '项目文件不能超过 16 MiB');
  const obj = strictJson(decodeUtf8(raw));
  if (obj && typeof obj === 'object' && 'version' in obj && obj.version !== 1) bad('UNSUPPORTED_VERSION', '此项目文件版本暂不支持，请升级 WillYou 或重新导出');
  const result = envelopeSchema.safeParse(obj);
  if (!result.success) return bad('MALFORMED', '文件格式或加密参数无效，请重新选择');
  const h = result.data;
  strictBase64(h.kdf.salt, 16); strictBase64(h.cipher.nonce, 12); strictBase64(h.cipher.tag, 16);
  if (strictBase64(h.ciphertext).length > TRANSFER_LIMITS.payload) bad('TOO_LARGE', '项目内容超过 10 MiB');
  return h;
}
async function keyFor(password: string, salt: Buffer): Promise<Buffer> {
  const b = Buffer.from(password, 'utf8');
  try { return await new Promise<Buffer>((resolve, reject) => scrypt(b, salt, 32, { ...PARAMS, maxmem: 256 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key))); }
  finally { b.fill(0); }
}
export async function encryptProject(input: PortableProject, password: string): Promise<Buffer> {
  const issue = passphraseIssue(password); if (issue) bad('INVALID_PAYLOAD', issue);
  const payload = validatePayload(input);
  const plain = Buffer.from(JSON.stringify(payload));
  if (plain.length > TRANSFER_LIMITS.payload) { plain.fill(0); bad('TOO_LARGE', '项目内容超过 10 MiB'); }
  const h: Envelope = { format: 'willyou.project', version: 1, kdf: { ...PARAMS, salt: randomBytes(16).toString('base64') }, cipher: { name: 'aes-256-gcm', nonce: randomBytes(12).toString('base64'), tag: '' }, ciphertext: '' };
  let key: Buffer | undefined;
  try {
    key = await keyFor(password, strictBase64(h.kdf.salt));
    const cipher = createCipheriv('aes-256-gcm', key, strictBase64(h.cipher.nonce));
    cipher.setAAD(aad(h));
    h.ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]).toString('base64');
    h.cipher.tag = cipher.getAuthTag().toString('base64');
    return Buffer.from(JSON.stringify(h));
  } finally { key?.fill(0); plain.fill(0); }
}
export async function decryptProject(raw: Uint8Array, password: string): Promise<PortableProject> {
  const h = inspectEnvelope(raw);
  if (typeof password !== 'string' || Buffer.byteLength(password) > 1024) bad('UNLOCK_FAILED', '口令不正确，或文件已经损坏');
  let key: Buffer | undefined, partial: Buffer | undefined, plain: Buffer | undefined;
  try {
    key = await keyFor(password, strictBase64(h.kdf.salt));
    const decipher = createDecipheriv('aes-256-gcm', key, strictBase64(h.cipher.nonce));
    decipher.setAAD(aad(h)); decipher.setAuthTag(strictBase64(h.cipher.tag));
    try { partial = decipher.update(strictBase64(h.ciphertext)); plain = Buffer.concat([partial, decipher.final()]); }
    catch { return bad('UNLOCK_FAILED', '口令不正确，或文件已经损坏'); }
    return validatePayload(strictJson(decodeUtf8(plain)));
  } finally { key?.fill(0); partial?.fill(0); plain?.fill(0); }
}
