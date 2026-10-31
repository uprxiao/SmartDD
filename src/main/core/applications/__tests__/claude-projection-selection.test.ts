import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {claudeProjectionSelection} from '../claude-projection-selection';
import {canonicalJson,digest} from '../manifest';
import {agentFixture} from './agent-fixture';
import {parse as parseToml} from 'smol-toml';
let f:Awaited<ReturnType<typeof agentFixture>>;
beforeEach(async()=>{f=await agentFixture();});afterEach(()=>f.cleanup());
describe('explicit standard Skill loading and original Claude projection compatibility',()=>{
 it('keeps the full original schema1 body while format2 omits only the specified standard and preserves all App assets',async()=>{
  const s=f.plan();await f.sessions.create(s,f.home);const original=await f.projector.claudeSource(s.taskId),subset=await f.projector.claudeSource(s.taskId,s.packages.map(p=>p.appId),false,[]);expect(original.bundle.manifest.metadata.formatVersion).toBe(1);expect(subset.bundle.manifest.metadata).toMatchObject({formatVersion:2,standardSkillScope:[]});expect(claudeProjectionSelection(subset.bundle.manifest,s)).toEqual({appIds:s.packages.map(p=>p.appId),standardSkillScope:[]});expect(()=>claudeProjectionSelection(subset.bundle.manifest,s,true)).toThrow();expect(subset.bundle.files['skills/'+s.packages[0].skills[0].nativeName+'/assets/data.bin']).toEqual(Buffer.from([0,255,192,128,10]));expect((await f.sessions.get(s.taskId)).snapshot).toEqual(s);f.projector.verify(subset.resource,s);
 });
 it.each(['old-format-omission','missing-explicit-scope','extra-hidden-skill','unknown-standard','duplicate-standard','wrong-source-hash','wrong-task','wrong-full-selection','partial-app-group'] as const)('rejects forged %s rather than treating it as a new full selection',async kind=>{
  const s=f.plan();await f.sessions.create(s,f.home);const source=await f.projector.claudeSource(s.taskId,s.packages.map(p=>p.appId),false,[]),manifest=structuredClone(source.bundle.manifest),m=manifest.metadata;
  if(kind==='old-format-omission'){m.formatVersion=1;delete m.standardSkillScope;}
  if(kind==='missing-explicit-scope')delete m.standardSkillScope;
  if(kind==='extra-hidden-skill')manifest.files.push({...manifest.files[0],path:'skills/foreign/SKILL.md'});
  if(kind==='unknown-standard')m.standardSkillScope=['/private/user/foreign/SKILL.md'];
  if(kind==='duplicate-standard')m.standardSkillScope=[s.standardSkills[0].projectionPath,s.standardSkills[0].projectionPath];
  if(kind==='wrong-source-hash')(m.sources as {sourceHash:string}[])[0].sourceHash='f'.repeat(64);
  if(kind==='wrong-task')m.taskId='another-task';
  if(kind==='wrong-full-selection')m.selectionHash='f'.repeat(64);
  if(kind==='partial-app-group'){s.packages[0].skills.push({...s.packages[0].skills[0],skillId:'second',nativeName:'second',projectionPath:s.packages[0].skills[0].projectionPath.replace(/[^/]+\/SKILL.md$/,'second/SKILL.md')});m.selectionHash=digest(canonicalJson({...s,native:{...s.native,sessionId:null}}));}
  expect(()=>claudeProjectionSelection(manifest,s)).toThrow();
 });
 it('plans Codex standard exclusion against the actual complete catalog and refuses foreign or duplicate paths',async()=>{
  const s=f.plan('codex');await f.sessions.create(s,f.home);const request=await f.request(s),plan=f.adapters.plan(s.adapterBinding.hash,{...request,standardSkillScope:[]}),flags=(parseToml(plan.args.find(a=>a.startsWith('skills.config='))!).skills as {config:unknown[]}).config;expect(flags).toContainEqual({path:s.standardSkills[0].projectionPath,enabled:false});expect(flags).toContainEqual({path:s.packages[0].skills[0].projectionPath,enabled:true});expect(()=>f.adapters.plan(s.adapterBinding.hash,{...request,standardSkillScope:['/private/user/SKILL.md']})).toThrow();expect(()=>f.adapters.plan(s.adapterBinding.hash,{...request,standardSkillScope:[s.standardSkills[0].projectionPath,s.standardSkills[0].projectionPath]})).toThrow();
 });
 it('refuses a Claude subset request without a run-bound physical delivery even with a real full original plugin',async()=>{
  const s=f.plan();await f.sessions.create(s,f.home);const input=await f.request(s);expect(()=>f.adapters.plan(s.adapterBinding.hash,{...input,standardSkillScope:[]})).toThrow();expect(f.adapters.plan(s.adapterBinding.hash,input).agentId).toBe('claude-code');
 });
});
