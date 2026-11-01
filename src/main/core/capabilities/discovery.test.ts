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


describe('Codex effective configuration precedence',()=>{
  const details=()=>({userSkillConfig:[] as Record<string,unknown>[],effectiveSkillConfig:[] as Record<string,unknown>[],plugins:[] as {name:string;path:string}[],issues:[] as string[]});
  it('keeps native lower-layer path state when the final raw Skill array is empty',()=>{
    const path=file('custom/skills/original/SKILL.md',skill);
    file('custom/config.toml',`skills.config=[{path=${JSON.stringify(path)},enabled=false}]\n`);
    const detail=details(),rows=discoverCapabilities({...c,args:['-c','skills.config=[]'],details:detail});
    expect(detail.userSkillConfig).toEqual([]);expect(detail.effectiveSkillConfig).toEqual([{path,enabled:false}]);expect(rows.find(r=>r.path===path)?.enabled).toBe(false);expect(detail.issues).toEqual([]);
  });
  it('retains native per-path defaults absent from the later raw configuration array',()=>{
    const original=file('custom/skills/original/SKILL.md',skill),other=file('custom/skills/other/SKILL.md',skill);
    file('custom/config.toml',`skills.config=[{path=${JSON.stringify(original)},enabled=false}]\n`);
    const detail=details(),rows=discoverCapabilities({...c,args:['-c',`skills.config=[{path=${JSON.stringify(other)},enabled=true,custom="keep"}]`],details:detail});
    expect(rows.find(r=>r.path===original)?.enabled).toBe(false);expect(detail.effectiveSkillConfig).toContainEqual({path:original,enabled:false});expect(rows.find(r=>r.path===other)?.enabled).toBe(true);
    expect(detail.userSkillConfig).toEqual([{path:other,enabled:true,custom:'keep'}]);
  });
  it.each(['--config=','-c'])('accepts the valid inline CLI configuration form %s without changing source files',(prefix)=>{
    const path=file('custom/skills/original/SKILL.md',skill),detail=details();
    file('custom/config.toml',`skills.config=[{path=${JSON.stringify(path)},enabled=false}]\n`);
    const rows=discoverCapabilities({...c,args:[prefix+`skills.config=[{path=${JSON.stringify(path)},enabled=true}]`],details:detail});
    expect(detail.issues).toEqual([]);expect(detail.userSkillConfig).toEqual([{path,enabled:true}]);expect(rows.find(r=>r.path===path)?.enabled).toBe(true);
  });
  it('resolves a user-file relative Skill path from that file rather than the launch cwd',()=>{
    const path=file('home/.agents/skills/relative/SKILL.md',skill),detail=details();file('custom/config.toml','skills.config=[{path="../home/.agents/skills/relative/SKILL.md",enabled=false,custom="origin-preserved"}]\n');
    const rows=discoverCapabilities({...c,details:detail});expect(detail.userSkillConfig[0].path).toBe('../home/.agents/skills/relative/SKILL.md');expect(detail.effectiveSkillConfig).toEqual([{path,enabled:false,custom:'origin-preserved'}]);expect(rows.find(r=>r.path===path)?.enabled).toBe(false);
  });
  it('resolves CLI relative Skill paths from cwd while preserving a different lower-layer native path',()=>{
    const path=file('home/.agents/skills/relative/SKILL.md',skill),detail=details();file('custom/config.toml',`skills.config=[{path=${JSON.stringify(path)},enabled=false}]\n`);
    discoverCapabilities({...c,args:['-c','skills.config=[{path="../not-the-home-skill/SKILL.md",enabled=true}]'],details:detail});
    expect(detail.effectiveSkillConfig).toEqual([{path,enabled:false},{path:join(tmp,'not-the-home-skill/SKILL.md'),enabled:true}]);
  });
  it('uses canonical identity to match a Skill but preserves a user symlink alias in forwarded argv',()=>{
    const target=file('home/.agents/skills/alias-target/SKILL.md',skill),detail=details();file('custom/config.toml','skills.config=[{path="user-link/SKILL.md",enabled=false}]\n');
    symlinkSync(dirname(target),join(tmp,'custom/user-link'));const rows=discoverCapabilities({...c,details:detail});
    expect(detail.effectiveSkillConfig).toEqual([{path:join(tmp,'custom/user-link/SKILL.md'),enabled:false}]);expect(rows.find(r=>r.path===target)?.enabled).toBe(false);
  });
  it('uses the native literal-string fallback for a CLI value that is not TOML',()=>{
    const detail=details(),rows=discoverCapabilities({...c,args:['-c','mcp_servers.native.command=/usr/bin/true'],details:detail});
    expect(detail.issues).toEqual([]);expect(rows.find(r=>r.name==='native')).toMatchObject({kind:'mcp',validity:'partial'});
  });
  it.each(['-c','--config'])('marks a missing %s value as unverified instead of an empty override',(flag)=>{
    const detail=details();discoverCapabilities({...c,args:[flag],details:detail});expect(detail.issues).toContain('profile_configuration_unverified');
  });
  it('never interprets prompt arguments after the native end-of-options marker as config',()=>{
    const path=file('custom/skills/original/SKILL.md',skill),detail=details();file('custom/config.toml',`skills.config=[{path=${JSON.stringify(path)},enabled=false}]\n`);
    const rows=discoverCapabilities({...c,args:['--','-c',`skills.config=[{path=${JSON.stringify(path)},enabled=true}]`],details:detail});
    expect(detail.userSkillConfig).toEqual([{path,enabled:false}]);expect(rows.find(r=>r.path===path)?.enabled).toBe(false);expect(detail.issues).toContain('profile_configuration_unverified');
  });
  it.each(['0.162.1','0.166.0'].flatMap(nativeVersion=>[['--profile','read-only'],['--profile=read-only'],['-p','read-only']].map(args=>({nativeVersion,args}))))('reads the selected independent profile file only for verified CLI $nativeVersion ($args)',({nativeVersion,args})=>{
    const detail=details();file('custom/config.toml','skills.config=[{path="/base-user",enabled=false}]\n');
    file('custom/read-only.config.toml','skills.config=[{path="/profile-user",enabled=true,custom="host-only-profile-marker"}]\n[mcp_servers.profile_server]\ncommand="/usr/bin/true"\nenv={TOKEN="never-render-profile-secret"}\n');
    const rows=discoverCapabilities({...c,nativeVersion,args,details:detail});
    expect(detail.issues).toEqual([]);expect(detail.userSkillConfig).toEqual([{path:'/profile-user',enabled:true,custom:'host-only-profile-marker'}]);
    expect(rows.find(r=>r.name==='profile_server')).toMatchObject({source:'profile',envNames:['TOKEN']});expect(JSON.stringify(rows)).not.toContain('never-render-profile-secret');expect(JSON.stringify(rows)).not.toContain('host-only-profile-marker');
  });
  it('applies profile below the project layer and repeated CLI overrides above both',()=>{
    file('custom/config.toml',`skills.config=[{path="/base-user",enabled=false}]\n[projects.${JSON.stringify(c.cwd)}]\ntrust_level="trusted"\n`);
    file('custom/review.config.toml','skills.config=[{path="/profile-user",enabled=false}]\n');file('repo/.codex/config.toml','skills.config=[{path="/project-user",enabled=false}]\n');
    const project=details();discoverCapabilities({...c,nativeVersion:'0.162.1',args:['--profile','review'],details:project});expect(project.issues).toEqual([]);expect(project.userSkillConfig).toEqual([{path:'/project-user',enabled:false}]);
    const cli=details();discoverCapabilities({...c,nativeVersion:'0.162.1',args:['--profile','review','-c','skills.config=[{path="/cli-first",enabled=false}]','--config','skills.config=[{path="/cli-final",enabled=true,keep=7}]'],details:cli});
    expect(cli.issues).toEqual([]);expect(cli.userSkillConfig).toEqual([{path:'/cli-final',enabled:true,keep:7}]);
  });
  it.each([undefined,'0.133.0','0.999.0'])('does not assume independent-profile semantics for an unverified CLI %s',(nativeVersion)=>{
    file('custom/review.config.toml','skills.config=[{path="/must-not-adopt",enabled=true}]\n');const detail=details();discoverCapabilities({...c,nativeVersion,args:['--profile','review'],details:detail});
    expect(detail.issues).toContain('profile_configuration_unverified');expect(detail.userSkillConfig).toEqual([]);
  });
  it.each(['../outside','missing'])('keeps invalid or missing named profiles unverified (%s)',(name)=>{
    file('outside.config.toml','skills.config=[{path="/outside-marker",enabled=true}]\n');const detail=details();discoverCapabilities({...c,nativeVersion:'0.162.1',args:['--profile',name],details:detail});
    expect(detail.issues).toContain('profile_configuration_unverified');expect(detail.userSkillConfig).toEqual([]);
  });
});

describe('host-only exact Skill configuration source diagnostics',()=>{
 it('keeps lower-layer source locations when a later raw array omits that path',()=>{
  const a=join(tmp,'first/SKILL.md'),b=join(tmp,'second/SKILL.md'),user=file('custom/config.toml','[skills]\nconfig=[{path="'+a+'",enabled=false,custom="MUST_NOT_PERSIST_TOKEN"}]\n'),project=file('repo/.codex/config.toml','[skills]\nconfig=[{path="'+b+'",enabled=true}]\n'),details={userSkillConfig:[],plugins:[],issues:[]} as NonNullable<DiscoveryContext['details']>;discoverCapabilities({...c,nativeVersion:'0.162.1',details});expect(details.effectiveSkillConfig).toEqual([{path:a,enabled:false,custom:'MUST_NOT_PERSIST_TOKEN'},{path:b,enabled:true}]);expect(details.skillConfigSources).toEqual([{path:a,configurationPath:user,location:'file'},{path:b,configurationPath:project,location:'file'}]);expect(JSON.stringify(details.skillConfigSources)).not.toContain('MUST_NOT_PERSIST_TOKEN');
 });
 it.each(['file','profile-arguments'] as const)('retains only the winning %s location without changing effective native flags or exposing values',location=>{
  const path=join(tmp,'native-target','SKILL.md'),source=file('custom/config.toml','[skills]\nconfig=[{path="'+path+'",enabled=false}]\n[mcp_servers.private]\ncommand="/usr/bin/false"\nargs=["MUST_NOT_PERSIST_ARG"]\nenv={TOKEN="MUST_NOT_PERSIST_TOKEN"}\n'),details={userSkillConfig:[],plugins:[],issues:[]} as NonNullable<DiscoveryContext['details']>;
  discoverCapabilities({...c,nativeVersion:'0.162.1',details,...(location==='profile-arguments'?{args:['-c','skills.config=[{path="'+path+'",enabled=false}]']}: {})});expect(details.effectiveSkillConfig).toEqual([{path,enabled:false}]);expect(details.skillConfigSources).toEqual([{path,configurationPath:location==='file'?source:null,location}]);expect(JSON.stringify(details.skillConfigSources)).not.toMatch(/MUST_NOT_PERSIST/);
 });
});
