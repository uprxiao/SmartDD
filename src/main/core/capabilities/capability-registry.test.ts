import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { CapabilityRegistryService, type CapabilityScanContext } from './capability-registry';
import { ManagedSkillLinks } from './managed-skill-links';
import { capabilityScanContexts } from './scan-contexts';

let sqlite:Database.Database,db:ReturnType<typeof drizzle<typeof schema>>,root:string,contexts:CapabilityScanContext[],svc:CapabilityRegistryService;
const file=(path:string,text:string)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);return path;};
const skill=(runner:'claude'|'codex',name:string,scope='user')=>file(join(root,scope==='user'?'home':'project',runner==='claude'?'.claude':'.agents','skills',name,'SKILL.md'),`---\nname: ${name}\ndescription: public test\n---\nPUBLIC_SOURCE`);
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'m13-registry-')));sqlite=new Database(':memory:');runBundledMigrations(sqlite);db=drizzle(sqlite,{schema});mkdirSync(join(root,'project','.git'),{recursive:true});contexts=[{runner:'claude',home:join(root,'home'),stateRoot:join(root,'home/.claude'),cwd:join(root,'project'),projectRoot:join(root,'project'),path:''},{runner:'codex',home:join(root,'home'),stateRoot:join(root,'home/.codex'),cwd:join(root,'project'),projectRoot:join(root,'project'),path:''}];svc=new CapabilityRegistryService(db,()=>contexts);});
afterEach(()=>{sqlite.close();rmSync(root,{recursive:true,force:true});});

it('discovers without executing, persists consent and approval, and rescans idempotently without raw MCP data',()=>{
  skill('claude','public-skill');file(join(root,'home/.claude.json'),JSON.stringify({mcpServers:{echo:{command:'/does-not-exist',args:['PUBLIC_SECRET_SENTINEL'],env:{OWN_KEY:'PUBLIC_VALUE_SENTINEL'}}}}));
  expect(svc.scan().items).toHaveLength(2);expect(svc.list().newCount).toBe(2);
  const adopted=svc.adoptAll();expect(adopted.items.every(x=>x.managed&&x.loaded==='unverified')).toBe(true);
  const mcp=adopted.items.find(x=>x.kind==='mcp')!;svc.setAutoApprove(mcp.id,true);svc.setEnabled(mcp.id,false);
  const fresh=new CapabilityRegistryService(db,()=>contexts);fresh.scan();expect(fresh.list().items.find(x=>x.id===mcp.id)).toMatchObject({managed:true,autoApprove:true,enabled:false});
  const raw=JSON.stringify(sqlite.prepare('SELECT * FROM capability_registry').all());expect(raw).not.toContain('PUBLIC_SECRET_SENTINEL');expect(raw).not.toContain('PUBLIC_VALUE_SENTINEL');expect(raw).not.toContain('OWN_KEY');
});
it('one click and automatic adoption skip overlapping same names but keep independent projects',()=>{
  skill('claude','duplicate');skill('codex','duplicate');skill('claude','okay');
  expect(svc.scan().items.filter(x=>x.status==='conflict')).toHaveLength(2);expect(svc.adoptAll().items.filter(x=>x.managed).map(x=>x.name)).toEqual(['okay']);
  svc.setAutoManage(true);skill('codex','automatic');svc.scan();expect(svc.list().items.find(x=>x.name==='automatic')?.managed).toBe(true);
  const target=join(root,'other');mkdirSync(join(target,'.git'),{recursive:true});file(join(target,'.claude/skills/local/SKILL.md'),'---\nname: local\ndescription: local\n---\n');skill('claude','local','project');
  contexts.push({...contexts[0],cwd:target,projectRoot:target});svc.scan();expect(svc.list().items.filter(x=>x.name==='local').map(x=>x.status)).toEqual(['managed','managed']);expect(svc.selected(target).filter(x=>x.name==='local')).toHaveLength(1);
});
it('source deletion retains consent as missing and returning source recovers it; cancellation leaves original bytes',()=>{
  const path=skill('claude','returning'),bytes=readFileSync(path);svc.scan();const id=svc.adoptAll().items[0].id;
  rmSync(dirname(path),{recursive:true});expect(svc.scan().items[0]).toMatchObject({id,managed:true,status:'missing'});
  skill('claude','returning');expect(svc.scan().items[0]).toMatchObject({id,managed:true,status:'managed'});
  svc.setManaged(id,false);expect(readFileSync(path)).toEqual(bytes);expect(svc.list().items[0].status).toBe('new');
});
it('generated target links are not rediscovered as sources, while user files remain conflicts',()=>{
  const source=dirname(skill('claude','echo'));new ManagedSkillLinks(join(root,'home/.agents/skills')).link('echo',source);
  expect(svc.scan().items).toHaveLength(1);expect(svc.adoptAll().items[0].status).toBe('managed');
  skill('codex','echo-user');skill('claude','echo-user');expect(svc.scan().items.filter(x=>x.name==='echo-user').every(x=>x.status==='conflict')).toBe(true);
});
it('shows a project Codex target file as a conflict before adoption without altering it',()=>{
  skill('claude','target-file','project');const target=file(join(root,'project/.agents/skills/target-file'),'USER_FILE_KEEP');
  const row=svc.scan().items.find(x=>x.name==='target-file')!;
  expect(row.status).toBe('conflict');expect(row.issues).toContain('skill_target_conflict');
  expect(()=>svc.setManaged(row.id,true)).toThrow(/冲突/);
  expect(readFileSync(target,'utf8')).toBe('USER_FILE_KEEP');
  rmSync(target);expect(svc.list().items.find(x=>x.id===row.id)?.status).toBe('new');
  symlinkSync(dirname(row.sourcePath),target);
  expect(svc.list().items.find(x=>x.id===row.id)?.issues).not.toContain('skill_target_conflict');
});
it('discloses non-Git project placement while still allowing project Skill adoption',()=>{
  rmSync(join(root,'project/.git'),{recursive:true});skill('claude','non-git','project');
  const row=svc.scan().items.find(x=>x.name==='non-git')!;
  expect(row.status).toBe('new');expect(row.issues).toContain('project_not_git');
  expect(svc.setManaged(row.id,true).items.find(x=>x.id===row.id)?.managed).toBe(true);
});
it('plugin, host and invalid entries cannot be independently adopted',()=>{
  skill('claude','smartdd-project-db-diagnostics');file(join(root,'home/.claude/skills/bad/SKILL.md'),'missing front matter');
  const items=svc.scan().items;expect(items.find(x=>x.sourceScope==='host')?.status).toBe('host');
  for(const x of items)expect(()=>svc.setManaged(x.id,true)).toThrow();expect(svc.adoptAll().items.some(x=>x.managed)).toBe(false);
});
it('lists actual host-supplied installed plugin skills without acquiring their ownership',()=>{
  const plugin=new CapabilityRegistryService(db,()=>contexts,()=>1,{pluginSkills:()=>[{appId:'zentao',pluginName:'禅道',id:'zentao-bugs',path:'/owned/plugin/skills/bugs',version:'1.1.0',enabled:true}]});
  const row=plugin.list().items[0];expect(row).toMatchObject({status:'plugin',sourceLabel:'禅道',managed:false,version:'1.1.0'});expect(()=>plugin.setManaged(row.id,true)).toThrow(/插件或宿主/);expect(plugin.adoptAll().items[0].managed).toBe(false);
});
it('allows independently adopting CLI-native plugin resources while keeping WillYou plugin ownership separate',()=>{
  const pluginRoot=join(root,'native-plugin');
  file(join(root,'home/.claude/plugins/installed_plugins.json'),JSON.stringify({version:2,plugins:{'native@local':[{installPath:pluginRoot,version:'1.0.0',scope:'user'}]}}));
  file(join(pluginRoot,'.claude-plugin/plugin.json'),JSON.stringify({name:'native'}));
  file(join(pluginRoot,'skills/native-skill/SKILL.md'),'---\nname: native-skill\ndescription: public native plugin skill\n---\n');
  file(join(pluginRoot,'.mcp.json'),JSON.stringify({mcpServers:{native_server:{command:'/usr/bin/true'}}}));
  const rows=svc.scan().items;expect(rows).toHaveLength(2);
  for(const row of rows){expect(row.sourceScope).toBe('user');expect(row.status).toBe('new');svc.setManaged(row.id,true);}
  expect(svc.selected(join(root,'project'))).toHaveLength(2);
  const mcp=rows.find(x=>x.kind==='mcp')!;expect(svc.resolveMcpSource(mcp.id)?.source.command).toBe('/usr/bin/true');
});
it('does not accept renderer-like non-boolean write values',()=>{
  skill('claude','safe');svc.scan();const id=svc.adoptAll().items[0].id;
  expect(()=>svc.setEnabled(id,'false' as never)).toThrow();expect(()=>svc.setAutoManage(1 as never)).toThrow();expect(()=>svc.setAutoApprove(id,true)).toThrow();
});
it('automatic adoption does not undo explicit cancellation on the next scan',()=>{
  svc.setAutoManage(true);skill('claude','manual');const id=svc.scan().items[0].id;expect(svc.list().items[0].managed).toBe(true);
  svc.setManaged(id,false);expect(svc.scan().items[0]).toMatchObject({id,managed:false,status:'new'});
});
it('retains distinct profile-argument MCP origins rather than merging identical names',()=>{
  contexts=[{...contexts[0],configurationId:'a',args:['--mcp-config',JSON.stringify({mcpServers:{same:{command:'/a'}}})]},{...contexts[0],configurationId:'b',args:['--mcp-config',JSON.stringify({mcpServers:{same:{command:'/b'}}})]}];
  expect(svc.scan().items).toMatchObject([{status:'conflict'},{status:'conflict'}]);
});
it('keeps a previously managed global capability usable in other projects when one project conflicts',()=>{
  skill('claude','global');svc.scan();svc.adoptAll();skill('claude','global','project');svc.scan();
  expect(svc.selected(join(root,'project'))).toHaveLength(0);expect(svc.selected(join(root,'different'))).toHaveLength(1);
});
it('retains the original alias identity when a source installer switches version directories',()=>{
  const a=dirname(file(join(root,'versions/a/SKILL.md'),'---\nname: alias\ndescription: version a\n---\n'));
  const b=dirname(file(join(root,'versions/b/SKILL.md'),'---\nname: alias\ndescription: version b\n---\n'));
  const alias=join(root,'home/.claude/skills/alias');mkdirSync(dirname(alias),{recursive:true});symlinkSync(a,alias);
  svc.scan();const id=svc.adoptAll().items[0].id;rmSync(alias);symlinkSync(b,alias);expect(svc.scan().items).toMatchObject([{id,managed:true,status:'managed'}]);
});
it('builds all trusted public/custom directory contexts without decrypting or losing project scope',()=>{
  const rows=capabilityScanContexts(join(root,'home'),{PATH:'/synthetic/bin'},[{runner:'claude',args:[],env:[{name:'CLAUDE_CONFIG_DIR',secret:false,value:join(root,'custom')},{name:'ANTHROPIC_API_KEY',secret:true,value:null}]}],[join(root,'project')]);
  expect(rows.some(x=>x.stateRoot===join(root,'custom')&&x.projectRoot===join(root,'project'))).toBe(true);
  expect(rows.some(x=>x.runner==='codex'&&x.stateRoot===join(root,'home/.codex'))).toBe(true);expect(rows.every(x=>!Object.hasOwn(x.sourceEnvironment??{},'ANTHROPIC_API_KEY'))).toBe(true);expect(rows.find(x=>x.stateRoot===join(root,'custom'))?.secretEnvNames).toContain('ANTHROPIC_API_KEY');
});

it('re-resolves current MCP values only in main, retaining metadata IDs and never persisting values',()=>{
  const path=file(join(root,'home/.claude.json'),JSON.stringify({mcpServers:{echo:{command:'/usr/bin/true',env:{OWN:'FIRST_PRIVATE_VALUE'}}}}));
  contexts[0].sourceEnvironment={PUBLIC_SOURCE_REF:'PUBLIC_CONTEXT_VALUE'};svc.scan();const id=svc.adoptAll().items[0].id;
  expect(svc.resolveMcpSource(id)).toMatchObject({source:{name:'echo',env:{OWN:{literal:'FIRST_PRIVATE_VALUE'}}},environment:{PUBLIC_SOURCE_REF:'PUBLIC_CONTEXT_VALUE'}});
  file(path,JSON.stringify({mcpServers:{echo:{command:'/usr/bin/true',env:{OWN:'SECOND_PRIVATE_VALUE'}}}}));expect(svc.resolveMcpSource(id)?.source.env.OWN).toEqual({literal:'SECOND_PRIVATE_VALUE'});
  expect(JSON.stringify(svc.list())).not.toContain('PRIVATE_VALUE');expect(JSON.stringify(sqlite.prepare('SELECT * FROM capability_registry').all())).not.toContain('PRIVATE_VALUE');
  svc.setManaged(id,false);expect(svc.resolveMcpSource(id)).toBeNull();expect(readFileSync(path,'utf8')).toContain('SECOND_PRIVATE_VALUE');
});

it('does not silently reuse default credentials for profiles sharing a native MCP file',()=>{
  const home=join(root,'home'),project=join(root,'project');file(join(home,'.claude.json'),JSON.stringify({mcpServers:{echo:{command:'/usr/bin/true',env:{OWN:'${MCP_TOKEN}'}}}}));
  contexts=capabilityScanContexts(home,{HOME:home,PATH:'/usr/bin:/bin',MCP_TOKEN:'PUBLIC_BASE_TOKEN'},[{id:'different',runner:'claude',args:[],env:[{name:'MCP_TOKEN',value:'PUBLIC_PROFILE_TOKEN',secret:false}]}],[project]);
  const rows=svc.scan().items.filter(x=>x.kind==='mcp');expect(rows).toHaveLength(2);expect(rows.every(x=>x.status==='conflict')).toBe(true);expect(svc.adoptAll().items.every(x=>!x.managed)).toBe(true);
  const publicText=JSON.stringify(svc.list());expect(publicText).not.toContain('PUBLIC_BASE_TOKEN');expect(publicText).not.toContain('PUBLIC_PROFILE_TOKEN');
});
it('deduplicates equal effective MCP source environments but separates an opaque saved reference',()=>{
  const home=join(root,'home');file(join(home,'.claude.json'),JSON.stringify({mcpServers:{echo:{command:'/usr/bin/true',env:{OWN:'${MCP_TOKEN}'}}}}));
  const profiles=[{id:'same',runner:'claude' as const,args:[],env:[{name:'MCP_TOKEN',value:'PUBLIC_BASE_TOKEN',secret:false},{name:'ANTHROPIC_API_KEY',value:'UNRELATED_MODEL_KEY',secret:false}]}];
  contexts=capabilityScanContexts(home,{HOME:home,MCP_TOKEN:'PUBLIC_BASE_TOKEN'},profiles,[join(root,'project')]);expect(svc.scan().items).toHaveLength(1);
  contexts=capabilityScanContexts(home,{HOME:home,MCP_TOKEN:'PUBLIC_BASE_TOKEN'},[...profiles,{id:'secret',runner:'claude',args:[],env:[{name:'MCP_TOKEN',value:null,secret:true}]}],[join(root,'project')]);expect(svc.scan().items).toHaveLength(2);expect(svc.list().items.every(x=>x.status==='conflict')).toBe(true);
});

it('fresh launch resolution observes native source disable and deny without waiting for another scan',()=>{
  const home=join(root,'home');file(join(home,'.claude.json'),JSON.stringify({mcpServers:{echo:{command:'/usr/bin/true'}}}));svc.scan();const id=svc.adoptAll().items[0].id;
  file(join(home,'.claude/settings.json'),JSON.stringify({disabledMcpServers:['echo']}));expect(svc.resolveMcpSource(id)?.source.enabled).toBe(false);
  file(join(home,'.claude/settings.json'),JSON.stringify({permissions:{deny:['mcp__echo__write'],ask:['mcp__echo__inspect']}}));expect(svc.resolveMcpSource(id)?.source).toMatchObject({disabledTools:['write'],promptTools:['inspect']});
});
it('reports missing variables and suspicious URL without exposing their values or starting a process',()=>{
  file(join(root,'home/.claude.json'),JSON.stringify({mcpServers:{missing:{command:'/usr/bin/true',args:['${ABSENT}']},privateUrl:{url:'https://public.example.test/mcp?x-api-key=PRIVATE_URL_VALUE'},sse:{type:'sse',url:'https://public.example.test/sse'}}}));
  const view=svc.scan();expect(view.items.find(x=>x.name==='missing')?.targetIssues?.codex).toContain('缺少变量 ABSENT');expect(view.items.find(x=>x.name==='privateUrl')?.targetIssues?.codex).toContain('URL 含凭据');expect(view.items.find(x=>x.name==='sse')?.targetIssues?.codex).toContain('不支持 SSE');expect(JSON.stringify(view)).not.toContain('PRIVATE_URL_VALUE');
});

it('does not merge source profiles with different second-stage Claude header references',()=>{
 const home=join(root,'home');file(join(home,'.claude.json'),JSON.stringify({mcpServers:{http:{url:'https://public.example.test/mcp',headers:{Authorization:'${A}'}}}}));
 contexts=capabilityScanContexts(home,{HOME:home,A:'${B}',B:'PUBLIC_BASE_B'},[{id:'other',runner:'claude',args:[],env:[{name:'B',value:'PUBLIC_PROFILE_B',secret:false}]}],[join(root,'project')]);
 expect(svc.scan().items).toHaveLength(2);expect(svc.list().items.every(x=>x.status==='conflict')).toBe(true);
});

it('deduplicates rejected shared declarations without merging independent inline sources',()=>{
 const home=join(root,'home');file(join(home,'.claude.json'),JSON.stringify({mcpServers:{url:{url:'https://public.example.test/mcp?x-api-key=PUBLIC_URL_TOKEN'},app:{command:'/public/Other.app/Contents/MacOS/helper'}}}));
 contexts=capabilityScanContexts(home,{HOME:home},[{id:'same-file',runner:'claude',args:[],env:[]}],[join(root,'project')]);const rows=svc.scan().items;expect(rows).toHaveLength(2);expect(rows.some(x=>x.status==='conflict')).toBe(false);expect(rows.every(x=>Object.keys(x.targetIssues??{}).length===2)).toBe(true);
 contexts.push({...contexts[0],configurationId:'inline-a',args:['--mcp-config',JSON.stringify({mcpServers:{inline:{command:'/public/Other.app/Contents/MacOS/helper'}}})]},{...contexts[0],configurationId:'inline-b',args:['--mcp-config',JSON.stringify({mcpServers:{inline:{command:'/public/Other.app/Contents/MacOS/helper'}}})]});
 expect(svc.scan().items.filter(x=>x.name==='inline')).toHaveLength(2);
});
