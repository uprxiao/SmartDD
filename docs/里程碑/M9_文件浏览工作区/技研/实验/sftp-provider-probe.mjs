#!/usr/bin/env node
// M9-GAP-07 隔离实验：远程文件 provider（HostFileProvider）的能力探测、写入降级、断线与主机密钥。
// 客户端用 SmartDD 同一个依赖 ssh2 1.17.0；服务端是 ssh2 自带的最小 SFTP 服务（回环、临时目录、127.0.0.1 随机端口）。
// **这不是 OpenSSH**：真实服务器的 SFTP 行为（扩展、rename 语义、权限、符号链接、编码）可能不同，本实验只证明“provider 在这些行为下如何探测和降级”。
// 不连接任何真实主机，不使用任何真实凭据（用户名/密码为随机值，仅本进程）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const { Client, Server, utils } = createRequire(path.join(repo, 'package.json'))('ssh2');
const { STATUS_CODE, flagsToString } = utils.sftp;
const out = process.argv[process.argv.indexOf('--output') + 1];
if (process.argv.indexOf('--output') < 0 || !out) { console.error('usage: sftp-provider-probe.mjs --output FILE'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-sftp-'));
const root = path.join(work, 'remote-root'); fs.mkdirSync(root);
const password = crypto.randomBytes(12).toString('hex'), username = 'probe';
const hostKey = utils.generateKeyPairSync('ed25519');
// ssh2 的 hostVerifier 在设置 hostHash 后收到十六进制摘要；OpenSSH 风格指纹是同一摘要的 base64（无填充）
const fingerprint = key => crypto.createHash('sha256').update(key).digest('hex');
const sshStyle = hex => 'SHA256:' + Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, '');

// ---------------- 最小 SFTP 服务（可注入行为）----------------
const hooks = { renameOverwrite: false, renameDelayMs: 0, dropAfterWrites: null, hangReads: false, authAttempts: 0, writes: 0, sockets: new Set() };
const server = new Server({ hostKeys: [hostKey.private] }, client => {
  if (client._sock) { hooks.sockets.add(client._sock); client._sock.on('close', () => hooks.sockets.delete(client._sock)); client._sock.on('error', () => {}); }
  client.on('authentication', ctx => { hooks.authAttempts++; ctx.method === 'password' && ctx.username === username && ctx.password === password ? ctx.accept() : ctx.reject(['password']); });
  client.on('error', () => {});
  client.on('ready', () => client.on('session', accept => { const session = accept(); session.on('sftp', accept => {
    const sftp = accept(); const handles = new Map(); let n = 0;
    const real = p => { const r = path.resolve(root, '.' + path.posix.resolve('/', p)); return r.startsWith(root) ? r : null; };
    const attrs = st => ({ mode: st.mode, uid: st.uid, gid: st.gid, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
    const fail = (id, e) => sftp.status(id, e?.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : e?.code === 'EACCES' ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE);
    sftp.on('REALPATH', (id, p) => { const r = real(p); r ? sftp.name(id, [{ filename: '/' + path.relative(root, r), longname: '', attrs: {} }]) : sftp.status(id, STATUS_CODE.PERMISSION_DENIED); });
    const stat = (id, p) => { const r = real(p); if (!r) return sftp.status(id, STATUS_CODE.PERMISSION_DENIED); try { sftp.attrs(id, attrs(fs.statSync(r))); } catch (e) { fail(id, e); } };
    sftp.on('STAT', stat); sftp.on('LSTAT', stat);
    sftp.on('OPENDIR', (id, p) => { const r = real(p); if (!r) return sftp.status(id, STATUS_CODE.PERMISSION_DENIED); try { const names = fs.readdirSync(r); const h = Buffer.from(String(++n)); handles.set(String(n), { dir: r, names, done: false }); sftp.handle(id, h); } catch (e) { fail(id, e); } });
    sftp.on('READDIR', (id, h) => { const s = handles.get(h.toString()); if (!s || s.done) return sftp.status(id, STATUS_CODE.EOF); s.done = true; sftp.name(id, s.names.map(f => ({ filename: f, longname: f, attrs: attrs(fs.statSync(path.join(s.dir, f))) }))); });
    sftp.on('OPEN', (id, p, flags) => { const r = real(p); if (!r) return sftp.status(id, STATUS_CODE.PERMISSION_DENIED); try { const fd = fs.openSync(r, flagsToString(flags) || 'r'); const h = Buffer.from(String(++n)); handles.set(String(n), { fd }); sftp.handle(id, h); } catch (e) { fail(id, e); } });
    sftp.on('READ', (id, h, offset, length) => { if (hooks.hangReads) return; const s = handles.get(h.toString()); if (!s) return sftp.status(id, STATUS_CODE.FAILURE); const buf = Buffer.alloc(length); const got = fs.readSync(s.fd, buf, 0, length, offset); got === 0 ? sftp.status(id, STATUS_CODE.EOF) : sftp.data(id, buf.subarray(0, got)); });
    sftp.on('WRITE', (id, h, offset, data) => { const s = handles.get(h.toString()); if (!s) return sftp.status(id, STATUS_CODE.FAILURE); fs.writeSync(s.fd, data, 0, data.length, offset); hooks.writes++; if (hooks.dropAfterWrites !== null && hooks.writes >= hooks.dropAfterWrites) { client._sock.destroy(); return; } sftp.status(id, STATUS_CODE.OK); });
    sftp.on('FSTAT', (id, h) => { const s = handles.get(h.toString()); try { sftp.attrs(id, attrs(fs.fstatSync(s.fd))); } catch (e) { fail(id, e); } });
    sftp.on('CLOSE', (id, h) => { const s = handles.get(h.toString()); if (s?.fd !== undefined) try { fs.closeSync(s.fd); } catch {} handles.delete(h.toString()); sftp.status(id, STATUS_CODE.OK); });
    sftp.on('RENAME', async (id, a, b) => { const ra = real(a), rb = real(b); if (!ra || !rb) return sftp.status(id, STATUS_CODE.PERMISSION_DENIED); if (hooks.renameDelayMs) await sleep(hooks.renameDelayMs);
      if (fs.existsSync(rb) && !hooks.renameOverwrite) return sftp.status(id, STATUS_CODE.FAILURE, 'target exists'); // SFTP v3 规范：目标存在则失败
      try { fs.renameSync(ra, rb); sftp.status(id, STATUS_CODE.OK); } catch (e) { fail(id, e); } });
    sftp.on('REMOVE', (id, p) => { const r = real(p); try { fs.unlinkSync(r); sftp.status(id, STATUS_CODE.OK); } catch (e) { fail(id, e); } });
  }); }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;

// ---------------- provider（被测对象；生产实现应等价）----------------
const p = (sftp, m, ...a) => new Promise((resolve, reject) => sftp[m](...a, (e, r) => e ? reject(e) : resolve(r)));
async function connect({ pinned = pin, keepaliveMs = 0 } = {}) {
  const c = new Client(); let seen = null;
  await new Promise((resolve, reject) => { c.on('ready', resolve).on('error', reject).connect({ host: '127.0.0.1', port, username, password, hostHash: 'sha256', hostVerifier: hash => { seen = hash; return pinned === null ? true : hash === pinned; }, readyTimeout: 5000, keepaliveInterval: keepaliveMs || undefined, keepaliveCountMax: 2 }); });
  const sftp = await new Promise((resolve, reject) => c.sftp((e, s) => e ? reject(e) : resolve(s)));
  const closed = new Promise((_, reject) => { c.on('close', () => reject(Object.assign(new Error('connection closed'), { code: 'CLOSED' }))); c.on('error', e => reject(e)); }); closed.catch(() => {});
  return { c, sftp, seen, closed };
}
const revisionOf = async (sftp, file) => { const st = await p(sftp, 'stat', file); const buf = await new Promise((resolve, reject) => sftp.readFile(file, (e, d) => e ? reject(e) : resolve(d))); return { size: st.size, hash: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf }; };
async function probeCapabilities(sftp, dir) {
  const a = dir + '/.smartdd-probe-a', b = dir + '/.smartdd-probe-b';
  await new Promise((r, j) => sftp.writeFile(a, 'a', e => e ? j(e) : r())); await new Promise((r, j) => sftp.writeFile(b, 'b', e => e ? j(e) : r()));
  let atomicReplace = false; try { await p(sftp, 'rename', a, b); atomicReplace = true; } catch {}
  for (const f of [a, b]) try { await p(sftp, 'unlink', f); } catch {}
  return { atomicReplace, posixRenameExtension: typeof sftp.ext_openssh_rename === 'function' && !!sftp._extensions?.['posix-rename@openssh.com'], compareAndSwap: false /* SFTP 没有条件写 */ };
}
// 写回：校验基线 → 上传临时文件 → 校验大小 → 替换。失败一律清理临时文件并保持原文件。
async function writeWithRevision(sftp, file, newBytes, base, caps, { allowNonAtomic = false } = {}) {
  const cur = await revisionOf(sftp, file); if (cur.hash !== base.hash) return { state: 'conflict' };
  const tmp = file + '.smartdd-tmp-' + crypto.randomBytes(4).toString('hex');
  try {
    await new Promise((r, j) => sftp.writeFile(tmp, newBytes, e => e ? j(e) : r()));
    const st = await p(sftp, 'stat', tmp); if (st.size !== newBytes.length) throw new Error('size-mismatch');
    if (caps.atomicReplace) await p(sftp, 'rename', tmp, file);
    else { if (!allowNonAtomic) { await p(sftp, 'unlink', tmp).catch(() => {}); return { state: 'unsupported', reason: 'atomic-replace-unavailable' }; } await p(sftp, 'unlink', file); await p(sftp, 'rename', tmp, file); }
    return { state: 'saved', hash: crypto.createHash('sha256').update(newBytes).digest('hex'), atomic: caps.atomicReplace };
  } catch (e) { await p(sftp, 'unlink', tmp).catch(() => {}); return { state: 'failed', error: String(e.message || e).slice(0, 60) }; }
}

// provider 保护：每个远程操作都要同时竞争“连接关闭”与“超时”，否则断线后调用方会永久等待
const guard = (conn, promise, ms = 3000) => Promise.race([promise, conn.closed, sleep(ms).then(() => { throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' }); })]);
const cases = []; const started = new Date().toISOString();
const run = async (id, title, fn) => { const t = performance.now(); try { const [status, evidence] = await fn(); cases.push({ id, title, status, ms: Math.round(performance.now() - t), evidence }); } catch (e) { cases.push({ id, title, status: 'failed', ms: Math.round(performance.now() - t), evidence: { exception: String(e?.stack || e).split('\n').slice(0, 3).join(' | ') } }); } };
const pin = fingerprint(Buffer.from(hostKey.public.split(/\s+/)[1], 'base64'));
fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n'); fs.writeFileSync(path.join(root, '中文 文件.md'), '# 你好 😀\n');

await run('SF01', '主机密钥固定：指纹匹配才完成握手；不匹配在认证前被拒绝（服务端没有收到认证尝试）', async () => {
  hooks.authAttempts = 0; let wrong; try { await connect({ pinned: 'AAAA-wrong-fingerprint' }); wrong = 'connected'; } catch (e) { wrong = String(e.message).slice(0, 60); }
  const authAfterWrong = hooks.authAttempts; const ok = await connect({ pinned: pin }); ok.c.end();
  return [wrong !== 'connected' && authAfterWrong === 0 && ok.seen === pin ? 'passed' : 'failed', { wrongPinRejected: wrong, authAttemptsAfterWrongPin: authAfterWrong, matchedFingerprint: ok.seen === pin, fingerprintShown: sshStyle(pin), productionNote: '生产 ssh-tester.ts 注明“M2 不校验主机密钥，只报告指纹”；远程读写源码前必须首次连接固定指纹并拒绝变更' }];
});
await run('SF02', '列目录/stat/读取：含中文空格文件名与 UTF-8 内容', async () => {
  const { c, sftp } = await connect({ pinned: pin }); const list = await p(sftp, 'readdir', '/'); const st = await p(sftp, 'stat', '/src/a.ts'); const rev = await revisionOf(sftp, '/中文 文件.md'); c.end();
  return [list.some(x => x.filename === '中文 文件.md') && st.size === 20 && rev.bytes.toString('utf8').startsWith('# 你好 😀') ? 'passed' : 'failed', { entries: list.map(x => x.filename).sort(), statSize: st.size, utf8: rev.bytes.toString('utf8').trim() }];
});
await run('SF03', '能力探测：目标已存在时 rename 是否覆盖（规范行为：失败）→ atomicReplace=false；CAS 恒为 false', async () => {
  hooks.renameOverwrite = false; const { c, sftp } = await connect({ pinned: pin }); const a = await probeCapabilities(sftp, '/src');
  hooks.renameOverwrite = true; const b = await probeCapabilities(sftp, '/src'); hooks.renameOverwrite = false; c.end();
  const leftovers = fs.readdirSync(path.join(root, 'src')).filter(f => f.includes('probe'));
  return [!a.atomicReplace && b.atomicReplace && a.compareAndSwap === false && leftovers.length === 0 ? 'passed' : 'failed', { strictServer: a, overwritingServer: b, probeLeftovers: leftovers, note: '探测文件在两种服务器上都被清理；posix-rename 扩展需要服务端声明，ssh2 客户端据此决定是否可用' }];
});
await run('SF04', '写回（目标不能被 rename 覆盖时）：默认拒绝并保持原文件；用户明确允许才走“删除再 rename”的非原子路径', async () => {
  hooks.renameOverwrite = false; const { c, sftp } = await connect({ pinned: pin }); const caps = await probeCapabilities(sftp, '/src'); const base = await revisionOf(sftp, '/src/a.ts');
  const refused = await writeWithRevision(sftp, '/src/a.ts', Buffer.from('export const a = 2;\n'), base, caps); const unchanged = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
  const allowed = await writeWithRevision(sftp, '/src/a.ts', Buffer.from('export const a = 2;\n'), base, caps, { allowNonAtomic: true }); const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
  const temps = fs.readdirSync(path.join(root, 'src')).filter(f => f.includes('smartdd-tmp')); c.end();
  return [refused.state === 'unsupported' && unchanged === 'export const a = 1;\n' && allowed.state === 'saved' && allowed.atomic === false && after === 'export const a = 2;\n' && temps.length === 0 ? 'passed' : 'failed', { refused, originalIntact: unchanged === 'export const a = 1;\n', allowedNonAtomic: allowed, tempLeftovers: temps }];
});
await run('SF05', '基线冲突：远程内容已变化时写回返回 conflict，不覆盖', async () => {
  const { c, sftp } = await connect({ pinned: pin }); const caps = await probeCapabilities(sftp, '/src'); const base = await revisionOf(sftp, '/src/a.ts'); fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 99; // 外部修改\n');
  const r = await writeWithRevision(sftp, '/src/a.ts', Buffer.from('mine\n'), base, caps, { allowNonAtomic: true }); const still = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8'); c.end();
  return [r.state === 'conflict' && still.includes('外部修改') ? 'passed' : 'failed', { result: r, remoteStillExternalVersion: still.includes('外部修改') }];
});
await run('SF06', '负对照：校验之后、rename 之前的外部写入仍会被覆盖（SFTP 没有条件写）', async () => {
  hooks.renameOverwrite = true; hooks.renameDelayMs = 400; fs.writeFileSync(path.join(root, 'src/b.ts'), 'v1\n');
  const { c, sftp } = await connect({ pinned: pin }); const caps = await probeCapabilities(sftp, '/src'); const base = await revisionOf(sftp, '/src/b.ts');
  const writing = writeWithRevision(sftp, '/src/b.ts', Buffer.from('mine\n'), base, caps); await sleep(150); fs.writeFileSync(path.join(root, 'src/b.ts'), 'external-during-rename\n');
  const r = await writing; const final = fs.readFileSync(path.join(root, 'src/b.ts'), 'utf8'); hooks.renameDelayMs = 0; hooks.renameOverwrite = false; c.end();
  return [r.state === 'saved' && final === 'mine\n' ? 'observed-gap' : 'failed', { result: r.state, finalRemoteContent: JSON.stringify(final), meaning: '外部写入在校验与替换之间发生，被静默覆盖。远程 provider 必须声明 compareAndSwap=false，并在界面上不得承诺“不丢失外部修改”' }];
});
await run('SF07', '断线：上传中途连接被切断。裸 ssh2 调用会一直挂起；加“连接关闭/超时”保护的 provider 快速失败、原文件不变、重连后清理临时文件', async () => {
  hooks.renameOverwrite = true; fs.writeFileSync(path.join(root, 'src/c.ts'), 'orig\n'); const big = Buffer.alloc(512 * 1024, 65);
  const a = await connect({ pinned: pin }); const caps = await probeCapabilities(a.sftp, '/src'); const base = await revisionOf(a.sftp, '/src/c.ts');
  hooks.writes = 0; hooks.dropAfterWrites = 3; const raw = await Promise.race([writeWithRevision(a.sftp, '/src/c.ts', big, base, caps), sleep(3000).then(() => ({ state: 'hung' }))]); hooks.dropAfterWrites = null; try { a.c.destroy(); } catch {}
  const b = await connect({ pinned: pin }); hooks.writes = 0; hooks.dropAfterWrites = 3; const t0 = performance.now(); let guarded; try { guarded = await guard(b, writeWithRevision(b.sftp, '/src/c.ts', big, base, caps)); } catch (e) { guarded = { state: 'failed', code: e.code || 'ERR' }; } const ms = Math.round(performance.now() - t0); hooks.dropAfterWrites = null; try { b.c.destroy(); } catch {}
  const original = fs.readFileSync(path.join(root, 'src/c.ts'), 'utf8'); const temps = fs.readdirSync(path.join(root, 'src')).filter(f => f.includes('smartdd-tmp-'));
  const again = await connect({ pinned: pin }); for (const t of temps) await p(again.sftp, 'unlink', '/src/' + t); const left = fs.readdirSync(path.join(root, 'src')).filter(f => f.includes('smartdd-tmp-')); const rev2 = await revisionOf(again.sftp, '/src/c.ts'); again.c.end(); hooks.renameOverwrite = false;
  const ok = guarded.state === 'failed' && ms < 2000 && original === 'orig\n' && left.length === 0 && rev2.hash === base.hash;
  return [ok ? (raw.state === 'hung' ? 'observed-gap' : 'passed') : 'failed', { rawSsh2OutcomeAfter3s: raw.state, guarded: { ...guarded, failedAfterMs: ms }, originalIntact: original === 'orig\n', tempsLeftByDisconnect: temps.length, tempsAfterReconnectCleanup: left.length, baselineStillValid: rev2.hash === base.hash,
    meaning: raw.state === 'hung' ? '裸 ssh2 在连接被切断后回调不会触发——这是被保护的缺口（observed-gap），不是 provider 可以直接使用的行为；断线后半上传的临时文件不能当作已保存，重连要重新核对基线' : '本次裸 ssh2 在断线后也返回了结果，但仍必须保留超时与关闭保护' }];
});
await run('SF08', '请求挂起：服务端不再响应读取 → 在预算内超时，连接被丢弃并可重新连接（连接世代失效）', async () => {
  const { c, sftp } = await connect({ pinned: pin }); hooks.hangReads = true; const t0 = performance.now();
  const r = await Promise.race([revisionOf(sftp, '/src/a.ts').then(() => 'resolved', e => 'error:' + e.message), sleep(1200).then(() => 'timeout')]); const ms = Math.round(performance.now() - t0);
  c.destroy(); hooks.hangReads = false; await sleep(200); const again = await connect({ pinned: pin }); const ok = (await revisionOf(again.sftp, '/src/a.ts')).bytes.length > 0; again.c.end();
  return [r === 'timeout' && ok ? 'passed' : 'failed', { outcome: r, afterMs: ms, reconnectedAndRead: ok, note: 'ssh2 的 SFTP 请求自身没有超时，必须由 provider 自加超时并销毁连接' }];
});
await run('SF09', '凭据：错误密码被拒绝且不泄漏；连接参数中的密码不出现在 provider 结果里', async () => {
  const c = new Client(); const err = await new Promise(resolve => { c.on('error', e => resolve(String(e.message))).on('ready', () => resolve('connected')).connect({ host: '127.0.0.1', port, username, password: 'wrong-' + password, hostHash: 'sha256', hostVerifier: h => h === pin, readyTimeout: 4000 }); }); c.end();
  const serialized = JSON.stringify(cases);
  return [err !== 'connected' && !serialized.includes(password) ? 'passed' : 'failed', { rejectedWith: err.slice(0, 60), passwordAppearsInReport: serialized.includes(password) }];
});
server.close(); for (const s of hooks.sockets) if (typeof s.destroy === 'function') s.destroy();
fs.rmSync(work, { recursive: true, force: true });
const summary = cases.reduce((m, c) => (m[c.status] = (m[c.status] || 0) + 1, m), {});
fs.writeFileSync(out, JSON.stringify({ schemaVersion: 1, startedAt: started, scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), ssh2: '1.17.0', server: 'ssh2 内置最小 SFTP 服务（不是 OpenSSH）' },
  scope: '回环、临时目录、随机凭据；只测 provider 的探测与降级策略。不含：OpenSSH 真实行为、公钥/Agent 认证、符号链接与权限、大目录/大文件吞吐、watch（SFTP 无监听，需轮询）、Windows 服务器', cases, fixtureCleanup: { removed: !fs.existsSync(work) }, completedAt: new Date().toISOString(), summary }, null, 2));
console.log(JSON.stringify(summary)); for (const c of cases) console.log(c.id, c.status, c.title);
process.exit(summary.failed ? 1 : 0);
