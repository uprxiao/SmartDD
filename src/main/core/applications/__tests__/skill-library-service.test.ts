import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,readlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CurrentApplicationAuthorization} from '../current-authorization';
import {resolveApplicationTerminalSource} from '../terminal-sources';
import {SkillLibraryService} from '../skill-library-service';
import {builtinCapabilityDeliveryAdapters} from '../capability-delivery-adapters';
import {cliFixture} from './cli-fixture';

/** M11 R16 / T39, T44, T45: one library copy per application Skill, linked for agents that do not read the shared directory. */
let f:Awaited<ReturnType<typeof cliFixture>>,library:SkillLibraryService;
const shared=()=>join(f.home,'.agents/skills'),claude=()=>join(f.home,'.claude/skills');
const ours=(dir:string)=>existsSync(dir)?readdirSync(dir).filter(n=>n.startsWith('willyou-')).sort():[];
beforeEach(async()=>{
 f=await cliFixture();
 library=new SkillLibraryService(f.store,f.applications.builtin,{home:f.home,targets:()=>builtinCapabilityDeliveryAdapters.libraryTargets(),added:appId=>{const s=f.applications.selections.catalogState(appId as 'mail');return s.added&&s.enabled;}});
});
afterEach(async()=>{vi.restoreAllMocks();await f?.cleanup();});

describe('M11 R16 Skill library delivery',()=>{
 it.each(['migration','uninstalled'] as const)('retires only owned legacy Zentao Skills and blocks its old entrypoints after %s',async owner=>{
  await f.applications.selections.setAdded('zentao',true,0);await f.applications.selections.select({projectId:'p1',appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:null}});expect(new CurrentApplicationAuthorization(f.store,f.applications.builtin).selectedApps('p1').some(a=>a.appId==='zentao')).toBe(true);library.sync();expect(ours(shared()).some(n=>n.startsWith('willyou-zentao-'))).toBe(true);const mail=ours(shared()).filter(n=>n.startsWith('willyou-mail-'));
  if(owner==='migration')f.sqlite.prepare('INSERT INTO plugin_builtin_migrations VALUES(?,?,?,?,?,?)').run('zentao',1,'a'.repeat(64),'b'.repeat(64),'[]','old');
  else f.sqlite.prepare("INSERT INTO plugin_installations VALUES('zentao',NULL,0,0,1,'old')").run();
  const sender={...f.sender,senderFrame:null} as unknown as Parameters<typeof f.applications.catalog>[0];const removed=library.sync();expect(removed.removed.some(n=>n.startsWith('willyou-zentao-'))).toBe(true);expect(ours(shared())).toEqual(mail);expect(ours(claude())).toEqual(mail);expect(f.applications.catalog(sender).some(a=>a.appId==='zentao')).toBe(false);expect(f.applications.catalog(sender).some(a=>a.appId==='mail')).toBe(true);
  const selected=new CurrentApplicationAuthorization(f.store,f.applications.builtin).selectedApps('p1');expect(selected.some(a=>a.appId==='zentao')).toBe(false);expect(selected.some(a=>a.appId==='mail')).toBe(true);
  const reads=vi.spyOn(f.applications.contexts,'withUi'),management=vi.spyOn(f.applications.contexts,'withManagement');
  const oldEntries=[()=>f.applications.zentaoWork(sender,'p1',{} as never),()=>f.applications.zentaoObject(sender,'p1',{} as never),()=>f.applications.zentaoResource(sender,'p1',{}),()=>f.applications.invokeCapability(sender,'p1','zentao','zentao.object.list',{}),()=>f.applications.listConnections(sender,'zentao'),()=>f.applications.projectSettings(sender,'p1','zentao'),()=>f.applications.setEnabled(sender,'zentao',true,1)];
  for(const invoke of oldEntries)expect(invoke).toThrow('外部插件');expect(reads).not.toHaveBeenCalled();expect(management).not.toHaveBeenCalled();
 });
 it('revokes an already prepared legacy terminal Skill proof as soon as migration takes ownership',async()=>{
  await f.applications.selections.setAdded('zentao',true,0);await f.applications.selections.select({projectId:'p1',appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:null}});
  // Native discovery is a controlled old-session fixture; SQL, policy and proof revalidation are real.
  const sender={...f.sender,senderFrame:null} as unknown as Parameters<typeof f.applications.catalog>[0],base=f.runs.bridgePreparation(f.run.runId),pack=f.plan('codex').packages[0],snapshot=structuredClone(base.snapshot),skills=[{...pack.skills[0],skillId:'bug-analysis'}];
  if(snapshot.schema===3)snapshot.packages=[{...pack,entry:'mcp',capabilityContractMajors:{'zentao.object.list':1},skills}];else snapshot.packages=[{...pack,skills}];const context={...base,snapshot};
  f.sqlite.prepare('INSERT INTO tasks(id,project_id,cwd,runner,title,created_at,updated_at) VALUES(?,?,?,?,?,1,1)').run(base.run.taskId,'p1',f.cwd,'codex','Synthetic old terminal');vi.spyOn(f.runs,'inputContext').mockImplementation((taskId,ptyId)=>taskId===base.run.taskId&&ptyId===f.run.ptyId?context:null);vi.spyOn(f.applications.sessionDiagnostics,'inspect').mockResolvedValue({applications:[{appId:'zentao',resourceState:'verified'}],currentRun:{id:base.run.runId,preparation:{state:'prepared'}}} as never);
  const input={projectId:'p1',target:{taskId:base.run.taskId,ptyId:f.run.ptyId},source:{kind:'skill' as const,appId:'zentao' as const,skillId:'bug-analysis'}},proof=await resolveApplicationTerminalSource(f.applications,f.runs,sender,input);expect(proof.text).toContain('Bug');expect(()=>proof.assert()).not.toThrow();
  f.sqlite.prepare('INSERT INTO plugin_builtin_migrations VALUES(?,?,?,?,?,?)').run('zentao',1,'a'.repeat(64),'b'.repeat(64),'[]','old');expect(()=>proof.assert()).toThrow('外部插件');await expect(resolveApplicationTerminalSource(f.applications,f.runs,sender,input)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
 });
 it('writes one unversioned WillYou copy per added application Skill and links it for Claude Code',()=>{
  const names=f.applications.builtin.packages.get(f.applications.builtin.packages.active('mail')!.packageHash).manifest.skills.map(s=>'willyou-mail-'+s.id).sort();
  const result=library.sync();
  expect(result.written.sort()).toEqual(names);expect(result.conflicts).toEqual([]);
  expect(ours(shared())).toEqual(names);
  for(const name of names){
   const text=readFileSync(join(shared(),name,'SKILL.md'),'utf8');expect(text).toContain('name: '+name);expect(text).toContain('（仅在 WillYou 任务中使用）');expect(text).not.toContain('{{WILLYOU_');
   expect(JSON.parse(readFileSync(join(shared(),name,'.willyou-owned.json'),'utf8'))).toMatchObject({owner:'WillYou',name});
   const link=join(claude(),name);expect(lstatSync(link).isSymbolicLink()).toBe(true);expect(readlinkSync(link)).toBe(join(shared(),name));
  }
  // A second sync, as after any later application change, rewrites nothing and adds no copies.
  const again=library.sync();expect(again.written).toEqual([]);expect(again.unchanged.sort()).toEqual(names);expect(ours(shared())).toEqual(names);
 });
 it('removes the copy and every link when the application is removed',async()=>{
  library.sync();
  await f.applications.selections.setAdded('mail',false,f.applications.selections.catalogState('mail').revision);
  const result=library.sync();expect(result.removed.length).toBeGreaterThan(0);
  expect(ours(shared())).toEqual([]);expect(ours(claude())).toEqual([]);
 });
 it('delivers bundled standard Skills as willyou-<skill> for every session',()=>{
  const withStandard=new SkillLibraryService(f.store,f.applications.builtin,{home:f.home,targets:()=>builtinCapabilityDeliveryAdapters.libraryTargets(),added:()=>false,standardSkills:()=>[{skillId:'remote-password-ssh',files:{'SKILL.md':Buffer.from('---\nname: remote-password-ssh\ndescription: SSH helper\n---\nbody\n'),'scripts/run.sh':Buffer.from('echo\n')}}]});
  expect(withStandard.sync().written).toEqual(['willyou-remote-password-ssh']);
  const text=readFileSync(join(shared(),'willyou-remote-password-ssh','SKILL.md'),'utf8');expect(text).toContain('name: willyou-remote-password-ssh');expect(text).toContain('SSH helper（仅在 WillYou 任务中使用）');
  expect(readFileSync(join(shared(),'willyou-remote-password-ssh','scripts/run.sh'),'utf8')).toBe('echo\n');expect(lstatSync(join(claude(),'willyou-remote-password-ssh')).isSymbolicLink()).toBe(true);
 });
 it('leaves a same-named user directory untouched and reports the conflict',()=>{
  const name=library.skills()[0].name,user=join(shared(),name);mkdirSync(user,{recursive:true});writeFileSync(join(user,'SKILL.md'),'user owned\n');
  const result=library.sync();
  expect(result.conflicts).toContainEqual({name,location:shared()});expect(library.conflicts()).toContainEqual({name,location:shared()});
  expect(readFileSync(join(user,'SKILL.md'),'utf8')).toBe('user owned\n');expect(existsSync(join(claude(),name))).toBe(false);
 });
});

describe('M13 actual Claude configuration roots share the verified standard library',()=>{
 const name='willyou-remote-password-ssh';
 function standardSource(active:()=>boolean=()=>true){return new SkillLibraryService(f.store,f.applications.builtin,{home:f.home,targets:()=>builtinCapabilityDeliveryAdapters.libraryTargets(),added:()=>false,standardSkills:()=>active()?[{skillId:'remote-password-ssh',files:{'SKILL.md':Buffer.from('---\nname: remote-password-ssh\ndescription: SSH fixture\n---\nsource v1\n'),'scripts/relative.py':Buffer.from('print("PUBLIC")\n')}}]:[]});}
 it('links two independent Provider roots to the same current library without changing an unrelated user Skill',()=>{
  const service=standardSource(),a=join(f.root,'providers/a/claude'),b=join(f.root,'providers/b/claude');mkdirSync(join(a,'skills/user-skill'),{recursive:true});writeFileSync(join(a,'skills/user-skill/SKILL.md'),'USER ORIGINAL');
  service.sync(a);service.sync(b);
  for(const root of[a,b]){const target=join(root,'skills',name);expect(lstatSync(target).isSymbolicLink()).toBe(true);expect(readlinkSync(target)).toBe(join(shared(),name));expect(readFileSync(join(target,'scripts/relative.py'),'utf8')).toBe('print("PUBLIC")\n');}
  expect(readFileSync(join(a,'skills/user-skill/SKILL.md'),'utf8')).toBe('USER ORIGINAL');expect(ours(shared())).toEqual([name]);
 });
 it('does not overwrite a same-name private-root directory and reports its concrete location',()=>{
  const service=standardSource(),root=join(f.root,'providers/conflict/claude'),target=join(root,'skills',name);mkdirSync(target,{recursive:true});writeFileSync(join(target,'SKILL.md'),'USER PRIVATE');
  expect(service.sync(root).conflicts).toContainEqual({name,location:join(root,'skills')});expect(lstatSync(target).isDirectory()).toBe(true);expect(readFileSync(join(target,'SKILL.md'),'utf8')).toBe('USER PRIVATE');
 });
 it('removes only its private link on the next run after a global disable and restores it on enable',()=>{
  let enabled=true;const service=standardSource(()=>enabled),root=join(f.root,'providers/disabled/claude');service.sync(root);expect(lstatSync(join(root,'skills',name)).isSymbolicLink()).toBe(true);enabled=false;service.sync(root);expect(()=>lstatSync(join(root,'skills',name))).toThrow();expect(ours(shared())).toEqual([]);enabled=true;service.sync(root);expect(readFileSync(join(root,'skills',name,'SKILL.md'),'utf8')).toContain('source v1');
 });
 it('rejects a relative state root before touching the shared library',()=>{
  const service=standardSource();expect(()=>service.sync('relative-claude')).toThrow('绝对路径');expect(ours(shared())).toEqual([]);
 });
});
