import {lstatSync, realpathSync} from 'node:fs';
import {isAbsolute, sep} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {agentControlRootPath,codexDaemonRootPath} from '../agent-control-path';

export interface PluginSandboxPaths {
  packageRoot: string;
  dataRoot: string;
  protectedRoots: readonly string[];
  readOnlyRoots: readonly string[];
  keychainRoots: readonly string[];
}
const under = (path: string, root: string) => path === root || path.startsWith(root + sep);
function canonical(path: string): string {
  if (!isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw new ApplicationError('SCOPE_DENIED', '插件隔离路径无效');
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new ApplicationError('SCOPE_DENIED', '插件隔离路径不能为链接');
  return realpathSync(path);
}
const literal = (path: string) => JSON.stringify(path);

/** Seatbelt restrictions are inherited across exec/fork. No child process is permitted in v1. */
export function pluginSandboxProfile(paths: PluginSandboxPaths): string {
  const pack = canonical(paths.packageRoot), data = canonical(paths.dataRoot);
  const roots = paths.protectedRoots.map(canonical);
  if (!roots.length || !paths.keychainRoots.length || !paths.readOnlyRoots.length || under(pack, data) || under(data, pack) || !roots.some(root => under(data, root) && data !== root)) throw new ApplicationError('SCOPE_DENIED', '插件目录隔离边界无效');
  const restrictions = roots.map(root => `(deny file-read-data file-write* (require-all (subpath ${literal(root)}) (require-not (subpath ${literal(pack)})) (require-not (subpath ${literal(data)}))))`);
  const readonly = [pack, ...paths.readOnlyRoots.map(canonical)];
  for (const root of readonly) {
    if (under(data, root)) throw new ApplicationError('SCOPE_DENIED', '插件私有目录与只读目录重叠');
    restrictions.push(`(deny file-write* (subpath ${literal(root)}))`);
  }
  for (const root of paths.keychainRoots.map(canonical)) {
    if (under(data, root) || under(pack, root)) throw new ApplicationError('SCOPE_DENIED', '插件目录与钥匙串目录重叠');
    restrictions.push(`(deny file-read-data file-write* (subpath ${literal(root)}))`);
  }
  return [
    '(version 1)', '(allow default)', ...restrictions,
    // File-read denial alone does not prohibit connect(2) to a Unix socket.
    // Reserve the whole host namespace so already-running plugins are covered.
    `(deny network-outbound (remote unix-socket (subpath ${literal(agentControlRootPath())})))`,
    `(deny file-read-data file-write* (subpath ${literal(agentControlRootPath())}))`,
    // Codex's advertised path points to this host-local privileged namespace.
    `(deny network-outbound (remote unix-socket (subpath ${literal(codexDaemonRootPath())})))`,
    `(deny file-read-data file-write* (subpath ${literal(codexDaemonRootPath())}))`,
    '(deny process-fork)',
    // Do not rely on private HOME: the login keychain is also reachable through securityd IPC.
    '(deny mach-lookup (global-name-regex "^com\\.apple\\.(securityd|secd|SecurityServer|ctkd)(\\.|$)"))',
  ].join('\n');
}
