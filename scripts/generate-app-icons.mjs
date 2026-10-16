// Export the approved artwork into native icon containers; no image-generation dependency.
// Run on macOS: node scripts/generate-app-icons.mjs [--artwork jade-teal | --proportion 70|75|80]
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

if (process.platform !== 'darwin') throw new Error('Icon export uses macOS sips/iconutil. All generated icons are checked in for cross-platform builds.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'build/icons');
const selectionFile = join(icons, 'selection.json');
const { values } = parseArgs({ options: { proportion: { type: 'string' }, artwork: { type: 'string' } } });
if (values.artwork && values.proportion) throw new Error('Choose either --artwork or --proportion.');
const selected = JSON.parse(readFileSync(selectionFile, 'utf8'));
const design = values.artwork ?? (values.proportion ? '06' : selected.artwork ?? '06');
if (!['06', 'jade-teal', 'jade-teal-eyes'].includes(design)) throw new Error('Choose --artwork jade-teal, jade-teal-eyes or --proportion 70, 75 or 80.');
const proportion = values.proportion ?? String(selected.proportion ?? 70);
if (design === '06' && !['70', '75', '80'].includes(proportion)) throw new Error('Choose --proportion 70, 75 or 80.');
const selection = design === '06' ? { artwork: design, proportion: Number(proportion) } : { artwork: design };
const source = join(icons, 'variants', design === '06' ? `SmartDD-06-${proportion}.png` : design === 'jade-teal' ? 'WillYou-jade-teal.png' : 'Willyu-jade-teal-eyes.png');
// The approved variants are already 1024px canvases: preserve their exact pixels.
const png = readFileSync(source);
if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024) {
  throw new Error('Expected an approved 1024 × 1024 PNG icon.');
}
const artwork = join(root, 'src/assets/branding/app-icon.png');
const scratch = mkdtempSync(join(tmpdir(), 'smartdd-icons-'));
const resize = (size, output) => execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', output], { stdio: 'pipe' });

try {
  mkdirSync(join(icons, 'png'), { recursive: true });
  mkdirSync(dirname(artwork), { recursive: true });
  copyFileSync(source, artwork);
  // The browser prototype and its favicon consume the same approved pixels.
  const prototypeArtwork = join(root, 'prototypes/m6-codex/public/assets/app-icon.png');
  mkdirSync(dirname(prototypeArtwork), { recursive: true });
  copyFileSync(source, prototypeArtwork);

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
  writeFileSync(selectionFile, `${JSON.stringify(selection, null, 2)}\n`);
  console.log(`Selected ${design}${design === '06' ? ` / ${proportion}%` : ''}. Exported app/prototype artwork, macOS ICNS, Windows ICO and Linux PNG icons.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
