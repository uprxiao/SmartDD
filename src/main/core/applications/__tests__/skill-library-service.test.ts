import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,readlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
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
afterEach(async()=>{await f?.cleanup();});

describe('M11 R16 Skill library delivery',()=>{
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
