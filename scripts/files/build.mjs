import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Compile on the target macOS runner; the shipped app needs no compiler.
// Test-only suspension points are excluded from the production executable.
export function buildFileBroker({ testing = false, output = resolve('out/native/willyou-files') } = {}) {
  if (process.platform !== 'darwin') return null;
  mkdirSync(resolve(output, '..'), { recursive: true });
  execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-O2', '-Wno-deprecated-declarations', '-mmacosx-version-min=12.0', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ImageIO', '-framework', 'CoreGraphics', '-framework', 'CoreText', ...(testing ? ['-DWILLYOU_FILE_BROKER_TEST=1'] : []), 'native/files/broker.mm', '-o', output], { stdio: 'inherit' });
  return output;
}
if (process.argv[1] === new URL(import.meta.url).pathname) buildFileBroker();
