// Raw archive helper only: disable Electron's virtual directory interpretation.
// The expected whole-archive digest is still checked before reading entries.
process.noAsar = true;
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('/private/tmp/m10-test-dependencies-r4-offline-20261021/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar');
const root = '/private/tmp/m10-legacy-recovery-r-20261021';
const archive = '/private/tmp/m10-legacy-plugin-q2-package-20261021/mac-arm64/WillYou.app/Contents/Resources/app.asar';
const expected = '81ef7895c3e3b51fbd47029b25929b7e32e495eeeee8a1b9a32372e1ed44ffaa';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
if (hash(fs.readFileSync(archive)) !== expected) throw Error('Q2 archive changed');
const output = path.join(root, 'q2-license-snapshot');
fs.mkdirSync(output, { recursive: false });
const files = [];
for (const listed of asar.listPackage(archive)) {
  const name = listed.replace(/^\//, '');
  if (name !== 'NOTICE' && !name.startsWith('licenses/')) continue;
  if (name.split('/').some(part => part === '..' || !part)) throw Error('Invalid archive path');
  const info = asar.statFile(archive, name, false);
  if (info.files) continue;
  if (info.link || typeof info.size !== 'number') throw Error('Unexpected archive entry');
  const bytes = asar.extractFile(archive, name);
  const target = path.join(output, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  files.push({ path: name, bytes: bytes.length, sha256: hash(bytes), gitBlobSha1: blob });
}
const result = { time: new Date().toISOString(), archive, archiveSha256: expected,
  output, files, boundary: 'Read-only extraction of unchanged packaging assets; must match canonical Git asset tree before build use', M9Modified: false };
fs.writeFileSync(path.join(root, 'q2-license-snapshot.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ extracted: files.length, bytes: files.reduce((sum, entry) => sum + entry.bytes, 0), canonicalTreeCheckPending: true }));
