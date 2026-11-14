// Read-only discovery, drawing on Yoda's realpath/source scanning (Apache-2.0).
// Parse errors stay visible. No MCP command, auth helper or model is executed here.
import { accessSync, constants, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import type { DiscoveredCapability } from '@shared/capabilities';
import type { Runner } from '@shared/types';
import type { McpNativePolicy } from './mcp-source';
import { discoverCodexPlugins } from './codex-plugin-discovery';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const object = (v: unknown): Obj => isObject(v) ? v : {};
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
const LIMIT = 1024 * 1024;

export interface NativeDiscoveryDetails {
  userSkillConfig: Obj[];
  plugins: { name: string; path: string }[];
  issues: string[];
  /** Native per-path flags include lower-layer paths absent from the final raw array. Host only. */
  effectiveSkillConfig?: Obj[];
  skillConfigSources?: {path:string;configurationPath:string|null;location:'file'|'profile-arguments'}[];
}

export interface DiscoveryContext {
  runner: Runner;
  cwd: string;
  home: string;
  stateRoot: string;
  /** Explicit CLAUDE_CONFIG_DIR changes the location of .claude.json even at ~/.claude. */
  claudeConfigExplicit?: boolean;
  path: string;
  args?: string[];
  /** Main-process only: raw Skill flags never enter the renderer discovery result. */
  details?: NativeDiscoveryDetails;
  /** Exact version from the host-only --version probe; absent in generic UI discovery. */
  nativeVersion?: string;
  /** Main-only callback. Raw MCP definitions must never enter discovery rows,
   * persistent diagnostics, capability snapshots or renderer responses. */
  onMcpDefinition?:(row:DiscoveredCapability,definition:Record<string,unknown>,policy?:McpNativePolicy)=>void;
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

/** Parse only configuration arguments. Never evaluate a shell or expose parser excerpts. */
export function codexConfigurationArgs(args: string[], issue: () => void): { profile: string | null; overrides: Obj[] } {
  let profile: string | null = null, profileSeen = false;
  const overrides: Obj[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    // Managed argv is appended by the host. It cannot safely follow a user's --.
    if (arg === '--') { issue(); break; }
    let selected: string | undefined, assignment: string | undefined;
    if (arg === '--profile' || arg === '-p') selected = args[++i] ?? '';
    else if (arg.startsWith('--profile=')) selected = arg.slice('--profile='.length);
    else if (/^-p.+/.test(arg)) { issue(); continue; }
    else if (arg === '--config' || arg === '-c') assignment = args[++i] ?? '';
    else if (arg.startsWith('--config=')) assignment = arg.slice('--config='.length);
    else if (arg.startsWith('-c') && arg.length > 2) assignment = arg.slice(2).replace(/^=/, '');
    if (selected !== undefined) {
      if (profileSeen || !/^[A-Za-z0-9_-]+$/.test(selected)) { issue(); profile = null; }
      else profile = selected;
      profileSeen = true;
    }
    if (assignment !== undefined) {
      const equal = assignment.indexOf('=');
      if (equal <= 0) { issue(); continue; }
      const key = assignment.slice(0, equal), value = assignment.slice(equal + 1);
      try {
        // Codex treats non-TOML values as literal strings. Parsing a value wrapper
        // also prevents a multiline value from becoming extra configuration keys.
        let validToml = false;
        try { const parsed = parseToml('__value__=' + value); validToml = Object.keys(parsed).length === 1 && Object.hasOwn(parsed, '__value__'); } catch { /* native string fallback */ }
        const parsed = parseToml(key + '=' + (validToml ? value : JSON.stringify(value)));
        overrides.push(object(parsed));
      } catch { issue(); }
    }
  }
  return { profile, overrides };
}

/** Recognize native option boundaries before choosing configuration sources.
 * Unknown/positional arguments cannot establish a narrower trusted source set. */
function claudeDiscoveryArgs(args:string[]){
  const controls=new Set<number>(),sources:number[]=[];
  const values=new Set(['--model','-m','--permission-mode','--session-id','--resume','-r','--input-format','--output-format','--max-turns','--max-budget-usd','--system-prompt','--append-system-prompt','--settings','--mcp-config','--plugin-dir']);
  const many=new Set(['--add-dir','--allowedTools','--allowed-tools','--disallowedTools','--disallowed-tools','--tools','--betas']);
  const switches=new Set(['--strict-mcp-config','--dangerously-skip-permissions','--allow-dangerously-skip-permissions','--verbose','--debug','--continue','-c','--print','-p','--no-session-persistence','--disable-slash-commands']);
  let userOnly=false,strictMcp=false,ambiguous=false;
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='--')break;
    if(!arg.startsWith('-')){ambiguous=true;break;}
    controls.add(i);
    if(arg==='--setting-sources'||arg.startsWith('--setting-sources=')){
      sources.push(i);const value=arg==='--setting-sources'?args[++i]:arg.slice('--setting-sources='.length);
      userOnly=value==='user';continue;
    }
    if(arg==='--strict-mcp-config'){strictMcp=true;continue;}
    if(values.has(arg)){if(++i>=args.length)ambiguous=true;continue;}
    if(many.has(arg)){while(args[i+1]&&!args[i+1].startsWith('-'))i++;continue;}
    if(switches.has(arg)||arg.includes('='))continue;
    // A new option could consume the next token. Do not use it to approve a
    // settings override or infer that a following token is a control flag.
    ambiguous=true;if(args[i+1]&&!args[i+1].startsWith('-'))i++;
  }
  const accepted=userOnly&&sources.length===1&&!ambiguous;
  return {controls,acceptedSources:accepted?new Set(sources):new Set<number>(),userOnly:accepted,strictMcp:strictMcp&&!ambiguous};
}

export function discoverCapabilities(c: DiscoveryContext): DiscoveredCapability[] {
  const rows: DiscoveredCapability[] = [];
  const mcpDefinitions=new Map<DiscoveredCapability,Obj>();
  const mcpPolicy:McpNativePolicy={allow:[],deny:[],ask:[],unverified:false};
  const seen = new Set<string>();
  const layers = projectLayers(c.cwd, c.home);
  const row = (kind: 'skill' | 'mcp', name: string, path: string, source: string): DiscoveredCapability => ({
    id: `${c.runner}:${kind}:${path}:${name}`, kind, name: name.slice(0, 120), runner: c.runner, path, source,
    version: null, enabled: null, validity: 'partial', issues: [], loaded: 'unverified', envNames: [],
  });
  const badFile = (kind: 'skill' | 'mcp', path: string, source: string, issue: string) => {
    const r = row(kind, kind === 'mcp' ? 'MCP config' : 'Skill', path, source);
    r.validity = 'invalid'; r.issues = [issue]; rows.push(r);
    c.details?.issues.push(issue);
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
  const plugin = (root: string) => {
    const manifest = readConfig(join(root, '.claude-plugin', 'plugin.json'));
    if (typeof manifest?.name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.name)) { c.details?.issues.push('plugin_namespace_unverified'); return; }
    c.details?.plugins.push({ name: manifest.name, path: root });
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
      mcpDefinitions.set(r,s);
    }
  };

  if (c.runner === 'claude') {
    const args=c.args??[], options=claudeDiscoveryArgs(args);
    scanDir(join(c.stateRoot, 'skills'), 'user');
    scanDir(join(c.stateRoot, 'commands'), 'user commands', true);
    const settings: Obj[] = [];
    const globalSettings = readConfig(join(c.stateRoot, 'settings.json'));
    if (globalSettings) settings.push(globalSettings);
    else if(existsSync(join(c.stateRoot,'settings.json')))mcpPolicy.unverified=true;
    for (const p of layers) {
      scanDir(join(p, '.claude', 'skills'), 'project');
      scanDir(join(p, '.claude', 'commands'), 'project commands', true);
      for (const file of options.userOnly?[]:['settings.json', 'settings.local.json']) {
        const config = readConfig(join(p, '.claude', file));
        if (config) settings.push(config);
        else if(existsSync(join(p,'.claude',file)))mcpPolicy.unverified=true;
      }
      const file = join(p, '.mcp.json');
      const config = options.strictMcp?null:readConfig(file);
      if (config) addMcp(config.mcpServers, file, 'project');
    }
    const explicitRoot = c.claudeConfigExplicit ?? c.stateRoot !== join(c.home, '.claude');
    const mainConfigPath = explicitRoot ? join(c.stateRoot, '.claude.json') : join(c.home, '.claude.json');
    const config = options.strictMcp?null:readConfig(mainConfigPath);
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
        plugin(p.installPath);
        const enabled = typeof enabledPlugins[name] === 'boolean' ? enabledPlugins[name] as boolean : null;
        const version = typeof p.version === 'string' ? p.version : null;
        scanDir(join(p.installPath, 'skills'), `plugin:${name}`, false, enabled, version);
        scanDir(join(p.installPath, 'commands'), `plugin:${name}`, true, enabled, version);
        const mcpPath = join(p.installPath, '.mcp.json');
        const mcp = options.strictMcp?null:readConfig(mcpPath);
        if (mcp) addMcp(mcp.mcpServers ?? mcp, mcpPath, `plugin:${name}`, enabled);
      }
    }
    for(const s of settings){
      const permissions=object(s.permissions);
      for(const key of ['allow','deny','ask'] as const){
        if(permissions[key]!==undefined&&(!Array.isArray(permissions[key])||(permissions[key] as unknown[]).some(v=>typeof v!=='string')))mcpPolicy.unverified=true;
        mcpPolicy[key].push(...strings(permissions[key]));
      }
    }
    for (let i = 0; i < args.length; i++) {
      if(!options.controls.has(i))continue;
      if(options.acceptedSources.has(i)){if(args[i]==='--setting-sources')i++;continue;}
      const policyFlag={'--allowedTools':'allow','--allowed-tools':'allow','--disallowedTools':'deny','--disallowed-tools':'deny'}[args[i]] as 'allow'|'deny'|undefined;
      if(policyFlag){while(args[i+1]&&!args[i+1].startsWith('-'))mcpPolicy[policyFlag].push(...args[++i].split(',').filter(Boolean));continue;}
      if(/^--(?:settings|setting-sources|settings-sources)(?:=|$)/.test(args[i]))mcpPolicy.unverified=true;
      if (args[i] === '--plugin-dir' && args[i + 1]) { const root = resolve(c.cwd, args[++i]); plugin(root); scanDir(join(root, 'skills'), 'profile plugin', false, true); }
      else if (/^--(?:settings|setting-sources|settings-sources|plugin-dir|mcp-config)=|^--(?:settings|setting-sources|settings-sources)$/.test(args[i])) c.details?.issues.push('profile_configuration_unverified');
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
    for (const s of settings) for (const name of strings(s.disabledMcpServers)) for (const r of rows) if (r.kind === 'mcp' && r.name === name) r.enabled = false;
  } else {
    scanDir(join(c.home, '.agents', 'skills'), 'user');
    scanDir(join(c.stateRoot, 'skills'), 'user compatibility');
    scanDir('/etc/codex/skills', 'system');
    const args = codexConfigurationArgs(c.args ?? [], () => c.details?.issues.push('profile_configuration_unverified'));
    const configs = [{ path: join(c.stateRoot, 'config.toml'), source: 'user' }];
    if (args.profile !== null) {
      // Keep named-profile interpretation limited to the verified baselines.
      // Since 0.134,
      // profiles are independent files, not legacy [profiles.*] tables.
      if (!['0.162.1','0.166.0'].includes(c.nativeVersion ?? '')) c.details?.issues.push('profile_configuration_unverified');
      else {
        const path = join(c.stateRoot, args.profile + '.config.toml');
        if (!existsSync(path)) c.details?.issues.push('profile_configuration_unverified');
        else configs.push({ path, source: 'profile' });
      }
    }
    configs.push(...layers.map(p => ({ path: join(p, '.codex', 'config.toml'), source: 'project' })));
    for (const p of layers) scanDir(join(p, '.agents', 'skills'), 'project');
    const overrides: { config: Obj; base: string;configurationPath:string|null;location:'file'|'profile-arguments' }[] = [];
    for (const file of configs) {
      const config = readConfig(file.path);
      if (!config) continue;
      if (config.profile !== undefined) c.details?.issues.push('profile_configuration_unverified');
      addMcp(config.mcp_servers, file.path, file.source);
      overrides.push({ config, base: dirname(file.path),configurationPath:file.path,location:'file' });
    }
    for (const config of args.overrides) {
      addMcp(config.mcp_servers, 'profile arguments', 'profile');
      overrides.push({ config, base: c.cwd,configurationPath:null,location:'profile-arguments' });
    }
    for (const plugin of discoverCodexPlugins(c.stateRoot, overrides.map(o => o.config), readConfig,
      (path, source, reason) => badFile('mcp', path, source, reason))) {
      const source = `plugin:${plugin.key}`;
      for (const skill of plugin.skills) scanSkill(skill, source, false, plugin.enabled, plugin.version);
      const first = rows.length;
      addMcp(plugin.servers, plugin.mcpPath, source, plugin.enabled);
      for (const entry of rows.slice(first)) {
        entry.version = plugin.version;
        if (plugin.enabled === false) entry.enabled = false;
        else if (plugin.enabled === null && entry.enabled !== false) entry.enabled = null;
      }
    }
    // The raw config field is the last whole array. Codex 0.162.1 Skill discovery
    // separately keeps lower-layer paths missing from that array; a later explicit
    // entry for the same path wins. config/read alone does not prove loaded state.
    let finalFlags: Obj[] = [];
    const effective = new Map<string, Obj>(),sources=new Map<string,{path:string;configurationPath:string|null;location:'file'|'profile-arguments'}>();
    for (const { config, base,configurationPath,location } of overrides) {
      if (config.skills !== undefined && !isObject(config.skills)) c.details?.issues.push('skill_configuration_unverified');
      const flags = object(config.skills).config;
      if (flags !== undefined) {
        if (!Array.isArray(flags) || flags.some(v => !isObject(v) || typeof v.path !== 'string' || typeof v.enabled !== 'boolean')) c.details?.issues.push('skill_configuration_unverified');
        else {
          finalFlags = structuredClone(flags) as Obj[];
          for (const raw of finalFlags) {
            // File/profile-relative paths use their config directory. A CLI
            // assignment is based on the native cwd. Forward only absolute paths
            // so projecting this state into a later CLI array preserves its meaning.
            const absolute = resolve(base, raw.path as string);
            let path = absolute;
            try {
              path = realpathSync(path);
              if (statSync(path).isDirectory() && existsSync(join(path, 'SKILL.md'))) path = realpathSync(join(path, 'SKILL.md'));
            } catch { /* retain the resolved future path; do not invent existence */ }
            // Canonicalize identity for comparison, preserving the user alias in argv.
            effective.set(path, { ...raw, path: absolute });
            sources.set(path,{path:absolute,configurationPath,location});
          }
        }
      }
    }
    if (c.details) {
      c.details.userSkillConfig = finalFlags;
      c.details.effectiveSkillConfig = [...effective.values()];
      c.details.skillConfigSources=[...sources.values()];
    }
    for (const [canonical, o] of effective) {
      for (const r of rows) if (r.kind === 'skill') {
        try { if ([realpathSync(r.path), realpathSync(dirname(r.path))].includes(canonical)) r.enabled = o.enabled as boolean; } catch { /* unavailable */ }
      }
    }
  }
  // Final flags/permissions must be available before a launch resolver consumes
  // a definition; otherwise a just-disabled source could be injected once more.
  for(const[row,definition]of mcpDefinitions)c.onMcpDefinition?.(row,definition,c.runner==='claude'?mcpPolicy:undefined);
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
