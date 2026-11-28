import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CodeAgentTool, RunConfigView } from '@shared/ai-agents';
import { materializeAgentPlan } from '../ai/agent-launch-files';
import { resolveProfileLaunch } from './profile-launch';
import { parse as parseToml } from 'smol-toml';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
const tool: CodeAgentTool = { id: 't', kind: 'codex', executable: 'codex', installed: true, login: 'subscription', version: '0.169.0' };
const config: RunConfigView = { id: 'c', name: 'Login', toolId: 't', kind: 'codex', source: 'login', providerId: null, models: [], defaultModel: null, homeVisible: true, isDefault: true, loggedOut: false, nameCustomized: true, order: 0, available: true, legacyReason: null };
function fixture() { const home = realpathSync(mkdtempSync(join(tmpdir(), 'm14-profile-'))); roots.push(home); const state = join(home, '.codex'); mkdirSync(state); return { home, state, input: { config, tool, cwd: home, userData: join(home, 'data'), runId: '11111111-1111-4111-a111-111111111111', baseEnv: { HOME: home, CODEX_HOME: state } } }; }
it('A07: disables each personal MCP at launch without writing user config, including quoted names; carry restores normal loading', () => {
  const f = fixture(), file = join(f.state, 'config.toml');
  const original = '[mcp_servers.normal]\ncommand="first"\n[mcp_servers."with.dot"]\ncommand="second"\n'; writeFileSync(file, original);
  const isolated = resolveProfileLaunch({ ...f.input, carryExtensions: false });
  expect(isolated.extraArgs).toContain('mcp_servers={"normal"={enabled=false},"with.dot"={enabled=false}}');
  expect(resolveProfileLaunch(f.input).extraArgs.some(a => a.includes('enabled=false'))).toBe(false);
  expect(readFileSync(file, 'utf8')).toBe(original);
  expect(isolated.compatibility.extensions).toBe(false);
});
it('A07: malformed personal configuration fails visibly instead of claiming extensions were isolated', () => {
  const f = fixture(); writeFileSync(join(f.state, 'config.toml'), '[invalid');
  expect(() => resolveProfileLaunch({ ...f.input, carryExtensions: false })).toThrow();
});
it('A07: Claude login extension opt-out excludes user settings while retaining project rules', () => {
  const f = fixture();
  const result = resolveProfileLaunch({ ...f.input, config: { ...config, kind: 'claude' }, tool: { ...tool, kind: 'claude', executable: 'claude' }, carryExtensions: false });
  expect(result.settingSources).toEqual(['project', 'local']);
  expect(result.compatibility.extensions).toBe(false);
});

it('M16 A43 standalone Codex excludes the trusted native project and all cwd ancestors on invocation only', () => {
  const f=fixture(),project=join(f.home,'registered-project'),child=join(project,'child');mkdirSync(child,{recursive:true});
  const skill=join(project,'.agents','skills','project-fixture','SKILL.md');mkdirSync(join(skill,'..'),{recursive:true});writeFileSync(skill,'---\nname: project-fixture\ndescription: Project fixture\n---\n');
  const file=join(f.state,'config.toml'),original=`[projects.${JSON.stringify(project)}]\ntrust_level="trusted"\n[mcp_servers.global_fixture]\ncommand="/usr/bin/true"\n`;writeFileSync(file,original);
  const ordinary=resolveProfileLaunch({...f.input,cwd:child});
  const standalone=resolveProfileLaunch({...f.input,cwd:child,standalone:true});
  expect(ordinary.extraArgs.some(a=>a.startsWith('projects='))).toBe(false);
  const override=standalone.extraArgs.filter(a=>a.startsWith('projects=')).at(-1);expect(override).toBeTruthy();
  const projects=(parseToml(override!) as unknown as {projects:Record<string,{trust_level:string}>}).projects;
  expect(projects[child]).toEqual({trust_level:'untrusted'});expect(projects[project]).toEqual({trust_level:'untrusted'});
  const skills=standalone.extraArgs.filter(a=>a.startsWith('skills.config=')).at(-1);expect(skills).toBeTruthy();
  expect((parseToml(skills!) as unknown as {skills:{config:{path:string;enabled:boolean}[]}}).skills.config).toContainEqual({path:skill,enabled:false});
  expect(ordinary.extraArgs.some(a=>a.startsWith('skills.config='))).toBe(false);
  expect(readFileSync(file,'utf8')).toBe(original);
  expect(standalone.stateRoot).toBe(ordinary.stateRoot);
});

it('M16 A43 standalone Claude excludes native project/local settings without altering ordinary project launch or personal extension choice',()=>{
  const f=fixture(),input={...f.input,config:{...config,kind:'claude' as const},tool:{...tool,kind:'claude' as const,executable:'claude'}};
  expect(resolveProfileLaunch(input).settingSources).toEqual(['user','project','local']);
  expect(resolveProfileLaunch({...input,standalone:true}).settingSources).toEqual(['user']);
  expect(resolveProfileLaunch({...input,standalone:true,carryExtensions:false}).settingSources).toEqual([]);
});

it('A07: managed Codex has a materialized private state root and does not inherit or modify the user root', () => {
  const f = fixture(); mkdirSync(f.input.userData); const userConfig=join(f.state,'config.toml');writeFileSync(userConfig,'[mcp_servers.personal]\ncommand="personal"\n');
  const provider={id:'p',name:'Fixture',preset:null,endpoints:{responses:'http://127.0.0.1:9/v1'},authType:'bearer' as const,hasKey:true,identityRevision:1,models:[{id:'a',name:'a',offline:false,contextWindow:null,availability:{claude:'untested' as const,codex:'untested' as const}}],recommended:{},refreshedAt:null};
  const result=resolveProfileLaunch({...f.input,config:{...config,source:'provider',providerId:'p',models:['a'],defaultModel:'a'},provider,key:'PUBLIC_FIXTURE_KEY'});
  expect(result.stateRoot).not.toBe(f.state);expect(result.env.CODEX_HOME).toBe(result.stateRoot);
  materializeAgentPlan(result.plan,f.input.userData,f.input.cwd);expect(existsSync(result.stateRoot)).toBe(true);
  expect(readFileSync(userConfig,'utf8')).toContain('personal');
});
it('A07 D06-72: managed Codex runs with a private HOME so shared personal Skill folders are not discovered, while Git and SSH configuration still apply', () => {
  const f = fixture(); mkdirSync(f.input.userData);
  writeFileSync(join(f.home, '.gitconfig'), '[user]\n\tname = Fixture\n');
  mkdirSync(join(f.home, '.ssh')); writeFileSync(join(f.home, '.ssh', 'config'), 'Host fixture\n');
  mkdirSync(join(f.home, '.agents', 'skills', 'personal'), { recursive: true });
  const provider={id:'p',name:'Fixture',preset:null,endpoints:{responses:'http://127.0.0.1:9/v1'},authType:'bearer' as const,hasKey:true,identityRevision:1,models:[{id:'a',name:'a',offline:false,contextWindow:null,availability:{claude:'untested' as const,codex:'untested' as const}}],recommended:{},refreshedAt:null};
  const managed=resolveProfileLaunch({...f.input,config:{...config,source:'provider',providerId:'p',models:['a'],defaultModel:'a'},provider,key:'PUBLIC_FIXTURE_KEY'});
  expect(managed.env.HOME).toBe(join(managed.stateRoot,'home'));
  expect(managed.env.HOME?.startsWith(f.input.userData)).toBe(true);
  materializeAgentPlan(managed.plan,f.input.userData,f.input.cwd);
  expect(existsSync(managed.env.HOME!)).toBe(true);
  expect(existsSync(join(managed.env.HOME!, '.agents'))).toBe(false);
  expect(managed.env.GIT_CONFIG_GLOBAL).toBe(join(f.home, '.gitconfig'));
  expect(managed.env.GIT_SSH_COMMAND).toBe(`ssh -F ${JSON.stringify(join(f.home, '.ssh', 'config'))}`);
  // A subscription login keeps the user's own HOME.
  const login=resolveProfileLaunch(f.input);
  expect(login.env.HOME).toBe(f.home);
  expect(login.env.GIT_CONFIG_GLOBAL).toBeUndefined();
});
