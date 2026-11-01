import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync, renameSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationNativeSkillName, capabilitySessionSnapshotSchema } from '@shared/application-session';
import type { ApplicationUiSender } from '../execution-context';
import type { RunContext } from '../run-registry';
import { NativeUserInputs } from '../native-user-inputs';
import { NativeUserMessages } from '../native-user-messages';
import { codexSkillReadEvidence } from '../codex-skill-read-evidence';
import { codexSkillDiscoveryEvidence } from '../codex-skill-discovery-evidence';
import { encodeClaudeDir } from '../../tasks/native-sessions';
const sender = { sender: { id: 101 }, senderFrame: { processId: 9, routingId: 1 } } as unknown as ApplicationUiSender;
let root: string, cwd: string, nativeRoot: string, file: string, current: RunContext, abort: AbortController, inputs: NativeUserInputs, messages: NativeUserMessages, now: number, failRun: boolean, currentChecks: number;
const text = '请发送唯一确定的草稿\n正文是中文😀';
function setup(runner: 'claude-code' | 'codex', version = runner === 'codex' ? '0.162.1' : '2.1.303', levels?: (hash: string, runner: string, version: string) => readonly string[]) {
  abort = new AbortController(); const hash = 'a'.repeat(64), id = randomUUID();
  const snapshot = capabilitySessionSnapshotSchema.parse({ schema: 2, taskId: 'owned-task', projectId: 'p1', runner, createdAt: new Date(now).toISOString(), adapterBinding: { id: runner, version: '1.0.0', hash, projectionFormatVersion: 1, nativeToolNames: {} }, native: { sessionId: id, stateRoot: nativeRoot, cwd }, agentAtCreation: { version, adapterRevision: 1 }, catalogGeneration: 'test', packages: [{ appId: 'mail', version: '1.0.0', packageHash: hash, hashAlgorithm: 'app-manifest-v1', hostApi: { min: 1, max: 1 }, dataApi: 1, runtimeHash: hash, toolContractMajors: {}, skills: [{ skillId: 'assistant', nativeName: applicationNativeSkillName('mail', 'assistant', hash), contentHash: hash, sourceRelativePath: 'skills/assistant', projectionPath: join(root, 'skill/SKILL.md') }], bindings: [], allowedOperations: ['mail.send'] }], standardSkills: [], mcp: [{ kind: 'applications', serverName: 'wy_one', protocolMajor: 1, runtimeHash: hash }], provenance: 'created' });
  current = { run: { runId: randomUUID(), taskId: snapshot.taskId, projectId: 'p1', runner, state: 'active', snapshotHash: hash, pid: 80001, processStartedAt: 'fixture-process', startedAt: new Date(now).toISOString(), endedAt: null }, snapshot, bindings: [], signal: abort.signal };
  inputs = new NativeUserInputs({ requireSender: value => { if (value !== sender) throw new Error('wrong sender'); }, current: target => target.taskId === 'owned-task' && target.ptyId === 'owned-pty' ? current : null, now: () => now });
  messages = new NativeUserMessages(inputs, id => { currentChecks++; if (failRun || id !== current.run.runId) throw new Error('not an owned active run'); return current; }, () => now, levels);
  messages.register(current.run.runId, version, abort.signal);
  const dir = runner === 'codex' ? join(nativeRoot, 'sessions/2026/10/01') : join(nativeRoot, 'projects', encodeClaudeDir(cwd)); mkdirSync(dir, { recursive: true });
  file = join(dir, runner === 'codex' ? 'rollout-old-date-' + id + '.jsonl' : id + '.jsonl'); writeFileSync(file, runner === 'codex' ? JSON.stringify({ type: 'session_meta', payload: { id, cwd, timestamp: new Date(now - 86400000).toISOString() } }) + '\n' : '');
}
function user(value = text): Record<string, any> {
  return current.snapshot.runner === 'codex' ? { timestamp: new Date(now).toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: value }] } } : { timestamp: new Date(now).toISOString(), type: 'user', sessionId: current.snapshot.native.sessionId, cwd, uuid: randomUUID(), isMeta: false, isSidechain: false, message: { role: 'user', content: [{ type: 'text', text: value }] } };
}
const write = (value: unknown, complete = true) => appendFileSync(file, JSON.stringify(value) + (complete ? '\n' : ''));
const input = (value = text) => inputs.observe(sender, { taskId: 'owned-task', ptyId: 'owned-pty' }, '\x1b[200~' + value + '\x1b[201~\r');
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'willyou-native-user-messages-')); cwd = join(root, 'project'); nativeRoot = join(root, 'native'); mkdirSync(cwd); mkdirSync(nativeRoot); now = Date.now(); failRun = false; currentChecks = 0; });
afterEach(() => { messages?.dispose(); inputs?.dispose(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
it('M11 S0b leaves Codex 0.166.0 chat authorization and Skill evidence closed even for an otherwise matching old-format log',async()=>{
 setup('codex','0.166.0');input();write(user());
 const skill=current.snapshot.packages[0].skills[0],target={id:skill.skillId,nativeName:skill.nativeName,path:skill.projectionPath,content:'Complete fixed skill\n'};
 const records=[
  {timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'read',arguments:JSON.stringify({cmd:"/bin/cat '"+target.path+"'"})}},
  {timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'function_call_output',call_id:'read',output:'Chunk ID: abc123\nWall time: 0.0100 seconds\nProcess exited with code 0\nOriginal token count: 5\nOutput:\n'+target.content}},
  {timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:'<skills_instructions>\n## Skills\n### Skill roots\n- `r0` = `'+join(root,'skill')+'`\n### Available skills\n- '+target.nativeName+': Controlled Skill. (file: r0/SKILL.md)\n</skills_instructions>'}]}},
 ];
 for(const record of records)write(record);
 // Positive controls prove the logs/targets would match the retained parser;
 // the new version must still receive no discovery/read or authorization proof.
 const lines=records.map(record=>JSON.stringify(record));
 expect(codexSkillReadEvidence(lines,[target],now,now)).toHaveLength(1);
 expect(codexSkillDiscoveryEvidence(lines,[target],now,now)).toHaveLength(1);
 expect(await messages.read(current.run.runId)).toMatchObject({status:'unsupported',messages:[],issueCode:'AGENT_ADAPTER_UNSUPPORTED'});
 expect(await messages.skillReads(current.run.runId,[target])).toEqual([]);
 expect(await messages.skillDiscoveries(current.run.runId,[target])).toEqual([]);
});
for (const runner of ['claude-code', 'codex'] as const) describe(runner + ' native user origin and trusted terminal bytes', () => {
  beforeEach(() => setup(runner));
  it('matches committed Unicode user content only after the actual owned PTY submission, including old rollout date', async () => {
    write(user()); expect(await messages.read(current.run.runId)).toMatchObject({ status: 'no-match' }); input();
    const result = await messages.read(current.run.runId); expect(result.status).toBe('matched'); const value = result.messages[0]; expect(value).toMatchObject({ text, runner, runId: current.run.runId, nativeSessionId: current.snapshot.native.sessionId }); expect(Object.isFrozen(value)).toBe(true); expect(await messages.verify(value)).toBe(true); expect(await messages.verify({ ...value })).toBe(false);
    const intent = randomUUID(); await messages.claim(value, intent); await expect(messages.claim(value, randomUUID())).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
  });
  it('rejects assistant, tool-result and synthetic/meta records even when their text matches accepted input', async () => {
    input(); const assistant = user(); if (runner === 'codex') assistant.payload.role = 'assistant'; else assistant.message.role = 'assistant'; write(assistant);
    const tool = user(); if (runner === 'codex') tool.payload.content[0].type = 'function_call_output'; else tool.message.content[0] = { type: 'tool_result', content: text }; write(tool);
    if (runner === 'claude-code') { write({ ...user(), isMeta: true }); write({ ...user(), isSidechain: true }); write({ ...user(), toolUseResult: {} }); write({ ...user(), isMeta: 'false' }); }
    else write({ timestamp: new Date(now).toISOString(), type: 'event_msg', payload: { type: 'user_message', message: text } });
    expect((await messages.read(current.run.runId)).messages).toEqual([]);
  });
  it('does not certify partial JSON, wrong text or stale timestamp', async () => {
    write(user('other')); input(); write({ ...user(), timestamp: new Date(now - 120000).toISOString() }); write(user(), false);
    expect((await messages.read(current.run.runId)).messages).toEqual([]); appendFileSync(file, '\n'); expect((await messages.read(current.run.runId)).messages).toHaveLength(1);
  });
  it('does not treat a paste without its submit key as an actual user turn', async () => {
    inputs.observe(sender, { taskId: 'owned-task', ptyId: 'owned-pty' }, '\x1b[200~' + text + '\x1b[201~'); write(user()); expect((await messages.read(current.run.runId)).messages).toEqual([]);
    inputs.observe(sender, { taskId: 'owned-task', ptyId: 'owned-pty' }, '\r'); expect((await messages.read(current.run.runId)).messages).toHaveLength(1);
  });
  it('bounds oversized records and ignores malformed JSON without losing a later complete user turn', async () => {
    input(); appendFileSync(file, 'bad json\n' + 'x'.repeat(1024 * 1024 + 1) + '\n'); write(user()); expect((await messages.read(current.run.runId)).messages).toHaveLength(1);
  });
  it('bounds record count even when many tiny malformed records fit inside the byte budget', async () => {
    input(); appendFileSync(file, 'x\n'.repeat(8193)); write(user()); expect(await messages.read(current.run.runId)).toMatchObject({ status: 'unavailable', issueCode: 'TOO_LARGE', messages: [] });
  });
  it('does not consume an origin receipt using an invalid or empty intent identity', async () => {
    input(); write(user()); const value = (await messages.read(current.run.runId)).messages[0];
    for (const id of ['', 'not-an-intent']) await expect(messages.claim(value, id)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await messages.claim(value, randomUUID());
  });
  it('keeps owned-process inspection constant across a long native user log and still rechecks the claimed row', async () => {
    input(); for(let index=0;index<3000;index++)write(user('unmatched older question '+index));write(user());const result=await messages.read(current.run.runId);expect(result.messages).toHaveLength(1);expect(currentChecks).toBe(2);
    const value=result.messages[0];expect(await messages.verify(value)).toBe(true);expect(currentChecks).toBe(4);writeFileSync(file,'');expect(await messages.verify(value)).toBe(false);
  });
  it('matches the owned launch argument through native user role without requiring a terminal Enter', async () => {
    inputs.observeLaunch(sender,{taskId:'owned-task',ptyId:'owned-pty'},text);write(user());expect(await messages.read(current.run.runId)).toMatchObject({status:'matched',messages:[{text,receipt:{transport:'launch-argument'}}]});
  });
  it('checks live source identity and latest input in RAM without invoking current-run IO', async () => {
    input();write(user());const value=(await messages.read(current.run.runId)).messages[0],checks=currentChecks;
    expect(messages.isLive(value)).toBe(true);expect(messages.isLive({...value})).toBe(false);expect(currentChecks).toBe(checks);
    inputs.observe(sender,{taskId:'owned-task',ptyId:'owned-pty'},'\x03');expect(messages.isLive(value)).toBe(false);expect(currentChecks).toBe(checks);
    expect(await messages.verify(value)).toBe(true); // historical origin remains authentic; it no longer grants authority.
  });
  it('keeps a prior branded user proof available as context without making it latest authority',async()=>{
    input('exact reference');write(user('exact reference'));const previous=(await messages.read(current.run.runId)).messages[0];input('send that draft');write(user('send that draft'));const result=await messages.read(current.run.runId),latest=result.messages.find(value=>messages.isLive(value))!,checks=currentChecks;
    expect(messages.isRetained(previous)).toBe(true);expect(messages.isLive(previous)).toBe(false);expect(messages.isLive(latest)).toBe(true);expect(messages.isRetained({...previous})).toBe(false);expect(currentChecks).toBe(checks);expect(await messages.verify(previous)).toBe(true);abort.abort();expect(messages.isRetained(previous)).toBe(false);
  });
  it('expires an old context proof even when a fresh latest command is valid',async()=>{
    input('old reference');write(user('old reference'));const previous=(await messages.read(current.run.runId)).messages[0];now+=600001;input('send it');write(user('send it'));const result=await messages.read(current.run.runId);expect(result.messages).toHaveLength(1);expect(messages.isLive(result.messages[0])).toBe(true);expect(messages.isRetained(previous)).toBe(false);expect(await messages.verify(previous)).toBe(false);
  });
  it('does not expose a batched read after the run aborts during asynchronous file IO', async () => {
    input();write(user());const pending=messages.read(current.run.runId);abort.abort();expect((await pending).messages).toEqual([]);
  });
  it('revalidates the original record and refuses in-place edits, replacement and truncation', async () => {
    input(); write(user()); const original = (await messages.read(current.run.runId)).messages[0];
    const replaced = file + '.old'; renameSync(file, replaced); writeFileSync(file, ''); expect(await messages.verify(original)).toBe(false); rmSync(file); renameSync(replaced, file); expect(await messages.verify(original)).toBe(true);
    appendFileSync(file, '\n'); expect(await messages.verify(original)).toBe(true);
    const changed = user('different'); writeFileSync(file, JSON.stringify(changed) + '\n'); expect(await messages.verify(original)).toBe(false);
  });
  it('refuses cross-run, changed native identity, lost ownership, revocation and disposal', async () => {
    input(); write(user()); const value = (await messages.read(current.run.runId)).messages[0]; expect(value).toBeDefined();
    failRun = true; expect(await messages.verify(value)).toBe(false); failRun = false;
    const id = current.snapshot.native.sessionId; current.snapshot.native.sessionId = randomUUID(); expect(await messages.verify(value)).toBe(false); current.snapshot.native.sessionId = id;
    abort.abort(); expect(await messages.verify(value)).toBe(false); expect((await messages.read(current.run.runId)).messages).toEqual([]); messages.dispose(); expect(await messages.verify(value)).toBe(false);
  });
  it('rejects file and ancestor symlinks without opening the linked source', async () => {
    input(); write(user()); const outside = join(root, 'outside.jsonl'); renameSync(file, outside); symlinkSync(outside, file); expect((await messages.read(current.run.runId)).messages).toEqual([]);
    rmSync(file); renameSync(outside, file); const dir = join(nativeRoot, runner === 'codex' ? 'sessions' : 'projects'); renameSync(dir, dir + '-real'); symlinkSync(dir + '-real', dir); expect((await messages.read(current.run.runId)).messages).toEqual([]);
  });
  it('expires origin records and fails closed on an unknown current CLI version', async () => {
    input(); write(user()); const value = (await messages.read(current.run.runId)).messages[0]; now += 600001; expect(await messages.verify(value)).toBe(false);
    messages.dispose(); messages = new NativeUserMessages(inputs, () => current, () => now); messages.register(current.run.runId, '999.0.0', abort.signal); expect(await messages.read(current.run.runId)).toMatchObject({ status: 'unsupported', messages: [] });
  });
  it('rejects a file claiming a different native session or cwd', async () => {
    input(); if (runner === 'codex') { writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: 'other', cwd } }) + '\n'); write(user()); }
    else write({ ...user(), sessionId: 'other' });
    expect((await messages.read(current.run.runId)).messages).toEqual([]);
  });
});

 describe('host-only Skill read observations',()=>{
  beforeEach(()=>setup('codex'));
  function skillRecords(){const skill=current.snapshot.packages[0].skills[0],target={id:skill.skillId,path:skill.projectionPath,content:'Complete fixed skill\n'};
   write({timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'skill-read',arguments:JSON.stringify({cmd:"/bin/cat '"+target.path+"'"})}});
   write({timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'function_call_output',call_id:'skill-read',output:'Chunk ID: abc123\nWall time: 0.0100 seconds\nProcess exited with code 0\nOriginal token count: 5\nOutput:\n'+target.content}});return target;
  }
  it('seals a one-shot historical read before revocation without restoring input authority',async()=>{
   const target=skillRecords(),runId=current.run.runId,finish=messages.prepareStoppedSkillRead(runId,[target]);
   abort.abort();failRun=true;current.snapshot.native.sessionId='replacement';
   expect((await finish()).reads).toHaveLength(1);expect(await finish()).toEqual({reads:[],discoveries:[]});
   expect(await messages.skillReads(runId,[target])).toEqual([]);expect((await messages.read(runId)).messages).toEqual([]);
  });
  it('does not collect events after the sealed stop cutoff',async()=>{
   const skill=current.snapshot.packages[0].skills[0],target={id:skill.skillId,path:skill.projectionPath,content:'Complete fixed skill\n'};
   const finish=messages.prepareStoppedSkillRead(current.run.runId,[target]);now+=100;skillRecords();abort.abort();expect((await finish()).reads).toEqual([]);
  });
  it('rejects stop reads prepared after revocation, foreign targets and calls before revocation',async()=>{
   const target=skillRecords(),early=messages.prepareStoppedSkillRead(current.run.runId,[target]),foreign=messages.prepareStoppedSkillRead(current.run.runId,[{...target,path:'/foreign'}]);
   expect((await early()).reads).toEqual([]);abort.abort();expect((await early()).reads).toEqual([]);expect((await foreign()).reads).toEqual([]);
   expect((await messages.prepareStoppedSkillRead(current.run.runId,[target])()).reads).toEqual([]);
  });
  it('freezes target content and path for the original run',async()=>{
   const target=skillRecords(),finish=messages.prepareStoppedSkillRead(current.run.runId,[target]);target.content='changed';target.path='/other';abort.abort();expect((await finish()).reads).toHaveLength(1);
  });
  it('does not read a sealed source after host source shutdown',async()=>{
   const target=skillRecords(),finish=messages.prepareStoppedSkillRead(current.run.runId,[target]);abort.abort();messages.dispose();expect(await finish()).toEqual({reads:[],discoveries:[]});
  });
  it('keeps symlink and native identity validation for a sealed stop read',async()=>{
   const target=skillRecords(),finish=messages.prepareStoppedSkillRead(current.run.runId,[target]);abort.abort();renameSync(file,file+'.original');symlinkSync(file+'.original',file);
   expect((await finish()).reads).toEqual([]);
  });
  it('binds a read to the active native session without manufacturing user authorization',async()=>{const target=skillRecords();expect(await messages.skillReads(current.run.runId,[target])).toHaveLength(1);expect((await messages.read(current.run.runId)).messages).toEqual([]);});
  it('rejects foreign targets, disabled applications, revoked runs and old-run observations',async()=>{const target=skillRecords();expect(await messages.skillReads(current.run.runId,[{...target,path:'/foreign/SKILL.md'}])).toEqual([]);current.applicationScope=[];expect(await messages.skillReads(current.run.runId,[target])).toEqual([]);current.applicationScope=undefined;current.run.startedAt=new Date(now+1).toISOString();expect(await messages.skillReads(current.run.runId,[target])).toEqual([]);abort.abort();expect(await messages.skillReads(current.run.runId,[target])).toEqual([]);});
  it('rejects a replaced native header and symbolic-link source',async()=>{const target=skillRecords();renameSync(file,file+'.original');symlinkSync(file+'.original',file);expect(await messages.skillReads(current.run.runId,[target])).toEqual([]);rmSync(file);writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:'foreign',cwd}})+'\n');expect(await messages.skillReads(current.run.runId,[target])).toEqual([]);});
 });

it('keeps owned native catalog discovery separate from reading and rejects revoked scope',async()=>{
 setup('codex');const skill=current.snapshot.packages[0].skills[0],target={id:skill.skillId,nativeName:skill.nativeName,path:skill.projectionPath,content:'not read'};
 const rootPath=target.path.slice(0,target.path.lastIndexOf('/'));
 const catalog='<skills_instructions>\n## Skills\n### Skill roots\n- `r0` = `'+rootPath+'`\n### Available skills\n- '+target.nativeName+': description (file: r0/SKILL.md)\n</skills_instructions>';
 write({timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:catalog}]}});
 expect(await messages.skillDiscoveries(current.run.runId,[target])).toHaveLength(1);expect(await messages.skillReads(current.run.runId,[target])).toEqual([]);
 current.applicationScope=[];expect(await messages.skillDiscoveries(current.run.runId,[target])).toEqual([]);
});

// M11 S10: real Codex 0.166.0 rollout (sanitized; see fixtures/codex-0.166.0/provenance.json).
const fixtureDir=join(__dirname,'fixtures/codex-0.166.0');
const realLines=()=>readFileSync(join(fixtureDir,'rollout.jsonl'),'utf8').split('\n').filter(Boolean);
describe('M11 S10 Codex 0.166.0 real-log fixture',()=>{
 it('L2: the real read and catalog records yield exactly one read and one discovery',()=>{
  const lines=realLines(),meta=JSON.parse(readFileSync(join(fixtureDir,'provenance.json'),'utf8'));
  const target={id:'bug-analysis',path:meta.skillPath,content:readFileSync(join(fixtureDir,'SKILL.md'),'utf8'),nativeName:meta.skillNativeName};
  const start=Date.parse(JSON.parse(lines[0]).timestamp)-1000,end=start+3600000;
  expect(codexSkillReadEvidence(lines,[target],start,end)).toMatchObject([{skillId:'bug-analysis',callId:'call_m11_cli_0'}]);
  expect(codexSkillDiscoveryEvidence(lines,[target],start,end)).toHaveLength(1);
  expect(codexSkillReadEvidence(lines,[{...target,content:target.content+'x'}],start,end)).toEqual([]);
  expect(codexSkillReadEvidence(lines.filter(l=>!l.includes('"function_call_output"')),[target],start,end)).toEqual([]);
 });
 it('L3: only the user-provenance record matches; harness-injected "user" context never does, even with a receipt',async()=>{
  const lines=realLines().map(l=>JSON.parse(l)),records=lines.filter(r=>r.payload?.role==='user');
  expect(records.map(r=>r.payload.internal_chat_message_metadata_passthrough.content_item_metadata[0].provenance.type)).toEqual(['harness','user']);
  setup('codex','0.166.0',()=>['L0.skill','L0.mcp','L0.cli','L1','L2','L3']);
  const [harness,owned]=records.map(r=>({...r,timestamp:new Date(now).toISOString()}));
  input(harness.payload.content[0].text);write(harness);
  expect(await messages.read(current.run.runId)).toMatchObject({status:'no-match',messages:[]});
  input(owned.payload.content[0].text);write(owned);
  const result=await messages.read(current.run.runId);
  expect(result.status).toBe('matched');expect(result.messages.map(m=>m.text)).toEqual([owned.payload.content[0].text]);
 });
 it('L3 stays closed when the declared levels lack L3, and L2 evidence stays closed without L2',async()=>{
  setup('codex','0.166.0',()=>['L0.skill','L0.mcp','L0.cli','L1','L2']);input();write(user());
  expect(await messages.read(current.run.runId)).toMatchObject({status:'unsupported',issueCode:'AGENT_ADAPTER_UNSUPPORTED'});
  messages.dispose();setup('codex','0.166.0',()=>['L0.skill','L0.mcp','L0.cli','L1']);
  const skill=current.snapshot.packages[0].skills[0];
  expect(await messages.skillReads(current.run.runId,[{id:skill.skillId,nativeName:skill.nativeName,path:skill.projectionPath,content:'x'}])).toEqual([]);
 });
});
