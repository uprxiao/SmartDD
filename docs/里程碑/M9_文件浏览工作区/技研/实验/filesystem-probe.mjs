#!/usr/bin/env node
// Isolated research probe. No production imports, user paths, network, or dependencies.
import fs from 'node:fs/promises';
import { watch, constants, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const script = fileURLToPath(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
if (process.argv[2] === '--reader') {
  let running = true, reads = 0, partial = 0, errors = 0;
  process.on('message', m => { if (m === 'stop') running = false; });
  process.send({ ready: true });
  const step = () => {
    if (!running) { process.send({ reads, partial, errors }); process.disconnect(); return; }
    try {
      const bytes = readFileSync(process.argv[3]);
      reads++;
      if (bytes.length !== 262144 || ![65, 66].includes(bytes[0]) || bytes.some(byte => byte !== bytes[0])) partial++;
    } catch { errors++; }
    setImmediate(step);
  };
  step();
} else {
  await main();
}

function fail(code) { throw Object.assign(new Error(code), { code }); }
function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
async function lease(root, owner = 'window-a', host = 'local') {
  const canonical = await fs.realpath(root), stat = await fs.stat(canonical);
  return { canonical, owner, host, rootIdentity: `${host}:${stat.dev}:${stat.ino}:${canonical}`, dev: stat.dev, ino: stat.ino, generation: 1 };
}
async function resolve(l, relative, owner = l.owner, generation = l.generation) {
  if (owner !== l.owner) fail('UNTRUSTED_SENDER');
  if (generation !== l.generation) fail('LEASE_EXPIRED');
  if (typeof relative !== 'string' || relative.includes('\0') || relative.includes('\\') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(relative) || path.isAbsolute(relative)) fail('INVALID_ARGUMENT');
  const root = await fs.realpath(l.canonical), rootStat = await fs.stat(root);
  if (rootStat.dev !== l.dev || rootStat.ino !== l.ino) fail('ROOT_CHANGED');
  const candidate = path.resolve(root, relative);
  if (!within(root, candidate)) fail('PATH_ESCAPE');
  const target = await fs.realpath(candidate);
  if (!within(root, target)) fail('SYMLINK_OUTSIDE_ROOT');
  const st = await fs.stat(target);
  if (!st.isFile()) fail('NOT_A_FILE');
  return { target, relative: path.relative(root, target), identity: `${l.rootIdentity}\0${path.relative(root, target)}` };
}
async function snapshot(file) {
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat({ bigint: true }), bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) fail('CHANGED_DURING_READ');
    return { bytes, revision: `${after.dev}:${after.ino}:${after.size}:${after.mtimeNs}:${hash(bytes)}`, hash: hash(bytes), mtimeNs: String(after.mtimeNs), size: Number(after.size), mode: Number(after.mode) };
  } finally { await handle.close(); }
}
// A candidate algorithm, NOT a production service or a portable atomic CAS.
async function atomicSave(l, relative, baseRevision, bytes, { beforeFinalCheck, afterFinalCheck, failBeforeRename } = {}) {
  let temporary;
  try {
    const first = await resolve(l, relative), original = await snapshot(first.target);
    if (original.revision !== baseRevision) return { state: 'conflict', revision: original.revision };
    temporary = path.join(path.dirname(first.target), `.m9-${randomUUID()}.tmp`);
    const h = await fs.open(temporary, 'wx', original.mode & 0o777);
    try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
    if (beforeFinalCheck) await beforeFinalCheck();
    const last = await resolve(l, relative), now = await snapshot(last.target);
    if (last.identity !== first.identity || now.revision !== baseRevision) return { state: 'conflict', revision: now.revision };
    if (failBeforeRename) fail('INJECTED_PRECOMMIT_FAILURE');
    if (afterFinalCheck) await afterFinalCheck();
    await fs.rename(temporary, first.target);
    temporary = null;
    const saved = await snapshot(first.target);
    return { state: 'saved', revision: saved.revision, hash: saved.hash };
  } finally { if (temporary) await fs.rm(temporary, { force: true }); }
}
async function childWrite(file, value) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1],process.argv[2])', file, value], { stdio: 'pipe' });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`external writer exit ${code}`)));
  });
}
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'm9-files-research-'));
  const output = process.argv.indexOf('--output');
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), scriptSha256: hash(await fs.readFile(script)), environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release() }, scope: 'Synthetic temporary files; no Electron IPC or production implementation', cases: [] };
  const run = async (id, title, action, expectedGap = false) => {
    const start = performance.now();
    try { const evidence = await action(); report.cases.push({ id, title, status: expectedGap ? 'observed-gap' : 'passed', durationMs: +(performance.now() - start).toFixed(2), evidence }); }
    catch (error) { report.cases.push({ id, title, status: 'failed', error: { code: error.code, message: error.message }, durationMs: +(performance.now() - start).toFixed(2) }); }
  };
  try {
    const a = path.join(root, 'project-a'), b = path.join(root, 'project-b'), outside = path.join(root, 'outside');
    await Promise.all([a, b, outside].map(p => fs.mkdir(p)));
    await fs.mkdir(path.join(a, '中文 目录'));
    await fs.writeFile(path.join(a, '中文 目录', '.env.example'), 'SYNTHETIC=1\r\n');
    await fs.writeFile(path.join(outside, 'sentinel.txt'), 'outside-untouched');
    await fs.writeFile(path.join(a, 'same.txt'), 'AAAA');
    await fs.writeFile(path.join(b, 'same.txt'), 'BBBB');
    const la = await lease(a), lb = await lease(b);
    await run('FS01', 'Real paths, Unicode, dotfile, traversal and symlink bounds', async () => {
      const file = await resolve(la, '中文 目录/.env.example');
      assert.equal(await fs.readFile(file.target, 'utf8'), 'SYNTHETIC=1\r\n');
      const rejected = {};
      for (const input of ['../outside/sentinel.txt', '/etc/passwd', 'C:\\outside\\x', '//server/share', 'file:///tmp/x', 'bad\0name']) {
        await assert.rejects(resolve(la, input), e => { rejected[input.replace('\0', '<NUL>')] = e.code; return true; });
      }
      await fs.symlink(path.join(outside, 'sentinel.txt'), path.join(a, 'outside-link'));
      await assert.rejects(resolve(la, 'outside-link'), { code: 'SYMLINK_OUTSIDE_ROOT' });
      await fs.symlink(path.join(a, 'same.txt'), path.join(a, 'inside-link'));
      assert.equal((await resolve(la, 'inside-link')).identity, (await resolve(la, 'same.txt')).identity);
      return { rejected, outsideSymlink: 'rejected', insideAlias: 'same canonical identity', bytePreservation: 'CRLF exact' };
    });
    await run('FS02', 'Host/root/task identity and owner/generation guards', async () => {
      const alias = path.join(root, 'root-alias'); await fs.symlink(a, alias);
      const aliasLease = await lease(alias), remoteLease = await lease(a, 'window-a', 'remote-fixture');
      const ia = (await resolve(la, 'same.txt')).identity;
      assert.notEqual(ia, (await resolve(lb, 'same.txt')).identity);
      assert.equal(ia, (await resolve(aliasLease, 'same.txt')).identity);
      assert.notEqual(ia, (await resolve(remoteLease, 'same.txt')).identity);
      await assert.rejects(resolve(la, 'same.txt', 'window-b'), { code: 'UNTRUSTED_SENDER' });
      await assert.rejects(resolve(la, 'same.txt', 'window-a', 0), { code: 'LEASE_EXPIRED' });
      return { differentProjectSameName: 'distinct', sameRootAlias: 'shared', differentHost: 'distinct', taskBufferPolicy: 'separate scope; file identity shared', ownerValidation: 'research registry only, not Electron sender verification' };
    });
    await run('FS03', 'Root directory replacement invalidates the lease', async () => {
      const replaceable = path.join(root, 'replaceable'); await fs.mkdir(replaceable); await fs.writeFile(path.join(replaceable, 'x'), 'old');
      const l = await lease(replaceable); await fs.rename(replaceable, replaceable + '-old'); await fs.mkdir(replaceable); await fs.writeFile(path.join(replaceable, 'x'), 'new');
      await assert.rejects(resolve(l, 'x'), { code: 'ROOT_CHANGED' });
      return { sameDisplayPathDifferentInode: 'rejected' };
    });
    await run('FS04', 'Same mtime and size content change defeats mtime-only detection', async () => {
      const file = path.join(a, 'same.txt'), fixed = new Date('2020-01-01T00:00:00.000Z');
      await fs.utimes(file, fixed, fixed); const before = await snapshot(file);
      await childWrite(file, 'CCCC'); await fs.utimes(file, fixed, fixed); const after = await snapshot(file);
      assert.equal(before.mtimeNs, after.mtimeNs); assert.equal(before.size, after.size); assert.notEqual(before.hash, after.hash);
      assert.equal((await atomicSave(la, 'same.txt', before.revision, 'USER')).state, 'conflict');
      return { sameMtimeNs: true, sameSize: true, hashChanged: true, staleSave: 'conflict', outsideProcess: true };
    });
    await run('FS05', 'Atomic replacement preserves complete bytes, mode and precommit failure', async () => {
      const file = path.join(a, 'save.txt'); await fs.writeFile(file, '\uFEFF中文\r\nbase\r\n', { mode: 0o640 });
      const before = await snapshot(file);
      await assert.rejects(atomicSave(la, 'save.txt', before.revision, 'failed', { failBeforeRename: true }), { code: 'INJECTED_PRECOMMIT_FAILURE' });
      assert.equal((await snapshot(file)).revision, before.revision);
      assert.equal((await fs.readdir(a)).some(n => n.startsWith('.m9-')), false);
      const bytes = Buffer.from('\uFEFF中文\r\nnew\r\n'); const saved = await atomicSave(la, 'save.txt', before.revision, bytes);
      assert.equal(saved.state, 'saved'); assert.deepEqual(await fs.readFile(file), bytes);
      assert.equal((await fs.stat(file)).mode & 0o777, before.mode & 0o777);
      return { exactBytes: hash(bytes), mode: (before.mode & 0o777).toString(8), failedCommitOriginalPreserved: true, temporaryFilesCleaned: true, durability: 'temp file fsync only; power-loss/directory fsync not proven' };
    });
    await run('FS06', 'Independent reader sees old/new whole files during 32 renames', async () => {
      const file = path.join(a, 'atomic.bin'); await fs.writeFile(file, Buffer.alloc(262144, 65));
      const reader = spawn(process.execPath, [script, '--reader', file], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      const messages = []; reader.on('message', m => messages.push(m));
      await new Promise((resolve, reject) => { reader.once('message', resolve); reader.once('error', reject); });
      for (let i = 0; i < 32; i++) { const temp = file + '.tmp'; await fs.writeFile(temp, Buffer.alloc(262144, i % 2 ? 65 : 66)); await fs.rename(temp, file); await delay(2); }
      const result = new Promise((resolve, reject) => { reader.on('message', m => { if ('reads' in m) resolve(m); }); reader.once('error', reject); });
      reader.send('stop'); const observation = await result;
      assert.ok(observation.reads > 0); assert.equal(observation.partial, 0); assert.equal(observation.errors, 0);
      return { ...observation, replacements: 32, bytesPerFile: 262144, boundary: 'observed macOS local FS semantics, not cross-platform/crash durability' };
    });
    await run('FS07', 'Concurrent external write before final revision check is rejected', async () => {
      const file = path.join(a, 'race.txt'); await fs.writeFile(file, 'base'); const before = await snapshot(file);
      const result = await atomicSave(la, 'race.txt', before.revision, 'ours', { beforeFinalCheck: () => childWrite(file, 'theirs') });
      assert.equal(result.state, 'conflict'); assert.equal(await fs.readFile(file, 'utf8'), 'theirs');
      return { save: result.state, externalContentPreserved: true };
    });
    await run('FS08', 'Negative control: external write after final check is overwritten by rename', async () => {
      const file = path.join(a, 'race-gap.txt'); await fs.writeFile(file, 'base'); const before = await snapshot(file);
      const result = await atomicSave(la, 'race-gap.txt', before.revision, 'ours', { afterFinalCheck: () => childWrite(file, 'theirs') });
      assert.equal(result.state, 'saved'); assert.equal(await fs.readFile(file, 'utf8'), 'ours');
      return { reproduced: true, externalWriteLost: true, implication: 'hash+atomic rename is not a cross-process CAS; native/cooperative locking or explicit residual race boundary required' };
    }, true);
    await run('FS09', 'Negative control: parent symlink swap bypasses a prior path check', async () => {
      const parent = path.join(a, 'swap-parent'), renamed = path.join(a, 'old-parent'); await fs.mkdir(parent); await fs.writeFile(path.join(parent, 'sentinel.txt'), 'inside');
      const checked = await resolve(la, 'swap-parent/sentinel.txt');
      await fs.rename(parent, renamed); await fs.symlink(outside, parent);
      const handle = await fs.open(checked.target, constants.O_WRONLY | (constants.O_NOFOLLOW || 0));
      try { await handle.writeFile('RACE'); } finally { await handle.close(); }
      const changed = (await fs.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).startsWith('RACE'); assert.equal(changed, true);
      await assert.rejects(resolve(la, 'swap-parent/sentinel.txt'), { code: 'SYMLINK_OUTSIDE_ROOT' });
      return { reproduced: true, finalComponentNoFollowInsufficient: true, outsideSyntheticSentinelChanged: true, implication: 'anchored component-by-component descriptor operations/native broker required for adversarial topology' };
    }, true);
    await run('FS10', 'Real directory watcher observes atomic replacement and subsequent edit', async () => {
      const directory = path.join(root, 'watch'); await fs.mkdir(directory); const file = path.join(directory, 'watched.txt'); await fs.writeFile(file, 'initial');
      const events = [], errors = [];
      const watcher = watch(directory, { persistent: false }, (type, name) => events.push({ type, name: name?.toString() || null }));
      watcher.on('error', error => errors.push(error.code || error.message));
      try {
        await delay(100); await childWrite(file, 'edit-1'); await delay(1500);
        await fs.writeFile(file + '.tmp', 'replacement'); await fs.rename(file + '.tmp', file); await delay(1500);
        await childWrite(file, 'edit-2'); await delay(1500);
        assert.ok(events.some(e => e.name === 'watched.txt')); assert.equal(errors.length, 0);
        const beforeClose = events.length; watcher.close(); await delay(50); await childWrite(file, 'after-close'); await delay(150);
        assert.equal(events.length, beforeClose);
        return { events, afterCloseAdditionalEvents: 0, authoritativeRescanContent: 'after-close', boundary: 'raw events may coalesce; they are invalidation hints, not a rename/transaction ledger' };
      } finally { watcher.close(); }
    });
    await run('FS12', 'Bounded polling detects replacements and missed events without native watch', async () => {
      const directory = path.join(root, 'poll'); await fs.mkdir(directory); const file = path.join(directory, 'poll.txt'); await fs.writeFile(file, 'initial');
      const scan = async () => Object.fromEntries(await Promise.all((await fs.readdir(directory)).map(async name => [name, (await snapshot(path.join(directory, name))).revision])));
      let baseline = await scan(), busy = false; const observations = [];
      const interval = setInterval(async () => {
        if (busy) return; busy = true;
        try { const current = await scan(); if (JSON.stringify(current) !== JSON.stringify(baseline)) { observations.push({ names: Object.keys(current), changed: Object.keys(current).filter(n => current[n] !== baseline[n]) }); baseline = current; } }
        catch (error) { observations.push({ error: error.code || error.message, resyncRequired: true }); }
        finally { busy = false; }
      }, 50);
      try {
        await childWrite(file, 'edit'); await delay(160);
        await fs.writeFile(file + '.tmp', 'replacement'); await fs.rename(file + '.tmp', file); await delay(160);
        await fs.writeFile(path.join(directory, 'new.txt'), 'created'); await delay(160);
        assert.ok(observations.some(x => x.changed?.includes('poll.txt'))); assert.ok(observations.some(x => x.names?.includes('new.txt')));
        return { observations, intervalMs: 50, fixtureFiles: 2, boundary: 'bounded fixture proof only; production must budget enumeration/hash cost and adapt interval, not hash all project files every 50 ms' };
      } finally { clearInterval(interval); while (busy) await delay(5); }
    });
    await run('FS11', 'Native file-inode watch does not guarantee monitoring after atomic replacement', async () => {
      const file = path.join(a, 'inode-watch.txt'); await fs.writeFile(file, 'initial'); const events = [];
      const watcher = watch(file, { persistent: false }, (type, name) => events.push({ phase, type, name: name?.toString() || null }));
      let phase = 'replace';
      try { await delay(100); await fs.writeFile(file + '.tmp', 'new-inode'); await fs.rename(file + '.tmp', file); await delay(200); phase = 'edit-after-replace'; await childWrite(file, 'new-inode-edit'); await delay(250); return { events, laterEditObserved: events.some(e => e.phase === 'edit-after-replace'), implication: 'prefer containing-directory subscription + rescan/rebind; one run is not a universal watcher guarantee' }; }
      finally { watcher.close(); }
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    report.fixtureCleanup = 'completed'; report.completedAt = new Date().toISOString();
    report.summary = report.cases.reduce((a, x) => ({ ...a, [x.status]: (a[x.status] || 0) + 1 }), {});
    const serialized = JSON.stringify(report, null, 2) + '\n';
    if (output >= 0) await fs.writeFile(path.resolve(process.argv[output + 1]), serialized);
    console.log(serialized); if (report.cases.some(c => c.status === 'failed')) process.exitCode = 1;
  }
}
