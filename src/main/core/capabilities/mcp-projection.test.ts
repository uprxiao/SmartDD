import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach,beforeEach,expect,it } from 'vitest';
import { McpProjectionService } from './mcp-projection';
import { parseMcpSource } from './mcp-source';
import type { ManagedCapabilityView } from '@shared/managed-capabilities';
let root:string,items:ManagedCapabilityView[],definitions:Record<string,ReturnType<typeof parseMcpSource>>,environment:Record<string,string>;
const item=(id:string):ManagedCapabilityView=>({id,kind:'mcp',name:id,runner:'claude',sourcePath:'/source/config.json',sourceScope:'user',projectRoot:null,sourceLabel:'user',version:null,managed:true,enabled:true,autoApprove:false,present:true,status:'managed',issues:[],loaded:'unverified'});
const service=()=>new McpProjectionService({selected:()=>items.filter(x=>x.managed&&x.enabled),resolveMcpSource:id=>definitions[id]?{source:definitions[id],environment}:null},{userData:root,executable:'/fixture/WillYou',launcherSource:'// public carrier source'});
const input=(runner:'claude'|'codex'='codex')=>({runner,cwd:join(root,'project'),runRoot:join(root,'agents/runs',randomUUID()),injectedNames:['OPENAI_API_KEY','ANTHROPIC_AUTH_TOKEN','CUSTOM_MODEL_KEY']});
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'m13-mcp-')));mkdirSync(join(root,'project'));items=[];definitions=Object.create(null);environment={PUBLIC_SOURCE_KEY:'PUBLIC_SOURCE_ONLY'};});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
it('preserves the server name under Codex literal dotted override parsing',()=>{
 items=[item('alpha')];definitions.alpha=parseMcpSource('alpha-server_2','codex',{command:'/usr/bin/true'});
 const actual=service().prepare(input()),override=actual.args[1],separator=override.indexOf('=');
 // Official 0.167.1 mcp list confirms key segments are literal, not TOML quoted keys.
 expect(override.slice(0,separator).split('.')).toEqual(['mcp_servers','alpha-server_2']);
 expect(parseToml('server='+override.slice(separator+1)).server).toMatchObject({command:'/fixture/WillYou'});
});
it('builds process-only per-server values, TOML overrides and public controls without touching native configurations',()=>{
 items=[item('alpha'),item('beta')];definitions.alpha=parseMcpSource('alpha','claude',{command:'/usr/bin/true',args:['$5','${PUBLIC_SOURCE_KEY}'],env:{KEY:'${PUBLIC_SOURCE_KEY}'}});definitions.beta=parseMcpSource('beta','claude',{command:'/usr/bin/true',args:['@WYARG:alpha_1','--arg','UNKNOWN']});
 const request=input(),actual=service().prepare(request),text=JSON.stringify(actual.args);expect(actual.configured).toEqual(['alpha','beta']);expect(actual.issues).toEqual([]);expect(text).not.toContain('PUBLIC_SOURCE_ONLY');expect(text).not.toContain('@WYARG');expect(Object.values(actual.env)).toContain('PUBLIC_SOURCE_ONLY');
 const config=Object.assign({},...actual.args.filter((_,i)=>i%2===1).map(x=>parseToml(x)));expect(config.mcp_servers).toBeDefined();
 const folder=join(request.runRoot,'mcp');for(const f of readdirSync(folder)){const p=join(folder,f);expect(readFileSync(p,'utf8')).not.toContain('PUBLIC_SOURCE_ONLY');expect(lstatSync(p).mode&0o777).toBe(0o600);}
 expect(readdirSync(root).sort()).toEqual(['agents','project']);expect(lstatSync(folder).mode&0o777).toBe(0o700);
});
it.each(['env','args','headers'])('omits entire missing-variable server (%s) while another healthy server proceeds',kind=>{
 items=[item('bad'),item('good')];definitions.good=parseMcpSource('good','claude',{command:'/usr/bin/true'});definitions.bad=parseMcpSource('bad','claude',kind==='headers'?{type:'http',url:'https://public.example.test/mcp',headers:{Authorization:'${ABSENT}'}}:{command:'/usr/bin/true',...(kind==='env'?{env:{KEY:'${ABSENT}'}}:{args:['first','${ABSENT}','last']})});
 const request=input(),result=service().prepare(request);expect(result.configured).toEqual(['good']);expect(result.issues).toEqual([{id:'bad',reason:expect.stringContaining('缺少变量 ABSENT')}]);const parsed=Object.assign({},...result.args.filter((_,i)=>i%2===1).map(x=>parseToml(x)));expect(parsed.mcp_servers).not.toHaveProperty('bad');expect(Object.values(result.env)).not.toContain('first');expect(Object.values(result.env)).not.toContain('last');
});
it('cancel/disable affect subsequent launches without changing the source or an already prepared run',()=>{
 items=[item('echo')];definitions.echo=parseMcpSource('echo','claude',{command:'/usr/bin/true',env:{KEY:'PUBLIC_KEY'}});const a=input('claude'),before=service().prepare(a),original=JSON.stringify(definitions);expect(before.configured).toEqual(['echo']);
 items[0].managed=false;expect(service().prepare(input('claude'))).toMatchObject({configured:[],args:[],env:{}});expect(JSON.stringify(definitions)).toBe(original);expect(existsSync(join(a.runRoot,'mcp/servers.json'))).toBe(true);
});
it('keeps raw unexpected errors out of metadata while retaining a healthy server',()=>{
 const svc=new McpProjectionService({selected:()=>[item('bad')],resolveMcpSource:()=>{throw Error('PRIVATE_VALUE_MUST_NOT_APPEAR');}},{userData:root,executable:'/fixture/WillYou'});
 const result=svc.prepare(input());expect(result.configured).toEqual([]);expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE_MUST_NOT_APPEAR');
});
it('retains literal Codex HTTP values in Claude helper slots and per-tool prompt/deny policy',()=>{
 items=[{...item('http'),autoApprove:true}];definitions.http=parseMcpSource('http','codex',{url:'https://public.example.test/mcp',http_headers:{Authorization:'Literal ${X}'},disabled_tools:['write'],tools:{inspect:{approval_mode:'prompt'}}});const request=input('claude'),result=service().prepare(request);
 expect(result.args).toContain('mcp__http__*');expect(result.args).toContain('mcp__http__write');expect(Object.values(result.env)).toContain('Literal ${X}');const servers=readFileSync(join(request.runRoot,'mcp/servers.json'),'utf8');expect(servers).not.toContain('Literal');expect(JSON.parse(servers).mcpServers.http.headersHelper).toMatch(/-headers.sh$/);
 expect(JSON.parse(readFileSync(join(request.runRoot,'mcp/permissions.json'),'utf8')).permissions.ask).toEqual(['mcp__http__inspect']);
});
it('rejects a symlinked management directory and a reused run rather than overwriting controls',()=>{
 items=[item('echo')];definitions.echo=parseMcpSource('echo','claude',{command:'/usr/bin/true'});const request=input();service().prepare(request);const before=readFileSync(join(request.runRoot,'mcp/wy-mcp-launch.cjs'),'utf8');expect(()=>service().prepare(request)).toThrow();expect(readFileSync(join(request.runRoot,'mcp/wy-mcp-launch.cjs'),'utf8')).toBe(before);
 const other=input();mkdirSync(other.runRoot,{recursive:true});symlinkSync(join(root,'project'),join(other.runRoot,'mcp'));expect(()=>service().prepare(other)).toThrow(/身份/);expect(readdirSync(join(root,'project'))).toEqual([]);
});
it('source profile references are resolved in main from the source environment, never a target model injected key',()=>{
 const svc=new McpProjectionService({selected:()=>[item('echo')],resolveMcpSource:()=>({source:parseMcpSource('echo','claude',{command:'/usr/bin/true',env:{OWN:'${SOURCE_SECRET}'}}),environment:{},configurationId:'source-profile',secretEnvNames:['SOURCE_SECRET']})},{userData:root,executable:'/fixture/WillYou',launcherSource:'//public',profileEnvironment:id=>{expect(id).toBe('source-profile');return {SOURCE_SECRET:'PUBLIC_SOURCE_PROFILE_KEY'};}});
 expect(Object.values(svc.prepare(input()).env)).toContain('PUBLIC_SOURCE_PROFILE_KEY');
});

it('does not decrypt an unrelated source profile key for literal MCP configuration',()=>{
 const svc=new McpProjectionService({selected:()=>[item('literal')],resolveMcpSource:()=>({source:parseMcpSource('literal','claude',{command:'/usr/bin/true',env:{OWN:'PUBLIC_LITERAL'}}),environment:{},configurationId:'source-profile',secretEnvNames:['ANTHROPIC_API_KEY']})},{userData:root,executable:'/fixture/WillYou',launcherSource:'//public',profileEnvironment:()=>{throw Error('UNRELATED_KEYCHAIN_MUST_NOT_BE_TOUCHED');}});
 expect(svc.prepare(input())).toMatchObject({configured:['literal'],issues:[]});
});

it('anchors a relative command to the effective spawn cwd and retains only the source PATH',()=>{
 const svc=new McpProjectionService({selected:()=>[item('local')],resolveMcpSource:()=>({source:parseMcpSource('local','codex',{command:'./bin/mcp',cwd:'backend'}),environment:{PATH:'/public/source/bin'}})},{userData:root,executable:'/fixture/WillYou',launcherSource:'//public'});
 const request=input(),result=svc.prepare(request),folder=join(request.runRoot,'mcp');const plan=JSON.parse(readFileSync(join(folder,readdirSync(folder).find(x=>x.endsWith('.json'))!),'utf8'));
 expect(plan.command).toBe(join(root,'project/backend/bin/mcp'));expect(plan.cwd).toBe(join(root,'project/backend'));expect(result.env[plan.ownEnv.PATH.slot]).toBe('/public/source/bin');expect(plan.ownEnv).not.toHaveProperty('ANTHROPIC_API_KEY');
});
