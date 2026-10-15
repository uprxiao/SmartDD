// Read-only discovery, drawing on Yoda's realpath/source scanning (Apache-2.0).
// Parse errors stay visible. No MCP command, auth helper or model is executed here.
import { accessSync, constants, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import type { DiscoveredCapability } from '@shared/capabilities';
import type { Runner } from '@shared/types';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const object = (v: unknown): Obj => isObject(v) ? v : {};
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
const LIMIT = 1024 * 1024;

export interface DiscoveryContext {
  runner: Runner;
  cwd: string;
  home: string;
  stateRoot: string;
  /** Explicit CLAUDE_CONFIG_DIR changes the location of .claude.json even at ~/.claude. */
  claudeConfigExplicit?: boolean;
  path: string;
  args?: string[];
}

function textFile(path: string): string {
  if (statSync(path).size > LIMIT) throw new Error('too_large');
  return readFileSync(path, 'utf8');
}

function executable(command: string, cwd: string, path: string): boolean {
  const candidates = isAbsolute(command) ? [command] : command.includes('/') ? [resolve(cwd, command)] : path.split(delimiter).filter(Boolean).map((p) => join(p, command));
  return candidates.some((p) => {
    try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; }
  });
}

/** Stop at the nearest repository marker, or HOME; keep every project layer in precedence order. */
export function projectLayers(cwd: string, home: string): string[] {
  const layers: string[] = [];
  for (let p = resolve(cwd); p !== dirname(p); p = dirname(p)) {
    if (p === home) break;
    layers.push(p);
    if (existsSync(join(p, '.git')) || existsSync(join(p, '.svn'))) break;
  }
  return layers.reverse();
}

export function discoverCapabilities(c: DiscoveryContext): DiscoveredCapability[] {
  const rows: DiscoveredCapability[] = [];
  const seen = new Set<string>();
  const layers = projectLayers(c.cwd, c.home);
  const row = (kind: 'skill' | 'mcp', name: string, path: string, source: string): DiscoveredCapability => ({
    id: `${c.runner}:${kind}:${path}:${name}`, kind, name: name.slice(0, 120), runner: c.runner, path, source,
    version: null, enabled: null, validity: 'partial', issues: [], loaded: 'unverified', envNames: [],
  });
  const badFile = (kind: 'skill' | 'mcp', path: string, source: string, issue: string) => {
    const r = row(kind, kind === 'mcp' ? 'MCP config' : 'Skill', path, source);
    r.validity = 'invalid'; r.issues = [issue]; rows.push(r);
  };
  const scanSkill = (file: string, source: string, command = false, enabled: boolean | null = null, version: string | null = null) => {
    if (rows.length >= 2000) return;
    let canonical: string;
    try { canonical = realpathSync(file); } catch { badFile('skill', file, source, 'path_unreadable'); return; }
    if (seen.has(canonical)) return;
    seen.add(canonical);
    const r = row('skill', dirname(file).split('/').at(-1) ?? 'Skill', file, source);
    r.enabled = enabled;
    r.version = version;
    try {
      const content = textFile(file);
      const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
      const meta = front ? object(parseYaml(front[1], { maxAliasCount: 25, logLevel: 'silent' })) : {};
      if (typeof meta.name === 'string' && /^[\w.-]{1,100}$/.test(meta.name)) r.name = meta.name;
      if (!command && (typeof meta.name !== 'string' || typeof meta.description !== 'string' || !meta.description.trim())) r.issues.push('skill_metadata_missing');
      const v = object(meta.metadata).version ?? meta.version;
      if (typeof v === 'string' || typeof v === 'number') r.version = String(v).slice(0, 40);
      r.validity = r.issues.length ? 'invalid' : existsSync(join(dirname(file), 'scripts')) ? 'partial' : 'valid';
      if (r.validity === 'partial') r.issues.push('runtime_dependencies_unverified');
    } catch { r.validity = 'invalid'; r.issues.push('skill_parse_failed'); }
    rows.push(r);
  };
  const scanDir = (dir: string, source: string, command = false, enabled: boolean | null = null, version: string | null = null, depth = 0, visited = new Set<string>()) => {
    if (!existsSync(dir) || depth > 5 || rows.length >= 2000) return;
    try {
      const canonical = realpathSync(dir);
      if (visited.has(canonical)) return;
      visited.add(canonical);
      const skill = join(dir, 'SKILL.md');
      if (!command && existsSync(skill)) { scanSkill(skill, source, false, enabled, version); return; }
      for (const name of readdirSync(dir).sort()) {
        if (name.startsWith('.') || ['node_modules', 'validation', 'productions', '__pycache__'].includes(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) scanDir(p, source, command, enabled, version, depth + 1, visited);
        else if (command && name.endsWith('.md')) scanSkill(p, source, true, enabled, version);
      }
    } catch { badFile('skill', dir, source, 'path_unreadable'); }
  };
  const readConfig = (path: string): Obj | null => {
    if (!existsSync(path)) return null;
    try {
      const config = path.endsWith('.toml') ? parseToml(textFile(path)) : JSON.parse(textFile(path));
      if (!isObject(config)) { badFile('mcp', path, 'configuration', 'config_shape_invalid'); return null; }
      return config;
    }
    catch { badFile('mcp', path, 'configuration', 'config_parse_failed'); return null; }
  };
  const addMcp = (servers: unknown, path: string, source: string, enabled: boolean | null = null) => {
    if (servers === undefined) return;
    if (!isObject(servers)) { badFile('mcp', path, source, 'config_shape_invalid'); return; }
    for (const [name, raw] of Object.entries(servers)) {
      if (rows.length >= 2000) break;
      const r = row('mcp', name, path, source);
      const s = object(raw);
      r.enabled = typeof s.enabled === 'boolean' ? s.enabled : enabled;
      // Expose only identifiers, never values, URL, command, args or headers.
      r.envNames = [...Object.keys(object(s.env)), ...strings(s.env_vars), ...(typeof s.bearer_token_env_var === 'string' ? [s.bearer_token_env_var] : [])].filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
      let invalid = false;
      if (s.url !== undefined) {
        try {
          if (typeof s.url !== 'string' || !['http:', 'https:'].includes(new URL(s.url).protocol)) throw new Error();
          r.issues.push('network_auth_unverified');
        } catch { invalid = true; r.issues.push('mcp_url_invalid'); }
      } else if (typeof s.command !== 'string' || !s.command.trim()) {
        invalid = true; r.issues.push('mcp_command_missing');
      } else {
        if (!executable(s.command, c.cwd, c.path)) r.issues.push('command_path_unverified');
        r.issues.push('runtime_dependencies_unverified');
      }
      if (s.args !== undefined && (!Array.isArray(s.args) || s.args.some((v) => typeof v !== 'string'))) { invalid = true; r.issues.push('mcp_args_invalid'); }
      if (s.env !== undefined && (!s.env || Array.isArray(s.env) || typeof s.env !== 'object' || Object.values(object(s.env)).some((v) => typeof v !== 'string'))) { invalid = true; r.issues.push('mcp_env_invalid'); }
      if (source.includes('project')) r.issues.push('project_trust_unverified');
      r.validity = invalid ? 'invalid' : 'partial';
      rows.push(r);
    }
  };

  if (c.runner === 'claude') {
    scanDir(join(c.stateRoot, 'skills'), 'user');
    scanDir(join(c.stateRoot, 'commands'), 'user commands', true);
    const settings: Obj[] = [];
    const globalSettings = readConfig(join(c.stateRoot, 'settings.json'));
    if (globalSettings) settings.push(globalSettings);
    for (const p of layers) {
      scanDir(join(p, '.claude', 'skills'), 'project');
      scanDir(join(p, '.claude', 'commands'), 'project commands', true);
      for (const file of ['settings.json', 'settings.local.json']) {
        const config = readConfig(join(p, '.claude', file));
        if (config) settings.push(config);
      }
      const file = join(p, '.mcp.json');
      const config = readConfig(file);
      if (config) addMcp(config.mcpServers, file, 'project');
    }
    const explicitRoot = c.claudeConfigExplicit ?? c.stateRoot !== join(c.home, '.claude');
    const mainConfigPath = explicitRoot ? join(c.stateRoot, '.claude.json') : join(c.home, '.claude.json');
    const config = readConfig(mainConfigPath);
    if (config) {
      addMcp(config.mcpServers, mainConfigPath, 'user');
      let canonicalCwd = c.cwd;
      try { canonicalCwd = realpathSync(c.cwd); } catch { /* report path problems elsewhere */ }
      const projectConfig = object(config.projects)[canonicalCwd] ?? object(config.projects)[c.cwd];
      addMcp(object(projectConfig).mcpServers, mainConfigPath, 'project local');
    }
    const enabledPlugins = Object.assign({}, ...settings.map((s) => object(s.enabledPlugins))) as Obj;
    const installed = readConfig(join(c.stateRoot, 'plugins', 'installed_plugins.json'));
    for (const [name, entries] of Object.entries(object(installed?.plugins))) {
      for (const entry of Array.isArray(entries) ? entries : [entries]) {
        const p = object(entry);
        if (typeof p.installPath !== 'string' || (typeof p.projectPath === 'string' && !layers.includes(p.projectPath))) continue;
        const enabled = typeof enabledPlugins[name] === 'boolean' ? enabledPlugins[name] as boolean : null;
        const version = typeof p.version === 'string' ? p.version : null;
        scanDir(join(p.installPath, 'skills'), `plugin:${name}`, false, enabled, version);
        scanDir(join(p.installPath, 'commands'), `plugin:${name}`, true, enabled, version);
        const mcpPath = join(p.installPath, '.mcp.json');
        const mcp = readConfig(mcpPath);
        if (mcp) addMcp(mcp.mcpServers ?? mcp, mcpPath, `plugin:${name}`, enabled);
      }
    }
    for (const s of settings) for (const name of strings(s.disabledMcpServers)) for (const r of rows) if (r.kind === 'mcp' && r.name === name) r.enabled = false;
    const args = c.args ?? [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--plugin-dir' && args[i + 1]) scanDir(join(resolve(c.cwd, args[++i]), 'skills'), 'profile plugin', false, true);
      else if (args[i] === '--mcp-config' && args[i + 1]) {
        const value = args[++i];
        if (value.trim().startsWith('{')) {
          try { addMcp(object(JSON.parse(value)).mcpServers, 'profile arguments', 'profile'); } catch { badFile('mcp', 'profile arguments', 'profile', 'config_parse_failed'); }
        } else {
          const file = resolve(c.cwd, value);
          const cfg = readConfig(file);
          if (cfg) addMcp(cfg.mcpServers, file, 'profile');
          else if (!existsSync(file)) badFile('mcp', file, 'profile', 'path_unreadable');
        }
      }
    }
  } else {
    scanDir(join(c.home, '.agents', 'skills'), 'user');
    scanDir(join(c.stateRoot, 'skills'), 'user compatibility');
    scanDir('/etc/codex/skills', 'system');
    const configs = [{ path: join(c.stateRoot, 'config.toml'), source: 'user' }, ...layers.map((p) => ({ path: join(p, '.codex', 'config.toml'), source: 'project' }))];
    for (const p of layers) scanDir(join(p, '.agents', 'skills'), 'project');
    const overrides: Obj[] = [];
    for (const file of configs) {
      const config = readConfig(file.path);
      if (!config) continue;
      addMcp(config.mcp_servers, file.path, file.source);
      overrides.push(config);
    }
    const args = c.args ?? [];
    for (let i = 0; i < args.length; i++) if ((args[i] === '-c' || args[i] === '--config') && args[i + 1]) {
      try {
        const config = object(parseToml(args[++i]));
        addMcp(config.mcp_servers, 'profile arguments', 'profile');
        overrides.push(config);
      } catch { badFile('mcp', 'profile arguments', 'profile', 'config_parse_failed'); }
    }
    for (const config of overrides) for (const item of Array.isArray(object(config.skills).config) ? object(config.skills).config as unknown[] : []) {
      const o = object(item);
      if (typeof o.path !== 'string' || typeof o.enabled !== 'boolean') continue;
      let canonical = resolve(c.cwd, o.path);
      try { canonical = realpathSync(canonical); } catch { /* keep the logical path */ }
      for (const r of rows) if (r.kind === 'skill') {
        try { if ([realpathSync(r.path), realpathSync(dirname(r.path))].includes(canonical)) r.enabled = o.enabled; } catch { /* unavailable */ }
      }
    }
  }
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
