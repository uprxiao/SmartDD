import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';

const specification = JSON.parse(readFileSync(resolve('resources/agent-browser/SOURCE.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const arch = process.argv[3] ?? process.arch;
const targets = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' };
if (process.platform !== 'darwin' || !targets[arch]) throw Error('S1 helper build requires a supported macOS target');
const destination = resolve(process.argv[2] ?? 'out/agent-browser');
const patch = resolve('resources/agent-browser', specification.patch.path);
if (hash(readFileSync(patch)) !== specification.patch.sha256) throw Error('agent-browser patch hash mismatch');
const buildKey = specification.upstream.commit + '-' + specification.patch.sha256.slice(0, 16);
const work = resolve('out/agent-browser-build', buildKey);
mkdirSync(work, { recursive: true });
const archive = join(work, 'upstream.tar.gz');
if (!existsSync(archive) || hash(readFileSync(archive)) !== specification.upstream.archiveSha256) {
  execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '60', specification.upstream.url, '--output', archive], { timeout: 65000 });
}
if (hash(readFileSync(archive)) !== specification.upstream.archiveSha256) throw Error('agent-browser source archive hash mismatch');
const source = join(work, 'agent-browser-' + specification.upstream.commit);
const inputStamp = hash(Buffer.concat([readFileSync(archive), readFileSync(patch)]));
const marker = join(work, 'patched-input.sha256');
if (!existsSync(marker) || readFileSync(marker, 'utf8') !== inputStamp) {
  rmSync(source, { recursive: true, force: true });
  execFileSync('tar', ['-xzf', archive, '-C', work], { timeout: 10000 });
  if (hash(readFileSync(join(source, 'cli/Cargo.lock'))) !== specification.build.upstreamCargoLockSha256) throw Error('agent-browser upstream lock hash mismatch');
  execFileSync('patch', ['--batch', '--fuzz=0', '-p1', '-i', patch], { cwd: source, timeout: 10000, stdio: 'inherit' });
  if (hash(readFileSync(join(source, 'cli/Cargo.lock'))) !== specification.build.cargoLockSha256) throw Error('agent-browser patched lock hash mismatch');
  writeFileSync(marker, inputStamp);
}
const target = targets[arch], profile = specification.build.profile;
const rustc = execFileSync('rustc', ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
if (!rustc.startsWith('rustc ' + specification.build.rustVersion + ' ')) throw Error('Pinned Rust compiler required: ' + specification.build.rustVersion);
const cargoHome = join(work, 'cargo-home'), targetDir = join(work, 'target');
mkdirSync(cargoHome, { recursive: true });
const env = { ...process.env, CARGO_HOME: cargoHome, CARGO_TARGET_DIR: targetDir,
  RUSTFLAGS: '--remap-path-prefix=' + work + '=/willyou-agent-browser-build' };
execFileSync('cargo', ['build', '--locked', '--profile', profile, '--target', target, '--jobs', '2'], { cwd: join(source, 'cli'), env, stdio: 'inherit', timeout: 1800000 });
const built = join(targetDir, target, profile, 'agent-browser');
const actualVersion = execFileSync(built, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
if (!actualVersion.includes(specification.version)) throw Error('Patched helper version mismatch');
const folder = join(destination, arch), executable = join(folder, 'agent-browser');
mkdirSync(folder, { recursive: true }); cpSync(built, executable); chmodSync(executable, 0o755);
cpSync(join(source, 'LICENSE'), join(destination, 'LICENSE'));
const entry = { arch, target, path: arch + '/agent-browser', sha256: hash(readFileSync(executable)), bytes: readFileSync(executable).length };
let previous;
try { previous = JSON.parse(readFileSync(join(destination, 'SOURCE.json'), 'utf8')); } catch {}
const files = previous?.patch?.sha256 === specification.patch.sha256 ? previous.files.filter(file => file.arch !== arch) : [];
files.push(entry); files.sort((a, b) => a.arch.localeCompare(b.arch));
const metadata = { ...specification, build: { ...specification.build, rustc }, files };
writeFileSync(join(destination, 'SOURCE.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ destination, version: specification.version, upstream: specification.upstream.commit, patch: specification.patch.sha256, files }));
