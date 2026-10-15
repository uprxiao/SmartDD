import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './common.mjs';

export const targets = [
  { platform: 'mac', arch: 'arm64', extension: 'dmg' },
  { platform: 'mac', arch: 'x64', extension: 'dmg' },
  { platform: 'win', arch: 'x64', extension: 'exe' },
];
export const installerName = (version, target) => `SmartDD-${version}-${target.platform}-${target.arch}.${target.extension}`;
export const manifestName = (target) => `manifest-${target.platform}-${target.arch}.json`;
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export function writeManifest(dir, target, version, commit, { signed, dirty }) {
  const file = installerName(version, target);
  const manifest = {
    version, commit, platform: target.platform, arch: target.arch, signed, dirty,
    verification: 'packaged-electron-sqlite-pty',
    file, size: statSync(join(dir, file)).size, sha256: digest(join(dir, file)),
  };
  writeFileSync(join(dir, manifestName(target)), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verifyArtifacts(dir, version, commit, { requireMacSigning = true } = {}) {
  const files = [];
  const sums = [];
  for (const target of targets) {
    const manifest = readJson(join(dir, manifestName(target)));
    const expected = installerName(version, target);
    if (manifest.version !== version || manifest.commit !== commit || manifest.platform !== target.platform ||
        manifest.arch !== target.arch || manifest.file !== expected || manifest.dirty !== false ||
        manifest.verification !== 'packaged-electron-sqlite-pty') {
      throw new Error(`Artifact provenance mismatch: ${manifestName(target)}`);
    }
    if (requireMacSigning && target.platform === 'mac' && manifest.signed !== true) throw new Error('Stable macOS releases require signing and notarization');
    const file = join(dir, expected);
    if (statSync(file).size === 0 || statSync(file).size !== manifest.size || digest(file) !== manifest.sha256) {
      throw new Error(`Artifact checksum mismatch: ${expected}`);
    }
    files.push(file, join(dir, manifestName(target)));
    sums.push(`${manifest.sha256}  ${expected}`);
  }
  return { files, checksums: `${sums.join('\n')}\n` };
}
