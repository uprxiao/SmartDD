import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverCapabilities, type DiscoveryContext } from './discovery';

let tmp: string;
let c: DiscoveryContext;
const file = (relative: string, text: string) => { const p = join(tmp, relative); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'smartdd-scan-')); mkdirSync(join(tmp, 'repo', '.git'), { recursive: true }); c = { runner: 'codex', home: join(tmp, 'home'), stateRoot: join(tmp, 'custom'), cwd: join(tmp, 'repo'), path: '/usr/bin:/bin' }; });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));
const skill = '---\nname: same-name\ndescription: |\n  multiline description\nmetadata:\n  version: 1.2.3\n---\nInstructions\n';

describe('read-only capability discovery', () => {
  it('distinguishes default Claude state from an explicitly configured default-looking directory', () => {
    c.runner = 'claude'; c.stateRoot = join(c.home, '.claude');
    file('home/.claude.json', JSON.stringify({ mcpServers: { implicit: { command: '/usr/bin/true' } } }));
    file('home/.claude/.claude.json', JSON.stringify({ mcpServers: { explicit: { command: '/usr/bin/true' } } }));
    expect(discoverCapabilities({ ...c, claudeConfigExplicit: false }).filter((s) => s.kind === 'mcp').map((s) => s.name)).toEqual(['implicit']);
    expect(discoverCapabilities({ ...c, claudeConfigExplicit: true }).filter((s) => s.kind === 'mcp').map((s) => s.name)).toEqual(['explicit']);
  });
  it('keeps same-named sources, follows symlinks without loops, and stops below a skill', () => {
    file('home/.agents/skills/one/SKILL.md', skill);
    file('repo/.agents/skills/two/SKILL.md', skill);
    file('repo/.agents/skills/two/validation/fake/SKILL.md', skill);
    symlinkSync(join(tmp, 'home/.agents/skills/one'), join(tmp, 'home/.agents/skills/alias'));
    symlinkSync(join(tmp, 'home/.agents/skills'), join(tmp, 'home/.agents/skills/loop'));
    const rows = discoverCapabilities(c).filter((s) => s.name === 'same-name');
    expect(rows).toHaveLength(2); expect(rows.every((s) => s.version === '1.2.3' && s.loaded === 'unverified')).toBe(true);
    expect(rows.map((s) => s.source).sort()).toEqual(['project', 'user']);
  });

  it('shows invalid TOML/JSON without returning the parser’s credential-containing excerpt', () => {
    file('custom/config.toml', '[mcp_servers.broken]\ncommand = "hidden-secret\n');
    const rows = discoverCapabilities(c);
    expect(rows.some((s) => s.validity === 'invalid' && s.issues.includes('config_parse_failed'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('hidden-secret');
    c.runner = 'claude'; file('custom/.claude.json', '{"mcpServers":"hidden-json-secret');
    const cc = discoverCapabilities(c);
    expect(cc.some((s) => s.validity === 'invalid')).toBe(true); expect(JSON.stringify(cc)).not.toContain('hidden-json-secret');
  });

  it('supports Codex HTTP and emits only variable names, never URL/args/env/header values', () => {
    file('custom/config.toml', '[mcp_servers.remote]\nurl="https://server.invalid/?token=url-secret"\nbearer_token_env_var="REMOTE_TOKEN"\nhttp_headers={Authorization="header-secret"}\n[mcp_servers.local]\ncommand="npx"\nargs=["--token","argv-secret"]\nenv={API_KEY="env-secret"}\n');
    const rows = discoverCapabilities(c);
    expect(rows.find((s) => s.name === 'remote')).toMatchObject({ validity: 'partial', envNames: ['REMOTE_TOKEN'], loaded: 'unverified' });
    expect(rows.find((s) => s.name === 'local')?.envNames).toContain('API_KEY');
    for (const secret of ['url-secret', 'header-secret', 'argv-secret', 'env-secret']) expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it('reports structurally invalid configuration instead of treating it as empty', () => {
    c.runner = 'claude';
    for (const content of ['null', '[]', '"shape-secret"', '{"mcpServers":["shape-secret"]}', '{"mcpServers":null}']) {
      file('custom/.claude.json', content);
      const rows = discoverCapabilities(c);
      expect(rows.some((s) => s.validity === 'invalid' && s.issues.includes('config_shape_invalid'))).toBe(true);
      expect(JSON.stringify(rows)).not.toContain('shape-secret');
    }
    c.runner = 'codex';
    file('custom/config.toml', 'mcp_servers="shape-secret"\n');
    const rows = discoverCapabilities(c);
    expect(rows.some((s) => s.validity === 'invalid' && s.issues.includes('config_shape_invalid'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('shape-secret');
  });

  it('uses the profile state root and applies per-path Codex disables', () => {
    const path = file('custom/skills/one/SKILL.md', skill);
    file('custom/config.toml', `skills.config=[{path=${JSON.stringify(path)},enabled=false}]\n`);
    const rows = discoverCapabilities(c);
    expect(rows.find((s) => s.path === path)?.enabled).toBe(false);
    c.args = ['-c', `skills.config=[{path=${JSON.stringify(path)},enabled=true}]`];
    expect(discoverCapabilities(c).find((s) => s.path === path)?.enabled).toBe(true);
  });

  it('honors Claude’s installed plugin manifest instead of scanning unrelated plugin cache', () => {
    c.runner = 'claude';
    file('custom/plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'chosen@local': [{ installPath: join(tmp, 'plugin'), version: '3.0.0', scope: 'user' }] } }));
    file('custom/settings.json', JSON.stringify({ enabledPlugins: { 'chosen@local': false } }));
    file('plugin/skills/one/SKILL.md', skill);
    file('custom/plugins/cache/unused/skills/one/SKILL.md', skill);
    const rows = discoverCapabilities(c).filter((s) => s.kind === 'skill');
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ source: 'plugin:chosen@local', enabled: false, loaded: 'unverified' });
  });

  it('includes Claude local-project MCP and detects wrong env/argument types', () => {
    c.runner = 'claude';
    file('custom/.claude.json', JSON.stringify({ projects: { [c.cwd]: { mcpServers: { local: { command: 'echo', args: 'invalid', env: { TOKEN: 123 } } } } } }));
    const entry = discoverCapabilities(c).find((s) => s.name === 'local');
    expect(entry).toMatchObject({ source: 'project local', validity: 'invalid' });
    expect(entry?.issues).toEqual(expect.arrayContaining(['mcp_args_invalid', 'mcp_env_invalid']));
  });
});

describe('host-only native launch details',()=>{
  it('preserves the final whole Skill configuration array, including fields unrelated to managed Skills',()=>{
    file('custom/config.toml','[skills]\nconfig=[{path="/old-user",enabled=true}]\n');
    file('repo/.codex/config.toml','[skills]\nconfig=[{path="/project-user",enabled=false,custom="unchanged"}]\n');
    const details={userSkillConfig:[],plugins:[],issues:[]};discoverCapabilities({...c,details});expect(details.userSkillConfig).toEqual([{path:'/project-user',enabled:false,custom:'unchanged'}]);
    const cli={userSkillConfig:[],plugins:[],issues:[]};discoverCapabilities({...c,args:['-c','skills.config=[{path="/profile-user",enabled=true,tag="keep"}]'],details:cli});expect(cli.userSkillConfig).toEqual([{path:'/profile-user',enabled:true,tag:'keep'}]);expect(cli.issues).toEqual([]);
  });
  it('reads the actual plugin namespace independently of its marketplace key and reports unsupported profile precedence',()=>{
    c.runner='claude';file('custom/plugins/installed_plugins.json',JSON.stringify({plugins:{'different-market-key':[{installPath:join(tmp,'plugin')}]}}));file('plugin/.claude-plugin/plugin.json',JSON.stringify({name:'actual-namespace'}));
    const details={userSkillConfig:[],plugins:[],issues:[]};discoverCapabilities({...c,details});expect(details.plugins).toEqual([{name:'actual-namespace',path:join(tmp,'plugin')}]);
    c.runner='codex';const unsupported={userSkillConfig:[],plugins:[],issues:[]};discoverCapabilities({...c,args:['--profile=private'],details:unsupported});expect(unsupported.issues).toContain('profile_configuration_unverified');
  });
  it('does not expose raw host-only configuration through the renderer discovery rows',()=>{
    file('custom/config.toml','[skills]\nconfig=[{path="/user",enabled=false,private_field="host-only-marker"}]\n[mcp_servers.existing]\ncommand="/usr/bin/true"\n');const details={userSkillConfig:[],plugins:[],issues:[]},rows=discoverCapabilities({...c,details});expect(JSON.stringify(details)).toContain('host-only-marker');expect(JSON.stringify(rows)).not.toContain('host-only-marker');
  });
});
