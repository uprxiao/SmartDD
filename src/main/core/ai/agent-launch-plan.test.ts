import { expect, it } from 'vitest';
import type { CodeAgentTool, ProviderView, RunConfigView } from '@shared/ai-agents';
import { planLaunchEnv } from '../../launch-env';
import { CLAUDE_MODEL_VARIABLES, planAgentLaunch } from './agent-launch-plan';
import type { AgentLaunchInput } from './agent-launch-plan';
const tool: CodeAgentTool = { id: 't', kind: 'claude', executable: '/synthetic/claude', installed: true, login: 'none', version: 'synthetic' };
const config: RunConfigView = { id: 'c', name: 'Synthetic Agent', toolId: 't', kind: 'claude', source: 'provider', providerId: 'p', models: ['a', 'b'], defaultModel: 'a', homeVisible: true, isDefault: true, loggedOut: false, nameCustomized: true, order: 0, available: true, legacyReason: null };
const provider: ProviderView = { id: 'p', name: 'Synthetic Provider', preset: null, endpoints: { anthropic: 'https://synthetic.invalid', responses: 'https://synthetic.invalid/v1' }, authType: 'bearer', hasKey: true, identityRevision: 1, models: ['a','b','unselected'].map((id) => ({ id, name: id, offline: false, contextWindow: null, availability: { claude: 'untested', codex: 'untested' } })), recommended: {}, refreshedAt: null };
const input = (changes: Partial<AgentLaunchInput> = {}): AgentLaunchInput => ({ config, tool, provider, key: 'PUBLIC_MODEL_TEST_KEY', permission: 'ask', cwd: '/synthetic/project', userData: '/synthetic/user-data', runId: '11111111-1111-4111-a111-111111111111', ...changes });

it('resolves a saved Codex provider name only to the confirmed current source and never its old authentication', () => {
  const native={config:{...config,kind:'codex' as const},tool:{...tool,kind:'codex' as const}};
  for(const codexResumeProviderId of ['willyou_original','openai']) {
    const plan=planAgentLaunch(input({...native,codexResumeProviderId}));
    const alias=plan.profile.args.find(x=>x.startsWith(`model_providers.${codexResumeProviderId}=`))!;
    expect(plan.profile.args.filter(x=>x.startsWith('model_provider='))).toEqual([`model_provider=${JSON.stringify(codexResumeProviderId)}`]);
    expect(alias).toContain(`base_url=${JSON.stringify(provider.endpoints.responses)}`);
    expect(alias).toContain('env_key="OPENAI_API_KEY",requires_openai_auth=false');
    expect(plan.profile.env.OPENAI_API_KEY).toBe('PUBLIC_MODEL_TEST_KEY');
    expect(JSON.stringify([plan.profile.args,plan.files])).not.toContain('PUBLIC_MODEL_TEST_KEY');
  }
  expect(()=>planAgentLaunch(input({...native,codexResumeProviderId:'bad.provider=1'}))).toThrow('标识无效');
});

it('uses a per-Agent Claude root, selected models only, fixed auth/tier routing, and no key in files/argv', () => {
  const p = planAgentLaunch(input());
  expect(p.claudeRoot).toMatch(/^\/synthetic\/user-data\/agents\/claude\/[a-f0-9]{32}$/);
  expect(p.profile.env).toMatchObject({ ANTHROPIC_AUTH_TOKEN: 'PUBLIC_MODEL_TEST_KEY', CLAUDE_CONFIG_DIR: p.claudeRoot, ANTHROPIC_BASE_URL: provider.endpoints.anthropic, CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1' });
  for (const name of CLAUDE_MODEL_VARIABLES) expect(p.profile.env[name]).toBe('a');
  expect(p.profile.args).toEqual(['--permission-mode','default','--setting-sources','user','--add-dir','/synthetic/project','--strict-mcp-config','--model','a']);
  expect(p.files[0].value).toEqual({ modelPicker: { options: [{ model: 'a', label: 'a' }, { model: 'b', label: 'b' }], replaceBuiltInOptions: true } });
  expect(JSON.stringify([p.files,p.profile.args])).not.toContain('PUBLIC_MODEL_TEST_KEY');
});
it('clears exact OAuth/cloud variables independently of the ANTHROPIC prefix and preserves unrelated names', () => {
  const p = planAgentLaunch(input()), env = planLaunchEnv({ ANTHROPIC_API_KEY: 'outer', CLAUDE_CODE_OAUTH_TOKEN: 'outer', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_OAUTH_TOKEN_NOTE: 'unrelated' },p.profile.env,p.profile.isolatePrefixes,p.profile.isolateNames);
  expect(env.env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN'); expect(env.env).not.toHaveProperty('CLAUDE_CODE_USE_VERTEX'); expect(env.env).not.toHaveProperty('ANTHROPIC_API_KEY');
  expect(env.env.CLAUDE_CODE_OAUTH_TOKEN_NOTE).toBe('unrelated'); expect(env.scriptArgs).toContain('-x');
});
it('keeps native-login authentication and default model untouched while supplying the chosen permission', () => {
  const p = planAgentLaunch(input({ config: { ...config, source: 'login', providerId: null }, tool: { ...tool, login: 'subscription' }, provider: undefined, key: undefined, permission: 'auto' }));
  expect(p).toMatchObject({ model: null, files: [], claudeRoot: null, profile: { env: {}, isolatePrefixes: [], isolateNames: [], args: ['--permission-mode','default'] } });
  const restored = planAgentLaunch(input({ config: { ...config, source: 'login', providerId: null }, tool: { ...tool, login: 'subscription' }, model: 'native-last-requested' }));
  expect(restored.profile.args.slice(-2)).toEqual(['--model','native-last-requested']); expect(restored.profile.env).toEqual({});
});
it('retains reliably migrated native model/reasoning options while the current permission choice remains authoritative',()=>{
  const p=planAgentLaunch(input({config:{...config,source:'login',providerId:null,kind:'codex'},tool:{...tool,kind:'codex',login:'subscription'},nativeArgs:['--no-alt-screen','-m','original','-c','model_reasoning_effort="high"','-a','never','-s','danger-full-access']}));
  expect(p.model).toBe('original');expect(p.profile.args).toEqual(['--no-alt-screen','-m','original','-c','model_reasoning_effort="high"','-s','workspace-write','-a','on-request','-c','approvals_reviewer="user"']);
  const restored=planAgentLaunch(input({config:{...config,source:'login',providerId:null},tool:{...tool,login:'api'},nativeArgs:['-m','original'],model:'last'}));
  expect(restored.profile.args.filter((value)=>value==='--model'||value==='-m')).toHaveLength(1);expect(restored.profile.args.at(-1)).toBe('last');
});
it('injects Codex provider/key/catalog per run, disables native plugins/snapshot/analytics, and preserves only selected catalog entries', () => {
  const p = planAgentLaunch(input({ config: { ...config, kind: 'codex' }, tool: { ...tool, kind: 'codex', executable: '/synthetic/codex' } }));
  expect(p.profile.env).toEqual({ OPENAI_API_KEY: 'PUBLIC_MODEL_TEST_KEY' });
  expect(p.profile.args).toEqual(expect.arrayContaining(['plugins','shell_snapshot','analytics.enabled=false','-m','a']));
  expect(JSON.stringify(p.files)).not.toContain('PUBLIC_MODEL_TEST_KEY'); expect(JSON.stringify(p.profile.args)).not.toContain('PUBLIC_MODEL_TEST_KEY');
  expect((p.files[0].value as { models: { slug: string }[] }).models.map((m) => m.slug)).toEqual(['a','b']);
});
it('uses the checked restore model for every Claude tier and rejects removed/offline models or missing keys', () => {
  const p = planAgentLaunch(input({ model: 'b' })); for (const name of CLAUDE_MODEL_VARIABLES) expect(p.profile.env[name]).toBe('b');
  expect(() => planAgentLaunch(input({ model: 'unselected' }))).toThrow('不再允许');
  expect(() => planAgentLaunch(input({ key: undefined }))).toThrow('填写 Key');
  expect(() => planAgentLaunch(input({ provider: { ...provider, models: provider.models.map((m) => ({ ...m, offline: true })) } }))).toThrow('已下线');
});
it('cannot traverse private paths through config ids or change the native type accidentally', () => {
  const p = planAgentLaunch(input({ config: { ...config, id: '../../outside' } })); expect(p.claudeRoot).not.toContain('outside');
  expect(() => planAgentLaunch(input({ tool: { ...tool, kind: 'codex' } }))).toThrow('工具已变化');
});
