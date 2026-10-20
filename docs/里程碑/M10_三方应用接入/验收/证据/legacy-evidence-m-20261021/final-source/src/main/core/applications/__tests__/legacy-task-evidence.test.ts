import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,lstatSync,linkSync,symlinkSync,realpathSync,chmodSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {CapabilityService,MCP_CAPABILITY,type PreparedRuntime} from '../../capabilities/capability-service';
import * as assets from '../../capabilities/assets';
import {LegacyTaskEvidenceReader,type LegacyTaskIdentity,type LegacySkillVersion} from '../legacy-task-evidence';
let root:string,home:string,cwd:string,projectId:string,sqlite:Database.Database,capabilities:CapabilityService,reader:LegacyTaskEvidenceReader;
const runtimes:PreparedRuntime[]=[];const services:CapabilityService[]=[];
let deps:ConstructorParameters<typeof CapabilityService>[0];
beforeEach(()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m4-evidence-')));home=join(root,'home');cwd=join(root,'project');mkdirSync(home);mkdirSync(cwd);
 sqlite=new Database(join(root,'private.sqlite'));runBundledMigrations(sqlite);const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);projectId=projects.createProject({name:'M4 private migration evidence',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;
 deps={db,projects,secrets,userData:root};capabilities=new CapabilityService(deps);services.push(capabilities);reader=new LegacyTaskEvidenceReader(join(root,'capabilities'),home,id=>sqlite.prepare('SELECT id,skill_id AS skillId,name,version,hash FROM skill_versions WHERE id=?').get(id) as LegacySkillVersion|undefined);
});
afterEach(()=>{vi.restoreAllMocks();for(const r of runtimes.splice(0))r.release();for(const s of services.splice(0))s.dispose();sqlite.close();rmSync(root,{recursive:true,force:true});});
function prepare(runner:LegacyTaskIdentity['runner']='codex',service=capabilities,previous?:PreparedRuntime['snapshot']){const taskId=randomUUID(),runtime=service.prepare({projectId,taskId,runner:runner==='codex'?'codex':'claude',cwd,home,profileArgs:[],previous});runtimes.push(runtime);return{runtime,identity:{taskId,projectId,runner},snapshot:runtime.snapshot};}
function files(directory=root):Record<string,string>{return Object.fromEntries(readdirSync(directory).flatMap(name=>{const p=join(directory,name);if(lstatSync(p).isDirectory())return Object.entries(files(p)).map(([key,h])=>[name+'/'+key,h]);return[[name,assets.sha256(readFileSync(p))]];}));}
function inspect(value:ReturnType<typeof prepare>){return reader.inspect(value.identity,value.snapshot);}
function editManifest(value:ReturnType<typeof prepare>,change:(manifest:Record<string,any>)=>void){const p=value.snapshot.manifestPath,m=JSON.parse(readFileSync(p,'utf8'));change(m);writeFileSync(p,JSON.stringify(m,null,2)+'\n');}
describe('read-only original M4 task evidence, not a migration or run authorization',()=>{
 it.each(['claude-code','codex'] as const)('reads actual %s M4 output without rewriting paths, names or bytes',runner=>{
  const value=prepare(runner),before=files(),result=inspect(value);expect(result.state).toBe('verified');if(result.state!=='verified')throw Error('missing proof');
  expect(result.evidence).toMatchObject({...value.identity,pluginName:runner==='claude-code'?'smartdd':null});expect(result.evidence.runtimeHash).toBe(capabilities.runtimeIdentity().hash);expect(result.evidence.skills.map(s=>s.projectionPath)).toEqual(value.snapshot.skills.map(s=>s.path));expect(result.evidence.skills.map(s=>s.nativeName)).toEqual(value.snapshot.skills.map(s=>s.name));expect(result.evidence.mcp.map(m=>m.name)).toEqual(value.snapshot.mcp.map(m=>m.name));expect(files()).toEqual(before);expect(reader.verify(result.evidence)).toBe(true);expect(reader.verify({...result.evidence})).toBe(false);
  if(runner==='codex')expect(result.evidence.skills[0].projectionPath).toContain('smartdd-'+value.snapshot.skills[0].skillId+'-');else expect(result.evidence.pluginRoot).toBe(join(dirname(value.snapshot.manifestPath),'plugin'));
 });
 it('reads the actual original frontmatter name independently of a friendly database title',()=>{
  const bundles=assets.BUNDLED_SKILLS.map(skill=>({...skill,name:'Friendly title '+skill.id})),service=new CapabilityService({...deps,userData:join(root,'friendly-userdata'),bundles});services.push(service);
  for(const skill of bundles)sqlite.prepare('UPDATE skill_versions SET name=? WHERE id=?').run(skill.name,skill.id+':'+skill.hash);mkdirSync(join(root,'friendly-home'));
  const taskId=randomUUID(),runtime=service.prepare({projectId,taskId,runner:'codex',cwd,home:join(root,'friendly-home'),profileArgs:[]});runtimes.push(runtime);
  const privateReader=new LegacyTaskEvidenceReader(join(root,'friendly-userdata/capabilities'),join(root,'friendly-home'),id=>sqlite.prepare('SELECT id,skill_id AS skillId,name,version,hash FROM skill_versions WHERE id=?').get(id) as LegacySkillVersion|undefined),result=privateReader.inspect({taskId,projectId,runner:'codex'},runtime.snapshot);
  expect(result).toMatchObject({state:'verified',evidence:{skills:expect.arrayContaining([expect.objectContaining({nativeName:assets.BUNDLED_SKILLS[0].name})])}});expect(runtime.snapshot.skills[0].name).toMatch(/^Friendly title/);
 });
 it('takes original runtime identity from its owned manifest rather than the current runtime',()=>{
  const original=assets.runtimeFiles(),spy=vi.spyOn(assets,'runtimeFiles').mockReturnValue(Object.fromEntries(Object.entries(original).map(([path,text])=>[path,text+'\n# private previous M4 version fixture\n']))),old=new CapabilityService(deps);services.push(old);const value=prepare('codex',old);spy.mockRestore();expect(old.runtimeIdentity().hash).not.toBe(capabilities.runtimeIdentity().hash);const result=inspect(value);expect(result).toMatchObject({state:'verified',evidence:{runtimeHash:old.runtimeIdentity().hash}});
 });
 it('retains the original installed Skill version after another version becomes current',()=>{
  const value=prepare(),old=value.snapshot.skills[0],bundles=assets.BUNDLED_SKILLS.map(s=>{if(s.id!==old.skillId)return s;const files={...s.files,'references/previous-fixture.txt':'private next version'};return{...s,version:'1.1.0',files,hash:assets.treeHash(files)};}),next=new CapabilityService({...deps,bundles});services.push(next);next.upgrade(old.skillId);expect(next.list(projectId).find(s=>s.id===old.skillId)!.current.hash).not.toBe(old.hash);expect(inspect(value)).toMatchObject({state:'verified',evidence:{skills:expect.arrayContaining([expect.objectContaining({versionId:old.versionId,hash:old.hash})])}});
 });
 it('preserves a previously recorded MCP server name that is not the current generated prefix',()=>{
  const first=prepare('claude-code'),value=prepare('claude-code',capabilities,{...first.snapshot,mcp:[{name:'original_context_v0',loaded:'unverified'}]});expect(inspect(value)).toMatchObject({state:'verified',evidence:{mcp:[{name:'original_context_v0'}]}});
 });
 it('does not invent current code identity after the original run manifest has been removed',()=>{
  const value=prepare();value.runtime.release();const before=files();expect(inspect(value)).toEqual({state:'unknown',code:'LEGACY_MANIFEST_MISSING'});expect(files()).toEqual(before);
 });
 it('retains disabled original versions without materializing a projection or MCP',()=>{
  for(const skill of capabilities.list(projectId))capabilities.setEnabled(projectId,skill.id,false);capabilities.setEnabled(projectId,MCP_CAPABILITY,false);const value=prepare(),before=files(),result=inspect(value);expect(result).toMatchObject({state:'verified',evidence:{pluginRoot:null,mcp:[],skills:expect.arrayContaining([expect.objectContaining({enabled:false,nativeName:null,projectionPath:''})])}});expect(files()).toEqual(before);
 });
 it.each(['project','task','manifest-path','audit-path','extra-metadata','version-record','mcp-name'] as const)('rejects inconsistent original %s identity',kind=>{
  const value=prepare('claude-code');if(kind==='project')value.snapshot.projectId='another-project';if(kind==='task')value.identity.taskId=randomUUID();if(kind==='manifest-path')value.snapshot.manifestPath=join(root,'outside.json');if(kind==='audit-path')value.snapshot.auditPath=join(root,'other-audit');if(kind==='extra-metadata')Object.assign(value.snapshot,{approved:true});if(kind==='version-record')value.snapshot.skills[0].version='0.0.0';if(kind==='mcp-name')value.snapshot.mcp[0].name='another_name';
  expect(()=>inspect(value)).toThrow();
 });
 it.each(['source','projection','run-file','manifest-hash','manifest-extra-file','runtime-missing','owner','executable-source','mcp-command','extra-plugin-skill'] as const)('refuses a changed or incomplete %s without repair',kind=>{
  const value=prepare('claude-code'),runRoot=dirname(value.snapshot.manifestPath),skill=value.snapshot.skills[0];
  if(kind==='source')writeFileSync(join(root,'capabilities/packages',skill.skillId,skill.hash,'SKILL.md'),'changed source');
  if(kind==='projection')writeFileSync(skill.path,'changed projection');
  if(kind==='executable-source')chmodSync(skill.path,0o700);
  if(kind==='run-file')writeFileSync(join(runRoot,'context.json'),'{}');
  if(kind==='manifest-hash')editManifest(value,m=>m.files[Object.keys(m.files)[0]]='0'.repeat(64));
  if(kind==='manifest-extra-file')editManifest(value,m=>m.files[join(root,'private-never-read')]='0'.repeat(64));
  if(kind==='runtime-missing')rmSync(join(capabilities.runtimeIdentity().path,'launch.py'));
  if(kind==='owner')writeFileSync(join(runRoot,'.smartdd-owned.json'),JSON.stringify({owner:'someone-else',schema:1}));
  if(kind==='mcp-command'){const p=join(runRoot,'mcp.json'),v=JSON.parse(readFileSync(p,'utf8'));v.mcpServers[value.snapshot.mcp[0].name].command='/usr/bin/false';writeFileSync(p,JSON.stringify(v));editManifest(value,m=>m.files[p]=assets.sha256(readFileSync(p)));}
  if(kind==='extra-plugin-skill'){const p=join(runRoot,'plugin/skills/unselected/SKILL.md');mkdirSync(dirname(p),{recursive:true});writeFileSync(p,'extra unselected skill');editManifest(value,m=>m.files[p]=assets.sha256(readFileSync(p)));}
  const before=files();expect(()=>inspect(value)).toThrow();expect(files()).toEqual(before);
 });
 it('does not follow a linked projection into a foreign directory',()=>{
  const value=prepare(),path=dirname(value.snapshot.skills[0].path),foreign=join(root,'foreign');mkdirSync(foreign);writeFileSync(join(foreign,'SKILL.md'),'foreign unowned bytes');rmSync(path,{recursive:true});symlinkSync(foreign,path);expect(()=>inspect(value)).toThrow();expect(readFileSync(join(foreign,'SKILL.md'),'utf8')).toBe('foreign unowned bytes');
 });
 it('rejects hard-linked source files and leaves both links intact',()=>{
  const value=prepare(),file=value.snapshot.skills[0].path,link=join(root,'hardlink');linkSync(file,link);expect(()=>inspect(value)).toThrow();expect(lstatSync(file).nlink).toBe(2);expect(readFileSync(file)).toEqual(readFileSync(link));
 });
 it('rechecks the original files and DB version record before reusing a branded proof',()=>{
  const value=prepare(),result=inspect(value);if(result.state!=='verified')throw Error('missing proof');const p=value.snapshot.skills[0].path;chmodSync(p,0o400);expect(reader.verify(result.evidence)).toBe(false);chmodSync(p,0o600);const next=inspect(value);if(next.state!=='verified')throw Error('missing proof');sqlite.prepare('UPDATE skill_versions SET version=? WHERE id=?').run('0.0.0',value.snapshot.skills[0].versionId);expect(reader.verify(next.evidence)).toBe(false);
 });
});
