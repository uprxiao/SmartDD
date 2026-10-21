from pathlib import Path
import json,hashlib,datetime,shutil
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-capability-conflicts-ba-20261022')
files=json.loads((e/'implementation-files.json').read_text());(e/'fix1-inputs.json').write_text(json.dumps([{'path':p,'sha256':hashlib.sha256((w/p).read_bytes()).hexdigest()} for p in files],indent=2)+'\n')
p=w/'src/main/core/applications/__tests__/task-capability-launcher.test.ts';s=p.read_text();anchor="describe('per-application availability does not withdraw healthy fixed tools',()=>{"
assert s.count(anchor)==1
snippet='''
 it.each((['claude-code','codex'] as const).flatMap(runner=>(['project-mcp','standard-skill'] as const).map(kind=>({runner,kind}))))('keeps the live loading scope fixed and restores original capability only after stopping: $runner $kind',async({runner,kind})=>{
  await selectBoth();const profile=runner==='codex'?codexId:claudeId,started=await create(profile);await stopForSwitchFixture(started,runner);const original=await managed.sessions.get(started.task.id),target=original.snapshot.standardSkills[0],name=dirname(target.projectionPath).split('/').at(-1)!,mcp=original.snapshot.mcp.find(m=>m.kind==='legacy-project-context')!,file=kind==='project-mcp'?join(cwd,runner==='codex'?'.codex/config.toml':'.mcp.json'):join(cwd,runner==='codex'?'.agents':'.claude','skills','user-owned-standard-conflict','SKILL.md'),text=kind==='project-mcp'?(runner==='codex'?'[mcp_servers.'+mcp.serverName+']\\ncommand="python3"\\nargs=["-c","pass"]\\n':JSON.stringify({mcpServers:{[mcp.serverName]:{command:'python3',args:['-c','pass']}}})):'---\\nname: '+name+'\\ndescription: User owned.\\n---\\n';mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);
  let running:Awaited<ReturnType<typeof create>>|undefined;
  try{running=await tasks.open({taskId:started.task.id});const narrowed=structuredClone(running.task.runtimeSnapshot!),runId=narrowed.runId;expect((await appTools().list(runId)).tools).toHaveLength(17);if(kind==='project-mcp')expect(narrowed.mcp).toEqual([]);else expect(narrowed.skills.filter(s=>s.enabled).map(s=>s.path)).not.toContain(target.projectionPath);rmSync(file);expect((await tasks.get(started.task.id)).runtimeSnapshot).toEqual(narrowed);if(runner==='claude-code'&&kind==='standard-skill'){expect(existsSync(target.projectionPath)).toBe(false);await expect(managed.projector.claude(started.task.id)).rejects.toMatchObject({code:'RESOURCE_BUSY'});}tasks.kill(running.task.id);await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopped'));running=await tasks.open({taskId:started.task.id});expect(running.task.runtimeSnapshot!.skills.filter(s=>s.enabled).map(s=>s.path)).toContain(target.projectionPath);expect(running.task.runtimeSnapshot!.mcp.map(m=>m.name)).toContain(mcp.serverName);expect((await managed.sessions.get(started.task.id)).snapshot).toEqual(original.snapshot);expect(running.task.nativeSessionId).toBe(started.task.nativeSessionId);}
  finally{if(running){tasks.kill(running.task.id);await vi.waitFor(()=>expect(managed.runs.get(running!.task.runtimeSnapshot!.runId).state).toBe('stopped'));}}
 },30000);
 it('keeps a live user-plugin conflict at zero Apps and restores original Skills and App bridge after stopping',async()=>{
  await selectBoth();const seed=await create(claudeId),nativeId=await stopForSwitchFixture(seed,'claude-code'),original=await managed.sessions.get(seed.task.id),plugin=join(root,'user-owned-smartdd-session-plugin'),file=join(plugin,'.claude-plugin/plugin.json');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify({name:'smartdd-session'}));const profile=profiles.get(claudeId),executable=profiles.resolve(claudeId).command,setArgs=(args:string[])=>profiles.update(claudeId,{name:profile.name,runner:'claude',executable,args,env:[],color:null,isDefault:false});setArgs(['--plugin-dir',plugin]);let running:Awaited<ReturnType<typeof create>>|undefined;
  try{running=await tasks.open({taskId:seed.task.id});const old=running.task.runtimeSnapshot!.runId;expect(managed.runs.assertActive(old).applicationScope).toEqual([]);setArgs([]);expect((await appTools().list(old)).tools).toEqual([]);for(const p of original.snapshot.packages)for(const s of p.skills)expect(existsSync(s.projectionPath)).toBe(false);await expect(managed.projector.claude(seed.task.id)).rejects.toMatchObject({code:'RESOURCE_BUSY'});tasks.kill(seed.task.id);await vi.waitFor(()=>expect(managed.runs.get(old).state).toBe('stopped'));running=await tasks.open({taskId:seed.task.id});expect((await appTools().list(running.task.runtimeSnapshot!.runId)).tools).toHaveLength(17);expect(running.task.runtimeSnapshot!.skills.filter(s=>s.enabled)).toHaveLength(original.snapshot.standardSkills.length);expect((await managed.sessions.get(seed.task.id)).snapshot).toEqual(original.snapshot);expect(running.task.nativeSessionId).toBe(nativeId);expect(readFileSync(file,'utf8')).toBe(JSON.stringify({name:'smartdd-session'}));}
  finally{if(running){tasks.kill(seed.task.id);await vi.waitFor(()=>expect(managed.runs.get(running!.task.runtimeSnapshot!.runId).state).toBe('stopped'));}}
 },30000);
 it.each(['file','directory'] as const)('preserves explicit user disabling of one Codex standard Skill by %s without withdrawing Apps or other standards',async kind=>{
  await selectBoth();const seed=await create(codexId);await stopForSwitchFixture(seed,'codex');const original=await managed.sessions.get(seed.task.id),target=original.snapshot.standardSkills[0],file=join(cwd,'.codex/config.toml'),text='[skills]\\nconfig = [{ path = '+JSON.stringify(kind==='file'?target.projectionPath:dirname(target.projectionPath))+', enabled = false, note = "user original" }]\\n';mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);let running:Awaited<ReturnType<typeof create>>|undefined;
  try{running=await tasks.open({taskId:seed.task.id});expect(running.task.runtimeSnapshot!.skills.filter(s=>s.enabled).map(s=>s.path)).toEqual(original.snapshot.standardSkills.filter(s=>s.skillId!==target.skillId).map(s=>s.projectionPath));expect((await appTools().list(running.task.runtimeSnapshot!.runId)).tools).toHaveLength(17);expect(launchFlags()).toContainEqual({path:target.projectionPath,enabled:false,note:'user original'});expect(readFileSync(file,'utf8')).toBe(text);expect((await managed.sessions.get(seed.task.id)).snapshot).toEqual(original.snapshot);}
  finally{if(running){tasks.kill(seed.task.id);await vi.waitFor(()=>expect(managed.runs.get(running!.task.runtimeSnapshot!.runId).state).toBe('stopped'));}}
 },30000);
'''
# projectors are private in the service, use the real public static source service
snippet=snippet.replace('managed.projector.claude(',"new SessionCapabilityProjector(support.store,managed.sessions).claude(")
if "import {SessionCapabilityProjector}" not in s:s="import {SessionCapabilityProjector} from '../session-projector';\n"+s
# Verify actual support service fixture name below before executing tests.
s=s.replace(anchor,anchor+snippet);p.write_text(s);(e/'recovery-tests.txt').write_text(snippet)
# Focused adversarial and compatibility tests use actual projected source trees.
p=w/'src/main/core/applications/__tests__/claude-projection-selection.test.ts'
p.write_text('''import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {claudeProjectionSelection} from '../claude-projection-selection';
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
  if(kind==='partial-app-group')s.packages[0].skills.push({...s.packages[0].skills[0],skillId:'second',nativeName:'second',projectionPath:s.packages[0].skills[0].projectionPath.replace(/[^/]+\\/SKILL.md$/,'second/SKILL.md')});
  expect(()=>claudeProjectionSelection(manifest,s)).toThrow();
 });
 it('plans Codex standard exclusion against the actual complete catalog and refuses foreign or duplicate paths',async()=>{
  const s=f.plan('codex');await f.sessions.create(s,f.home);const request=await f.request(s),plan=f.adapters.plan(s.adapterBinding.hash,{...request,standardSkillScope:[]}),flags=(parseToml(plan.args.find(a=>a.startsWith('skills.config='))!).skills as {config:unknown[]}).config;expect(flags).toContainEqual({path:s.standardSkills[0].projectionPath,enabled:false});expect(flags).toContainEqual({path:s.packages[0].skills[0].projectionPath,enabled:true});expect(()=>f.adapters.plan(s.adapterBinding.hash,{...request,standardSkillScope:['/private/user/SKILL.md']})).toThrow();expect(()=>f.adapters.plan(s.adapterBinding.hash,{...request,standardSkillScope:[s.standardSkills[0].projectionPath,s.standardSkills[0].projectionPath]})).toThrow();
 });
 it('refuses a Claude subset request without a run-bound physical delivery even with a real full original plugin',async()=>{
  const s=f.plan();await f.sessions.create(s,f.home);const input=await f.request(s);expect(()=>f.adapters.plan(s.adapterBinding.hash,{...input,standardSkillScope:[]})).toThrow();expect(f.adapters.plan(s.adapterBinding.hash,input).agentId).toBe('claude-code');
 });
});
''')
files.append(str(p.relative_to(w)));(e/'implementation-files.json').write_text(json.dumps(files,indent=2)+'\n');print('added 7 lifecycle/native-config and 12 boundary cases')
