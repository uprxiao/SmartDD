import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, lstat, realpath, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join, isAbsolute, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { FileError } from '@shared/files';
import { VIEWER_LIMITS, type ViewerManifest } from '@shared/file-viewer';

type StdioManifest = Extract<ViewerManifest['provider'], { kind: 'stdio' }>;
export async function prepareStdioProvider(manifest: StdioManifest, bytes: Buffer, name: string, sessionId: string, protectedRoot: string) {
  if (process.platform !== 'darwin') throw new FileError('UNSUPPORTED', '本平台尚未验证扩展进程隔离；可使用本机资源适配器');
  const command = await realpath(manifest.command), runtime = await Promise.all(manifest.runtimePaths.map(path => realpath(path)));
  const root = await realpath(protectedRoot);
  for (const path of [command, ...runtime]) {
    if (!isAbsolute(path) || path === '/' || path === root || path.startsWith(root + '/') || root.startsWith(path + '/')) throw new FileError('UNTRUSTED', '扩展运行资源不能覆盖当前项目目录');
  }
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'willyou-mcp-'))), identity = await lstat(directory, { bigint: true });
  // Only the filename suffix is retained. Original absolute paths are never passed.
  const extension = name.match(/(?:\.[a-zA-Z0-9_-]+){1,3}$/)?.[0] ?? '.bin';
  const file = join(directory, `resource${extension}`);
  const replacements: Record<string, string> = { '${file}': file, '${fileUri}': pathToFileURL(file).href, '${session}': sessionId };
  const expand = (value: string) => value.replace(/\$\{(?:file|fileUri|session)\}/g, token => replacements[token]);
  let written = false;
  const cleanup = async () => {
    const stat = await lstat(directory, { bigint: true }).catch(() => null);
    if (!stat || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino) return;
    if (written) await unlink(file).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
  };
  try {
    await writeFile(file, bytes, { flag: 'wx', mode: 0o400 }); written = true;
    const literal = (path: string) => JSON.stringify(path);
    // The provider cannot write snapshots or project data, create children, use
    // sockets, read HOME credentials, or inherit the main application's cwd/env.
    const profile = `(version 1) (deny default) (allow process-exec (literal ${literal(command)})) (allow signal (target self)) (allow process-info* (target self)) (allow sysctl-read) (allow file-read-metadata) (allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/Library/Apple") (subpath "/private/var/db/dyld") (literal "/") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/null") (literal ${literal(command)}) (literal ${literal(file)}) ${runtime.map(path => `(subpath ${literal(path)})`).join(' ')}) (deny file-read* (subpath ${literal(root)}))`;
    const parameters: StdioServerParameters = { command: '/usr/bin/sandbox-exec', args: ['-p', profile, command, ...manifest.args.map(expand)], env: { PATH: `${dirname(command)}:/usr/bin:/bin`, LANG: 'en_US.UTF-8', HOME: directory, TMPDIR: directory, ELECTRON_RUN_AS_NODE: '1', OPENSSL_CONF: '/dev/null' }, cwd: directory, stderr: 'pipe', maxBufferSize: VIEWER_LIMITS.frameBytes };
    const transport = new StdioClientTransport(parameters);
    // Consume diagnostics without accumulating unbounded output or leaking it.
    transport.stderr?.on('data', () => undefined);
    return { transport, uri: expand(manifest.resourceUri), uiUri: manifest.uiResourceUri ? expand(manifest.uiResourceUri) : undefined, arguments: (value: unknown): unknown => typeof value === 'string' ? expand(value) : Array.isArray(value) ? value.map(v => typeof v === 'string' ? expand(v) : v) : value, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
