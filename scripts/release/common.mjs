import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const builder = createRequire(import.meta.url)('../../electron-builder.config.cjs');
export const productName = builder.productName;
export const linuxExecutableName = builder.linux.executableName;
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const isMain = (url) => Boolean(process.argv[1]) && fileURLToPath(url) === resolve(process.argv[1]);

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
  return result.stdout?.toString().trim();
}

export function runBin(packageName, binName, args, options = {}) {
  const dir = join(root, 'node_modules', packageName);
  const { bin } = readJson(join(dir, 'package.json'));
  return run(process.execPath, [join(dir, typeof bin === 'string' ? bin : bin[binName]), ...args], options);
}

export function packagedApp(output, platform, arch) {
  const app = platform === 'mac'
    ? join(output, arch === 'arm64' ? 'mac-arm64' : 'mac', `${productName}.app`, 'Contents')
    : join(output, platform === 'linux' ? 'linux-unpacked' : 'win-unpacked');
  return {
    executable: platform === 'mac' ? join(app, 'MacOS', productName) : join(app, platform === 'linux' ? linuxExecutableName : `${productName}.exe`),
    resources: join(app, platform === 'mac' ? 'Resources' : 'resources'),
  };
}
