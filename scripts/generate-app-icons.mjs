// Export the approved artwork into native icon containers; no image-generation dependency.
// Run on macOS: node scripts/generate-app-icons.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Icon export uses macOS sips/iconutil. All generated icons are checked in for cross-platform builds.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'docs/design/app-icon/smartdd-ant-lift-v1.png');
const icons = join(root, 'build/icons');
const artwork = join(root, 'src/assets/branding/app-icon.png');
const scratch = mkdtempSync(join(tmpdir(), 'smartdd-icons-'));
const resize = (size, output) => execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', output], { stdio: 'pipe' });

try {
  mkdirSync(join(icons, 'png'), { recursive: true });
  mkdirSync(dirname(artwork), { recursive: true });
  resize(1024, artwork);

  const iconset = join(scratch, 'app.iconset');
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    resize(size, join(iconset, `icon_${size}x${size}.png`));
    resize(size * 2, join(iconset, `icon_${size}x${size}@2x.png`));
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(icons, 'icon.icns')], { stdio: 'pipe' });

  // PNG-compressed ICO entries are supported by modern Windows, with native sizes
  // for the taskbar, Explorer and installer rather than a single scaled bitmap.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => {
    const png = join(scratch, `${size}.png`);
    resize(size, png);
    return readFileSync(png);
  });
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  writeFileSync(join(icons, 'icon.ico'), Buffer.concat([header, ...images]));
  for (const size of [16, 32, 48, 64, 128, 256, 512]) resize(size, join(icons, 'png', `${size}x${size}.png`));
  copyFileSync(artwork, join(icons, 'icon.png'));
  console.log('Exported app artwork, macOS ICNS, Windows ICO and Linux PNG icons.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
