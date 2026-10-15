import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './common.mjs';

export const targets = [
  { platform: 'mac', arch: 'arm64', formats: ['dmg'] },
  { platform: 'mac', arch: 'x64', formats: ['dmg'] },
  { platform: 'win', arch: 'x64', formats: ['exe', 'msi'] },
  { platform: 'linux', arch: 'x64', formats: ['AppImage', 'deb', 'rpm'] },
];
export const installerName = (version, target, format) => {
  if (!target.formats.includes(format)) throw new Error(`Unexpected installer format: ${format}`);
  return `SmartDD-${version}-${target.platform}-${target.arch}.${format}`;
};
export const manifestName = (target) => `manifest-${target.platform}-${target.arch}.json`;
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export function writeManifest(dir, target, version, commit, { signed, dirty }) {
  const manifest = {
    schemaVersion: 2, version, commit, platform: target.platform, arch: target.arch, signed, dirty,
    verification: 'packaged-electron-sqlite-pty',
    files: target.formats.map((format) => {
      const file = installerName(version, target, format);
      return { file, size: statSync(join(dir, file)).size, sha256: digest(join(dir, file)) };
    }),
  };
  writeFileSync(join(dir, manifestName(target)), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verifyArtifacts(dir, version, commit, { requireMacSigning = true } = {}) {
  const files = [];
  const sums = [];
  for (const target of targets) {
    const manifest = readJson(join(dir, manifestName(target)));
    const expected = target.formats.map((format) => installerName(version, target, format));
    if (manifest.schemaVersion !== 2 || manifest.version !== version || manifest.commit !== commit || manifest.platform !== target.platform ||
        manifest.arch !== target.arch || manifest.dirty !== false || !Array.isArray(manifest.files) ||
        manifest.files.length !== expected.length || manifest.files.some((entry, index) => entry?.file !== expected[index]) ||
        manifest.verification !== 'packaged-electron-sqlite-pty') {
      throw new Error(`Artifact provenance mismatch: ${manifestName(target)}`);
    }
    if (requireMacSigning && target.platform === 'mac' && manifest.signed !== true) throw new Error('Stable macOS releases require signing and notarization');
    for (const entry of manifest.files) {
      const file = join(dir, entry.file);
      if (statSync(file).size === 0 || statSync(file).size !== entry.size || digest(file) !== entry.sha256) {
        throw new Error(`Artifact checksum mismatch: ${entry.file}`);
      }
      files.push(file);
      sums.push(`${entry.sha256}  ${entry.file}`);
    }
    files.push(join(dir, manifestName(target)));
  }
  return { files, checksums: `${sums.join('\n')}\n` };
}
