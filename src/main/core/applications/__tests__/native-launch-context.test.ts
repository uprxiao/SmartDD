import {mkdtempSync,mkdirSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {inspectNativeLaunch,type TaskLaunchInput} from '../native-launch-context';
import {planAgentLaunch} from '../../ai/agent-launch-plan';
import { nativeExecutableIdentity } from '../../ai/runner-detect';
import type {CodeAgentTool,ProviderView,RunConfigView} from '@shared/ai-agents';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('inspects the actual generated third-party Claude profile without falling back to native-only delivery',async()=>{
  const root=mkdtempSync(join(tmpdir(),'willyou-claude-inspect-'));roots.push(root);
  const cwd=join(root,'project'),home=join(root,'home'),userData=join(root,'userdata'),command=join(root,'claude');
  mkdirSync(join(cwd,'.git'),{recursive:true});mkdirSync(home);mkdirSync(userData);
  writeFileSync(command,'#!/bin/sh\n[ "$1" = "--version" ] || exit 99\nprintf "2.1.322 (Claude Code)\\n"\n',{mode:0o700});
  const tool:CodeAgentTool={id:'tool',kind:'claude',executable:command,installed:true,login:'none',version:'2.1.322'};
  const config:RunConfigView={id:'config',name:'Claude test',toolId:tool.id,kind:'claude',source:'provider',providerId:'provider',models:['test'],defaultModel:'test',homeVisible:true,isDefault:true,loggedOut:false,nameCustomized:false,order:0,available:true,legacyReason:null};
  const provider:ProviderView={id:'provider',name:'Local synthetic',preset:null,endpoints:{anthropic:'http://127.0.0.1:1'},authType:'api-key',hasKey:true,identityRevision:1,models:[{id:'test',name:'Test',offline:false,contextWindow:null,availability:{claude:'available',codex:'unavailable'}}],recommended:{},refreshedAt:null};
  const planned=planAgentLaunch({config,tool,provider,key:'PUBLIC_ONLY',permission:'ask',cwd,userData,runId:'11111111-1111-4111-a111-111111111111'});
  const stateRoot=planned.claudeRoot!;mkdirSync(stateRoot,{recursive:true});
  for(const f of planned.files)writeFileSync(f.path,JSON.stringify(f.value));
  mkdirSync(join(cwd,'.claude'),{recursive:true});writeFileSync(join(cwd,'.claude','settings.json'),'{broken ignored project settings');
  writeFileSync(join(stateRoot,'.claude.json'),JSON.stringify({mcpServers:{unselected:{command:'/does/not/exist'}}}));
  const skill=join(stateRoot,'skills','standard');mkdirSync(skill,{recursive:true});writeFileSync(join(skill,'SKILL.md'),'---\nname: standard\ndescription: local test\n---\nUse the local test.\n');
  const input:TaskLaunchInput={projectId:'project',taskId:'task',profile:planned.profile,cwd,home,stateRoot,claudeConfigExplicit:true,mode:'new',sessionId:null,previous:null,newTask:true,signal:new AbortController().signal,environment:{...planned.profile.env,PATH:'/usr/bin:/bin',HOME:home,ZDOTDIR:home}};
  const result=await inspectNativeLaunch(input);
  expect(result.version).toBe('2.1.322');expect(result.command).toBe(command);
  expect(result.inventory.some(row=>row.kind==='skill'&&row.path===join(skill,'SKILL.md'))).toBe(true);
  expect(result.inventory.some(row=>row.kind==='mcp')).toBe(false);
  await expect(inspectNativeLaunch({...input,profile:{...input.profile,args:[...input.profile.args,'--settings','{}']}})).rejects.toMatchObject({code:'AGENT_ADAPTER_UNSUPPORTED'});
});


describe('login-shell PATH regression',()=>{
let root: string;
let bin: string;
let project: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'smartdd-native-launch-'));
  bin = join(root, 'bin');
  project = join(root, 'project');
  mkdirSync(bin);
  mkdirSync(project);
  mkdirSync(join(root, '.codex'));
  // A Finder-launched app has a bare PATH; the interpreter is only reachable after the rc files,
  // exactly like `#!/usr/bin/env node` with node in /usr/local/bin.
  writeFileSync(join(root, '.zshrc'), `echo "rc noise"\nexport PATH="${bin}:/usr/bin:/bin"\n`);
  writeFileSync(join(root, '.bash_profile'), `echo "rc noise"\nexport PATH="${bin}:/usr/bin:/bin"\n`);
  writeFileSync(join(bin, 'fakenode'), '#!/bin/sh\necho "codex-cli 0.166.0"\n');
  writeFileSync(join(bin, 'codex'), '#!/usr/bin/env fakenode\n');
  chmodSync(join(bin, 'fakenode'), 0o755);
  chmodSync(join(bin, 'codex'), 0o755);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const input = (command: string): TaskLaunchInput => ({
  projectId: 'p', taskId: 't', cwd: project, home: root, stateRoot: join(root, '.codex'), claudeConfigExplicit: false,
  mode: 'new', sessionId: null, previous: null, newTask: true, signal: new AbortController().signal,
  profile: { runner: 'codex', command, args: [], env: {} } as unknown as TaskLaunchInput['profile'],
  environment: { HOME: root, ZDOTDIR: root, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TERM: 'dumb' },
});

describe('inspectNativeLaunch with a bare app PATH', () => {
  it('reuses the checked executable for this launch only and redetects a replaced executable', async () => {
    const command = join(bin, 'codex'), task = input(command);
    const checked = { runner: task.profile.runner, path: command, version: '0.168.0', shellPath: bin,
      identity: nativeExecutableIdentity(command)! };
    expect((await inspectNativeLaunch(task, checked)).version).toBe('0.168.0');
    writeFileSync(command, '#!/bin/sh\necho "codex-cli 0.169.0"\n');
    expect((await inspectNativeLaunch(task, checked)).version).toBe('0.169.0');
  });
  it('verifies an absolute script CLI whose interpreter is only on the login-shell PATH', async () => {
    const context = await inspectNativeLaunch(input(join(bin, 'codex')));
    expect(context).toMatchObject({ command: join(bin, 'codex'), version: '0.166.0', shellPath: `${bin}:/usr/bin:/bin` });
  });

  it('resolves a bare command name through the login-shell PATH', async () => {
    const context = await inspectNativeLaunch(input('codex'));
    expect(context).toMatchObject({ command: join(bin, 'codex'), version: '0.166.0' });
  });

  it('still rejects a command that the login shell cannot find', async () => {
    await expect(inspectNativeLaunch(input('codex-missing'))).rejects.toMatchObject({ code: 'AGENT_ADAPTER_UNSUPPORTED' });
  });
});

});
