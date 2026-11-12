import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {codexServerArgs,codexServerEnvironment,codexServerExecutable} from '../codex-task-server';
import type {TaskLaunchInput} from '../native-launch-context';
import {VALUE_PREFIX} from '../../../launch-env';
const dirs:string[]=[];afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function task():TaskLaunchInput{
  const root=realpathSync(mkdtempSync('/tmp/wy-m13-codex-task-'));dirs.push(root);const home=join(root,'home');mkdirSync(home);
  return{projectId:'p1',taskId:'t1',profile:{id:'synthetic',name:'synthetic',runner:'codex',command:'not-executed',args:[],env:{PROFILE_KEY:'synthetic-selected',ANTHROPIC_API_KEY:'selected-only'},isolatePrefixes:['ANTHROPIC_']},cwd:root,home,stateRoot:join(home,'.codex'),claudeConfigExplicit:false,mode:'new',sessionId:null,previous:null,newTask:true,signal:new AbortController().signal,environment:{HOME:'/outer-home',CODEX_HOME:'/outer-code',PATH:'/usr/bin:/bin',ANTHROPIC_API_KEY:'outer',ANTHROPIC_OTHER:'outer',WILLYOU_RUN_TOKEN:'outer-token',WILLYOU_ENDPOINT:'outer-endpoint',SMARTDD_OTHER:'outer',CLAUDECODE:'1',[VALUE_PREFIX+'SECRET']:'outer-carrier'}};
}
describe('private Codex server argv and environment preserve the selected native configuration',()=>{
  it('copies overrides and features in order and makes explicit model/permission flags effective in server startup',()=>{
    expect(codexServerArgs(['-c','model_provider="synthetic"','-m','model-qa','--sandbox=read-only','-a','on-request','--disable','shell_snapshot','--no-alt-screen','--no-daemon'],['-c','mcp_servers.wy.command="synthetic"'])).toEqual(['-c','model_provider="synthetic"','--disable','shell_snapshot','-c','mcp_servers.wy.command="synthetic"','-c','model="model-qa"','-c','sandbox_mode="read-only"','-c','approval_policy="on-request"']);
  });
  it('keeps TOML values and compact config argv literal, including spaces and equals signs',()=>{
    const value='model_providers.qa={name="a=b",base_url="http://127.0.0.1:9/v1"}';expect(codexServerArgs(['-c'+value,'--config=model="literal spaces"','--enable=x'],[])).toEqual(['-c',value,'--config','model="literal spaces"','--enable','x']);
  });
  it('keeps dedicated native model and permission flags above later TOML overrides',()=>{
    const mapped=codexServerArgs(['-m','chosen','-s','read-only','-a','on-request','-c','model="other"','-c','sandbox_mode="danger-full-access"','-c','approval_policy="never"'],['-c','mcp_servers.wy.command="synthetic"']);
    expect(mapped.slice(-6)).toEqual(['-c','model="chosen"','-c','sandbox_mode="read-only"','-c','approval_policy="on-request"']);
    expect(mapped.indexOf('sandbox_mode="read-only"')).toBeGreaterThan(mapped.indexOf('sandbox_mode="danger-full-access"'));
  });
  it.each([['--remote','unix:///other'],['--profile','work'],['--worktree'],['--dangerously-bypass-hook-trust'],['--approve-for-me'],['--sandbox','unknown'],['-a','untrusted'],['--'],['prompt text'],['-m'],['--search=false']].map(args=>[args]))('refuses an unverified native argument combination %j without silently changing it',args=>{
    expect(()=>codexServerArgs(args,[])).toThrowError(expect.objectContaining({code:'AGENT_ADAPTER_UNSUPPORTED'}));
  });
  it('refuses a subcommand/endpoint/prompt in generated host arguments',()=>{expect(()=>codexServerArgs([],['--remote','unix:///other'])).toThrow();expect(()=>codexServerArgs([],['-c'])).toThrow();});
  it('strips inherited credentials/carriers and pins only the selected HOME/state root and current host injection',()=>{
    const t=task(),env=codexServerEnvironment(t,{WILLYOU_RUN_TOKEN:'this-run-only',WILLYOU_ENDPOINT:'/private/tmp/this-run',SMARTDD_SELECTED:'this-run'});
    expect(env).toMatchObject({HOME:t.home,CODEX_HOME:t.stateRoot,PATH:'/usr/bin:/bin',ANTHROPIC_API_KEY:'selected-only',PROFILE_KEY:'synthetic-selected',WILLYOU_RUN_TOKEN:'this-run-only',WILLYOU_ENDPOINT:'/private/tmp/this-run',SMARTDD_SELECTED:'this-run'});
    expect(env).not.toHaveProperty('ANTHROPIC_OTHER');expect(env).not.toHaveProperty('SMARTDD_OTHER');expect(env).not.toHaveProperty('CLAUDECODE');expect(env).not.toHaveProperty(VALUE_PREFIX+'SECRET');expect(JSON.stringify(env)).not.toContain('outer-token');expect(t.environment.WILLYOU_RUN_TOKEN).toBe('outer-token');
  });
  it('does not run an arbitrary script merely because it advertises a native version',async()=>{
    const t=task(),path=join(t.cwd,'script');writeFileSync(path,'#!/bin/sh\ntouch '+join(t.cwd,'executed')+'\n',{mode:0o700});await expect(codexServerExecutable({command:path,version:'0.167.1',inventory:[],userSkillConfig:[]},t)).rejects.toMatchObject({code:'AGENT_ADAPTER_UNSUPPORTED'});
    expect(()=>readFileSync(join(t.cwd,'executed'))).toThrow();
  });
  it.runIf(!!process.env.WILLYOU_P1_CODEX_WRAPPER)('resolves the installed official npm wrapper to its matching native image without modifying the profile',async()=>{
    const t=task(),wrapper=process.env.WILLYOU_P1_CODEX_WRAPPER!,resolved=await codexServerExecutable({command:wrapper,version:'0.167.1',inventory:[],userSkillConfig:[]},t);expect(resolved.path).toMatch(/\/vendor\/aarch64-apple-darwin\/bin\/codex$/);expect(resolved.sha256).toMatch(/^[a-f0-9]{64}$/);expect(t.profile.command).toBe('not-executed');
  });
});
