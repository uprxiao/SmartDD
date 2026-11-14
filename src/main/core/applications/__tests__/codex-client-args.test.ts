import {describe,expect,it} from 'vitest';
import {codexClientArgs} from '../codex-client-args';
import {codexResumePermissions} from '../codex-resume-relay';

describe('native Codex remote resume permission handoff',()=>{
 it('hands M13 shorthand permissions to the restore relay instead of the remote TUI',()=>{
  expect(codexClientArgs(['--approve-for-me','-m','qa'],[],true)).toEqual({profile:['-m','qa'],managed:[],permissionKeys:['approvals_reviewer','approval_policy','sandbox_mode']});
  expect(codexClientArgs(['--dangerously-bypass-approvals-and-sandbox'],[],true)).toEqual({profile:[],managed:[],permissionKeys:['approval_policy','sandbox_mode']});
  expect(codexClientArgs(['-c','mcp_servers.qa.args=["--approve-for-me"]'],[],true)).toEqual({profile:['-c','mcp_servers.qa.args=["--approve-for-me"]'],managed:[],permissionKeys:[]});
 });
 it('keeps new-task permission choices and removes only the incompatible daemon selector',()=>{
  expect(codexClientArgs(['-s','read-only','-a','on-request','--no-daemon','--no-alt-screen'],['-c','mcp_servers.qa.command="x"'],false)).toEqual({profile:['-s','read-only','-a','on-request','--no-alt-screen'],managed:['-c','mcp_servers.qa.command="x"'],permissionKeys:[]});
 });
 it('moves dedicated and TOML permissions from both sources, preserving unrelated literal argv and model selection',()=>{
  expect(codexClientArgs(['-m','model qa','-s','read-only','--ask-for-approval=on-request','-capprovals_reviewer="user"','--disable','shell_snapshot','--no-alt-screen'],['--config','default_permissions="qa"','-c','mcp_servers.qa.args=["-s","-a"]'],true)).toEqual({profile:['-m','model qa','--disable','shell_snapshot','--no-alt-screen'],managed:['-c','mcp_servers.qa.args=["-s","-a"]'],permissionKeys:['sandbox_mode','approval_policy','approvals_reviewer','default_permissions']});
 });
 it('handles quoted root keys and nested rules without mistaking string values or feature names for permissions',()=>{
  expect(codexClientArgs(['-c','"permissions".qa.extends=":read-only"','--config=sandbox_workspace_write.network_access=false','-c','name="approval_policy=never"','--disable','network'],[],true)).toEqual({profile:['-c','name="approval_policy=never"','--disable','network'],managed:[],permissionKeys:['permissions','sandbox_workspace_write']});
 });
 it('does not turn absent permission overrides into new choices',()=>{
  expect(codexClientArgs(['-m','qa'],[],true).permissionKeys).toEqual([]);
  expect(codexResumePermissions({config:{approval_policy:'never',sandbox_mode:'danger-full-access'}},[])).toEqual({});
 });
 it('projects exact effective native values and never copies model/provider/credential config',()=>{
  const response={config:{approval_policy:'on-request',approvals_reviewer:'user',sandbox_mode:'read-only',model_provider:'private',provider_key:'not-a-permission'}};
  expect(codexResumePermissions(response,['approval_policy','approvals_reviewer','sandbox_mode'])).toEqual({approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'read-only',config:{approval_policy:'on-request',approvals_reviewer:'user',sandbox_mode:'read-only'}});
 });
 it('preserves named permission rules, network rules and writable-root config as native JSON',()=>{
  const config={default_permissions:'safe',permissions:{safe:{extends:':read-only'}},network:{enabled:false},sandbox_workspace_write:{writable_roots:['/synthetic']}};
  const result=codexResumePermissions({config},['default_permissions','permissions','network','sandbox_workspace_write']);expect(result).toEqual({permissions:'safe',config});(config.permissions.safe as {extends:string}).extends='changed';expect(JSON.stringify(result)).not.toContain('changed');
 });
 it('omits native Option metadata before TOML overrides, keeping denial maps, false and zero',()=>{
  const config={default_permissions:'child',permissions:{parent:{description:null,extends:':workspace',workspace_roots:null,filesystem:{glob_scan_max_depth:null,'/private/deny':'deny'},network:{enabled:true,proxy_url:null,domains:{localhost:'allow','forbidden.invalid':'deny'},allow_local_binding:false}},child:{extends:'parent',filesystem:{glob_scan_max_depth:0},network:{unix_sockets:{'/private/only.sock':'allow'},enable_socks5:false,domains:null}}},network:{enabled:false,proxy_url:null}};
  expect(codexResumePermissions({config},['default_permissions','permissions','network'])).toEqual({permissions:'child',config:{default_permissions:'child',permissions:{parent:{extends:':workspace',filesystem:{'/private/deny':'deny'},network:{enabled:true,domains:{localhost:'allow','forbidden.invalid':'deny'},allow_local_binding:false}},child:{extends:'parent',filesystem:{glob_scan_max_depth:0},network:{unix_sockets:{'/private/only.sock':'allow'},enable_socks5:false}}},network:{enabled:false}}});
  expect(config.permissions.parent.filesystem.glob_scan_max_depth).toBeNull();
 });
 it('rejects a missing selected value or an unrepresentable null array item instead of weakening it',()=>{
  expect(()=>codexResumePermissions({config:{network:null}},['network'])).toThrowError(expect.objectContaining({code:'INVALID_RESPONSE'}));
  expect(()=>codexResumePermissions({config:{sandbox_workspace_write:{writable_roots:['/private',null]}}},['sandbox_workspace_write'])).toThrowError(expect.objectContaining({code:'INVALID_RESPONSE'}));
 });
 it.each([{}, {config:{}}, {config:{sandbox_mode:'unknown'}}])('refuses missing or invalid native permission evidence %j',response=>{
  expect(()=>codexResumePermissions(response,['sandbox_mode'])).toThrowError(expect.objectContaining({code:'INVALID_RESPONSE'}));
 });
 it('refuses malformed config keys instead of silently dropping them',()=>{expect(()=>codexClientArgs(['-c','permissions.[=false'],[],true)).toThrowError(expect.objectContaining({code:'AGENT_ADAPTER_UNSUPPORTED'}));});
});


describe('named startup permissions observed with Codex 0.167.1 remote TUI',()=>{
 it('collects explicit named choices for startup without stripping the native client flags',()=>{
  const profile=['-a','on-request','-c','approvals_reviewer="user"','--no-alt-screen'];
  const managed=['-c','default_permissions="wy_cli_test"','-c','permissions.wy_cli_test.extends="t100_parent"'];
  expect(codexClientArgs(profile,managed,false)).toEqual({profile,managed,permissionKeys:['approval_policy','approvals_reviewer','default_permissions','permissions']});
 });
});
