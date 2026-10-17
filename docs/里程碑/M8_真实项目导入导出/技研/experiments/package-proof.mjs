// Isolated M8 design experiment. Not imported by the application or prototype.
// Never prints plaintext credentials. Actual AIS packages and keys stay under ignored release/.
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, scrypt, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const FORMAT = 'willyou.project';
const PARAMS = { name: 'scrypt', N: 131072, r: 8, p: 1 };
const LIMIT = 16 * 1024 * 1024;
const aad = h => Buffer.from(JSON.stringify({ format: h.format, version: h.version, kdf: h.kdf, cipher: { name: h.cipher.name, nonce: h.cipher.nonce } }));
const keyFor = (password, salt) => derive(Buffer.from(password, 'utf8'), salt, 32, { ...PARAMS, maxmem: 256 * 1024 * 1024 });
const b64 = (v, length) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) throw Error('Invalid encoding');
  const buf = Buffer.from(v, 'base64');
  if (buf.toString('base64') !== v || (length && buf.length !== length)) throw Error('Invalid length');
  return buf;
};

export async function seal(payload, password) {
  if (typeof password !== 'string' || [...password].length < 8 || Buffer.byteLength(password) > 1024) throw Error('Invalid passphrase length');
  const salt = randomBytes(16), nonce = randomBytes(12);
  const envelope = { format: FORMAT, version: 1, kdf: { ...PARAMS, salt: salt.toString('base64') }, cipher: { name: 'aes-256-gcm', nonce: nonce.toString('base64') } };
  const plain = Buffer.from(JSON.stringify(payload));
  if (plain.length > 10 * 1024 * 1024) throw Error('Payload too large');
  const key = await keyFor(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad(envelope));
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { ...envelope, cipher: { ...envelope.cipher, tag: cipher.getAuthTag().toString('base64') }, ciphertext: ciphertext.toString('base64') };
  } finally { key.fill(0); plain.fill(0); }
}

export async function unseal(raw, password) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > LIMIT) throw Error('Package too large');
  const h = JSON.parse(raw);
  if (h.format !== FORMAT || h.version !== 1 || h.cipher?.name !== 'aes-256-gcm') throw Error('Unsupported format');
  if (Object.entries(PARAMS).some(([k, v]) => h.kdf?.[k] !== v)) throw Error('Unsupported KDF');
  if (typeof password !== 'string' || Buffer.byteLength(password) > 1024) throw Error('Invalid passphrase');
  const salt = b64(h.kdf.salt, 16), nonce = b64(h.cipher.nonce, 12), tag = b64(h.cipher.tag, 16), body = b64(h.ciphertext);
  if (body.length > 10 * 1024 * 1024) throw Error('Payload too large');
  const header = { format: h.format, version: h.version, kdf: { ...PARAMS, salt: h.kdf.salt }, cipher: { name: h.cipher.name, nonce: h.cipher.nonce } };
  const key = await keyFor(password, salt);
  let plain, partial;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(aad(header)); decipher.setAuthTag(tag);
    partial = decipher.update(body);
    plain = Buffer.concat([partial, decipher.final()]);
    // Only parse/return after authentication succeeded.
    return JSON.parse(plain.toString('utf8'));
  } finally { key.fill(0); partial?.fill(0); plain?.fill(0); }
}

async function proof() {
  const sample = { schemaVersion: 1, project: { name: '中文项目' }, credentials: { password: 'synthetic-password', privateKey: 'synthetic-key', token: 'synthetic-token' } };
  const pw = 'M8-中文-密码-roundtrip';
  const started = performance.now();
  const encoded = await seal(sample, pw), raw = JSON.stringify(encoded);
  assert.deepEqual(await unseal(raw, pw), sample);
  const durationMs = Math.round(performance.now() - started);
  assert(!raw.includes('synthetic-password') && !raw.includes('中文项目'));
  await assert.rejects(() => unseal(raw, 'incorrect-passphrase'));
  for (const field of ['ciphertext', 'tag', 'nonce', 'salt']) {
    const copy = structuredClone(encoded), obj = field === 'ciphertext' ? copy : field === 'salt' ? copy.kdf : copy.cipher;
    const data = Buffer.from(obj[field], 'base64'); data[0] ^= 1; obj[field] = data.toString('base64');
    await assert.rejects(() => unseal(JSON.stringify(copy), pw));
  }
  await assert.rejects(() => unseal(JSON.stringify({ ...encoded, version: 99 }), pw));
  await assert.rejects(() => unseal(JSON.stringify({ ...encoded, kdf: { ...encoded.kdf, N: 1073741824 } }), pw));
  await assert.rejects(() => unseal('x'.repeat(LIMIT + 1), pw));
  await assert.rejects(() => unseal('{', pw));
  const second = await seal(sample, pw);
  assert.notEqual(encoded.cipher.nonce, second.cipher.nonce);
  assert.notEqual(encoded.kdf.salt, second.kdf.salt);
  await assert.rejects(() => seal(sample, '1234567'), /Invalid passphrase length/);
  const minimum = await seal(sample, '12345678');
  assert.deepEqual(await unseal(JSON.stringify(minimum), '12345678'), sample);
  console.log(JSON.stringify({ experiment: 'M8 encrypted portable package', checks: 13, passed: true, passphraseBoundary: '7 rejected, 8 accepted and decrypted', roundtripMs: durationMs, node: process.version, platform: process.platform, arch: process.arch, scope: 'crypto transport only; not production import or safeStorage acceptance' }));
}

const aisRoot = '/Users/liubu/IdeaProjects/AIS/Ultra_ML/trunk/Src/AIS_Web/ultrasafe-ais-ms';
const repo = resolve(import.meta.dirname, '../../../../..');
const packageDir = join(repo, 'release/m8-fixtures');
const unlockDir = join(repo, 'release/m8-fixture-keys');
const packagePath = join(packageDir, 'AIS-M8.willyou');
const unlockPath = join(unlockDir, 'AIS-M8.passphrase.txt');

async function readAisPayload() {
  const dbSource = join(homedir(), '.codex/skills/project-db-diagnostics/db_connections.json');
  const project = JSON.parse(await readFile(dbSource, 'utf8')).projects.find(p => p.key === 'AIS');
  if (!project) throw Error('AIS source missing');
  const envText = await readFile(join(homedir(), '.codex/skills/project-db-diagnostics/.db_secrets.env'), 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
  const localEnv = {};
  for (const line of envText.split(/\r?\n/)) {
    const value = line.trim(); if (!value || value.startsWith('#') || !value.includes('=')) continue;
    const split = value.indexOf('='); let secret = value.slice(split + 1).trim();
    if (secret.length >= 2 && ['"', "'"].includes(secret[0]) && secret[0] === secret.at(-1)) secret = secret.slice(1, -1);
    localEnv[value.slice(0, split).trim()] = secret;
  }
  let sshSource = process.env.REMOTE_SERVERS_CONFIG;
  if (!sshSource) {
    const local = join(aisRoot, '.codex/remote-servers/servers.json');
    sshSource = await stat(local).then(() => local).catch(e => { if (e.code === 'ENOENT') return join(homedir(), '.codex/remote-servers/servers.json'); throw e; });
  }
  const sshData = JSON.parse(await readFile(sshSource, 'utf8'));
  const sourceServers = (Array.isArray(sshData) ? sshData : sshData.servers).filter(s => s.deployments?.AIS);
  if (!sourceServers.length) throw Error('No AIS SSH records');
  const credentials = {};
  const databases = project.databases.map((d, i) => {
    const ref = `db-${i + 1}`, password = process.env[d.passwordEnv] || localEnv[d.passwordEnv];
    if (!password) throw Error(`Missing database credential at record ${i + 1}`);
    credentials[ref] = { password };
    return { ref, env: d.environment, label: d.label || d.key, aliases: d.aliases || [], vendor: d.type, host: d.host, port: d.port, database: d.database, schema: d.schema || null, username: d.username, accessLevel: 'readonly', isDefault: d.key === project.defaultDatabase, note: '' };
  });
  const servers = sourceServers.map((s, i) => {
    const ref = `server-${i + 1}`;
    const password = s.passwordEnv ? process.env[s.passwordEnv] : s.password;
    if (!password) throw Error(`Missing server credential at record ${i + 1}`);
    credentials[ref] = { password };
    const sudoPolicy = s.defaultRoot ? (!s.sudoPassword || s.sudoPassword === 'same-as-login' ? 'same-as-login' : 'separate') : 'none';
    if (sudoPolicy === 'separate') credentials[ref].sudoPassword = s.sudoPassword;
    const dep = s.deployments.AIS;
    return { ref, env: s.environment, label: `AIS ${s.environment === 'prod' ? '生产' : '研发'}服务器`, aliases: s.aliases || [], host: s.ip, port: s.port || 22, username: s.username, authType: 'password', privateKeyPath: null, defaultRoot: Boolean(s.defaultRoot), sudoPolicy, appRoot: dep.root || null, logsPath: dep.toolAgentLog || null, note: '' };
  });
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), producer: { name: 'WillYou M8 fixture preparation', appVersion: '0.0.4', platform: 'darwin' }, project: { name: 'AIS', aliases: project.aliases || [], description: 'M8 首份真实项目配置迁移验收文件', rulesPath: null }, directories: [{ ref: 'dir-1', label: 'AIS 后端', path: aisRoot, isDefault: true }], databases, servers, capabilities: [{ id: 'project-db-diagnostics', enabled: true }, { id: 'remote-password-ssh', enabled: true }, { id: 'smartdd-project-context', enabled: true }], profiles: [], credentials };
}

async function verifyFixture() {
  const raw = await readFile(packagePath, 'utf8'), password = (await readFile(unlockPath, 'utf8')).trim();
  const payload = await unseal(raw, password);
  assert.equal(payload.project.name, 'AIS'); assert.equal(payload.directories[0].path, aisRoot);
  assert.equal(payload.databases.filter(d => d.isDefault).length, 1);
  for (const resource of [...payload.databases, ...payload.servers]) assert(payload.credentials[resource.ref]?.password);
  for (const c of Object.values(payload.credentials)) for (const secret of Object.values(c)) assert(!raw.includes(secret));
  const result = { packagePath, unlockPath, sha256: createHash('sha256').update(raw).digest('hex'), directories: payload.directories.length, databases: payload.databases.length, servers: payload.servers.length, aiProfiles: payload.profiles.length, credentialsComplete: true, sourceReadOnly: true, networkConnections: 0, status: 'encrypted fixture verified; app import pending implementation' };
  await writeFile(join(packageDir, 'verification.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(result));
}

if (process.argv[2] === '--prepare-ais') {
  await stat(aisRoot);
  for (const dir of [packageDir, unlockDir]) { await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700); }
  for (const path of [packagePath, unlockPath]) {
    if (await stat(path).then(() => true).catch(e => { if (e.code === 'ENOENT') return false; throw e; })) throw Error('Fixed fixture already exists; use --verify-ais instead');
  }
  const payload = await readAisPayload();
  const password = randomBytes(24).toString('base64url');
  const raw = JSON.stringify(await seal(payload, password), null, 2) + '\n';
  await writeFile(unlockPath, password + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(packagePath, raw, { mode: 0o600, flag: 'wx' });
  await verifyFixture();
} else if (process.argv[2] === '--verify-ais') await verifyFixture();
else await proof();
