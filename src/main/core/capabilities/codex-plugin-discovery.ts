import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { compareBuild, valid } from 'semver';

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const segment = (name: string) => /^[A-Za-z0-9_.+-]{1,200}$/.test(name) && name !== '.' && name !== '..';
const directory = (path: string) => { try { return lstatSync(path).isDirectory(); } catch { return false; } };
const entries = (path: string) => { try { return readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory() && segment(e.name)).map(e => e.name).sort().slice(0, 2000); } catch { return []; } };
const inside = (root: string, path: string) => {
  const r = relative(root, path);
  return r === '' || !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep);
};
function contained(root: string, path: string): boolean {
  if (!inside(resolve(root), resolve(path))) return false;
  try { return inside(realpathSync(root), realpathSync(path)); } catch { return !existsSync(path); }
}
const schema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const mcpSchema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
function rootManifestJson(path: string): Obj | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    return object(JSON.parse(readFileSync(path, 'utf8')));
  } catch { return null; }
}

export interface CodexPluginSource {
  key: string; root: string; manifestPath: string; version: string; enabled: boolean | null;
  skills: string[]; mcpPath: string; servers: Obj;
}

/** Static inventory only. Remote install identity proves a local installation,
 * not the remote account's enabled/loaded state. No plugin scripts or hooks run. */
export function discoverCodexPlugins(stateRoot: string, configurations: Obj[], json: (path: string) => Obj | null,
  issue: (path: string, source: string, reason: string) => void): CodexPluginSource[] {
  const configured = new Map<string, Obj>();
  for (const config of configurations) for (const [key, raw] of Object.entries(object(config.plugins))) {
    configured.set(key, { ...configured.get(key), ...object(raw) });
  }
  const cache = join(stateRoot, 'plugins/cache'), result: CodexPluginSource[] = [];
  for (const market of entries(cache)) for (const name of entries(join(cache, market))) {
    if (result.length >= 2000) return result;
    const key = `${name}@${market}`, base = join(cache, market, name), policy = configured.get(key);
    try {
    if (!directory(join(cache, market)) || !directory(base)) continue;
    const markerPath = join(base, '.codex-remote-plugin-install.json');
    const marker = existsSync(markerPath) ? json(markerPath) : null;
    const remote = marker?.schema_version === 1 && typeof marker.remote_plugin_id === 'string' && Boolean(marker.remote_plugin_id.trim());
    if (!policy && !remote) continue;
    const versions = entries(base).sort((a, b) => {
      // Rust's semver Version ordering includes build metadata. Non-semver
      // version directories use ASCII lexical order; `local` always wins.
      const strict = (v: string) => /^\d/.test(v) && v.trim() === v && valid(v) !== null;
      return strict(a) && strict(b) ? compareBuild(a, b) : a < b ? -1 : a > b ? 1 : 0;
    });
    const version = versions.includes('local') ? 'local' : versions.at(-1);
    if (!version) continue;
    const root = join(base, version), source = `plugin:${key}`;
    const rootManifest = join(root, 'plugin.json');
    let manifestPath: string | undefined, manifest: Obj | null = null, portable = false;
    if (existsSync(rootManifest)) {
      if (!lstatSync(rootManifest).isFile()) { issue(rootManifest, source, 'plugin_manifest_unverified'); continue; }
      const candidate = rootManifestJson(rootManifest);
      if (typeof candidate?.$schema === 'string' && candidate.$schema.startsWith('https://agent-plugins.org/schemas/')) {
        manifestPath = rootManifest; manifest = candidate; portable = true;
        if (candidate.$schema !== schema) { issue(rootManifest, source, 'plugin_manifest_unverified'); continue; }
      }
    }
    if (!manifestPath) for (const location of ['.codex-plugin', '.claude-plugin', '.cursor-plugin']) {
      const path = join(root, location, 'plugin.json');
      if (!existsSync(path)) continue;
      if (!directory(join(root, location)) || !lstatSync(path).isFile()) break;
      manifestPath = path; manifest = json(path); break;
    }
    if (!manifestPath || !manifest) { issue(rootManifest, source, 'plugin_manifest_unverified'); continue; }
    if (portable && (typeof manifest.name !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/.test(manifest.name) || /--|\.\./.test(manifest.name))) {
      issue(manifestPath, source, 'plugin_manifest_unverified'); continue;
    }
    if (portable && (['version', 'description', 'homepage', 'repository', 'license'].some(k => manifest[k] !== undefined && typeof manifest[k] !== 'string')
      || manifest.keywords !== undefined && (!Array.isArray(manifest.keywords) || manifest.keywords.some(k => typeof k !== 'string'))
      || manifest.author !== undefined && (manifest.author === null || typeof manifest.author !== 'object' || Array.isArray(manifest.author)
        || ['name', 'email', 'url'].some(k => object(manifest.author)[k] !== undefined && typeof object(manifest.author)[k] !== 'string')))) {
      issue(manifestPath, source, 'plugin_manifest_unverified'); continue;
    }
    const enabled = policy ? policy.enabled !== false : null;
    const paths = (value: unknown, fallback: string) => {
      const all = value === undefined ? [fallback] : Array.isArray(value) ? value : [value];
      return all.flatMap(path => {
        if (typeof path !== 'string' || !path.startsWith('./') || path.slice(2).split(/[\\/]/).includes('..') || !contained(root, resolve(root, path))) {
          issue(manifestPath!, source, 'plugin_path_unverified'); return [];
        }
        return [resolve(root, path)];
      });
    };
    const skillRoots = paths(portable ? undefined : manifest.skills, './skills');
    if (!skillRoots.length) skillRoots.push(join(root, 'skills'));
    if (!portable && directory(join(root, '.codex-plugin/migrated-command-skills'))) skillRoots.push(join(root, '.codex-plugin/migrated-command-skills'));
    const skills: string[] = [], visited = new Set<string>();
    const walk = (dir: string, depth: number) => {
      if (depth > 5 || skills.length >= 2000 || !directory(dir) || !contained(root, dir)) return;
      const canonical = realpathSync(dir); if (visited.has(canonical)) return; visited.add(canonical);
      const file = join(dir, 'SKILL.md');
      if (existsSync(file) && contained(root, file)) { skills.push(file); return; }
      for (const child of entries(dir)) {
        if (child.startsWith('.') || ['node_modules', 'validation', 'productions', '__pycache__'].includes(child)) continue;
        const next = join(dir, child);
        if (portable) { const file = join(next, 'SKILL.md'); if (existsSync(file) && contained(root, file)) skills.push(file); }
        else walk(next, depth + 1);
      }
    };
    for (const path of skillRoots) walk(path, 0);
    let mcpPath = manifestPath, servers: Obj = {};
    const mcp = portable ? './mcp.json' : manifest.mcpServers ?? './.mcp.json';
    if (typeof mcp === 'string') {
      const path = paths(mcp, './.mcp.json')[0] ?? join(root, portable ? 'mcp.json' : '.mcp.json');
      if (path && existsSync(path)) {
        mcpPath = path;
        if (!lstatSync(path).isFile()) issue(path, source, 'plugin_mcp_unverified');
        else {
          const content = json(path);
          if (portable && content?.$schema !== mcpSchema) issue(path, source, 'plugin_mcp_unverified');
          else if (content) servers = object(content.mcpServers ?? content);
        }
      }
    } else if (mcp !== null && typeof mcp === 'object' && !Array.isArray(mcp)) servers = mcp as Obj;
    else issue(manifestPath, source, 'plugin_mcp_unverified');
    const normalized: Obj = {};
    for (const [server, value] of Object.entries(servers)) {
      try {
        const raw = { ...object(value) };
        const target = portable ? normalizePortableMcp(raw, root, stateRoot, market, name) : raw;
        if (!portable && typeof target.cwd === 'string' && !isAbsolute(target.cwd)) target.cwd = resolve(root, target.cwd);
        // Installed-plugin policy cannot widen a package's own restrictions.
        const perServer = object(object(policy?.mcp_servers)[server]);
        if (enabled === false || perServer.enabled === false) target.enabled = false;
        const union = (a: unknown, b: unknown) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
        target.disabled_tools = union(target.disabled_tools, perServer.disabled_tools);
        if (Array.isArray(perServer.enabled_tools)) target.enabled_tools = Array.isArray(target.enabled_tools) ? target.enabled_tools.filter(t => (perServer.enabled_tools as unknown[]).includes(t)) : perServer.enabled_tools;
        if (Object.keys(perServer).some(k => !['enabled', 'disabled_tools', 'enabled_tools'].includes(k))) throw Error('unsupported policy');
        normalized[server] = target;
      } catch { issue(mcpPath, source, 'plugin_mcp_unverified'); }
    }
    result.push({ key, root, manifestPath, version, enabled, skills, mcpPath, servers: normalized });
    } catch { issue(base, `plugin:${key}`, 'plugin_source_changed'); }
  }
  return result;
}

function normalizePortableMcp(raw: Obj, root: string, stateRoot: string, market: string, name: string): Obj {
  const keys = (allowed: string[]) => { if (Object.keys(raw).some(k => !allowed.includes(k))) throw Error('unsupported portable field'); };
  if (raw.type === 'stdio') {
    keys(['type', 'command', 'args', 'env', 'cwd']);
    if (typeof raw.command !== 'string' || !raw.command || raw.command.includes('\\') || raw.command.includes('/') && !raw.command.startsWith('./')) throw Error('invalid portable command');
    const data = join(stateRoot, 'plugins/data/agent-plugins', createHash('sha256').update(market).update('\0').update(name).digest('hex'));
    const expand = (value: unknown) => { if (typeof value !== 'string') throw Error('invalid string'); return value.replaceAll('${PLUGIN_ROOT}', root).replaceAll('${PLUGIN_DATA}', data); };
    if (raw.env !== undefined && (raw.env === null || typeof raw.env !== 'object' || Array.isArray(raw.env))) throw Error('invalid environment');
    const env = object(raw.env); if (Object.hasOwn(env, 'PLUGIN_ROOT') || Object.hasOwn(env, 'PLUGIN_DATA')) throw Error('reserved environment');
    const command = raw.command.startsWith('./') ? resolve(root, raw.command) : raw.command;
    if (raw.command.startsWith('./') && (raw.command.split('/').includes('..') || !contained(root, command))) throw Error('command escapes package');
    const cwdRaw = raw.cwd === undefined ? '${PLUGIN_ROOT}' : raw.cwd;
    if (typeof cwdRaw !== 'string' || !/^(?:\.\/|\$\{PLUGIN_(?:ROOT|DATA)\}(?:\/|$))/.test(cwdRaw) || cwdRaw.split('/').includes('..')) throw Error('invalid portable cwd');
    const cwdBase = cwdRaw.startsWith('${PLUGIN_DATA}') ? data : root, cwd = resolve(cwdBase, expand(cwdRaw));
    if (!contained(cwdBase, cwd)) throw Error('cwd escapes package');
    if (raw.args !== undefined && !Array.isArray(raw.args)) throw Error('invalid args');
    return { command, args: (raw.args as unknown[] | undefined ?? []).map(expand), cwd, env: { ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, expand(v)])), PLUGIN_ROOT: root, PLUGIN_DATA: data } };
  }
  if (raw.type === 'streamable-http') {
    keys(['type', 'url', 'headers']);
    if (typeof raw.url !== 'string') throw Error('invalid URL');
    const url = new URL(raw.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('invalid portable URL');
    const owned = new Set(['accept','authorization','connection','content-encoding','content-length','content-type','host','last-event-id','mcp-protocol-version','mcp-session-id','proxy-authorization','te','trailer','transfer-encoding','upgrade','user-agent']);
    if (raw.headers !== undefined && (raw.headers === null || Array.isArray(raw.headers) || typeof raw.headers !== 'object')) throw Error('invalid headers');
    const headers: Record<string, string> = {}, seen = new Set<string>();
    for (const [k, v] of Object.entries(object(raw.headers))) {
      const lower = k.toLowerCase();
      if (seen.has(lower) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) || typeof v !== 'string' || /[\x00-\x08\x0a-\x1f\x7f]/.test(v)) throw Error('invalid headers');
      seen.add(lower); if (!owned.has(lower)) headers[k] = v;
    }
    return { url: raw.url, http_headers: headers };
  }
  throw Error('unsupported portable transport');
}
