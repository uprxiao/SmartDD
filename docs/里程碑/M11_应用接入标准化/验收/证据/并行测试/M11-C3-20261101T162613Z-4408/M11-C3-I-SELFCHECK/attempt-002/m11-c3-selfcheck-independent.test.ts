import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {AgentAdapterRegistry} from '../agent-adapter-registry';
import {ResourceStore} from '../resource-store';
import {builtinNativeEvidenceAdapters,NativeEvidenceAdapterRegistry,type NativeEvidenceAdapter} from '../native-evidence-adapters';
import type {NativeFormatCheckFixtures} from '../agent-format-self-check';
import {agentFixture} from './agent-fixture';
import {digest} from '../manifest';
let f:Awaited<ReturnType<typeof agentFixture>>;
const outcomes:unknown[]=[];
const version='0.166.99';
const negatives=['malformed','role-spoof','truncated','mixed-version','over-budget'] as const;
const hash=()=>f.plan('codex').adapterBinding.hash;
const receiptRows=()=>f.sqlite.prepare("SELECT operation_id,plan_json,owner_store_id FROM capability_resource_operations WHERE kind='agent-format-self-check' ORDER BY rowid").all() as {operation_id:string;plan_json:string;owner_store_id:string}[];
function record(name:string,value:unknown){outcomes.push({name,at:new Date().toISOString(),value});writeFileSync(join(process.cwd(),'selfcheck-independent-outcomes-'+process.pid+'.json'),JSON.stringify(outcomes,null,2)+'\n');}
function registry(overrides:Partial<NativeEvidenceAdapter>){return new AgentAdapterRegistry(f.store,new NativeEvidenceAdapterRegistry([{...builtinNativeEvidenceAdapters.get('codex'),...overrides}]));}
function noPromotion(reader=f.adapters,adapterHash=hash()){const actual=reader.effective(adapterHash,version);expect(actual.levels).not.toContain('L2');expect(actual.levels).not.toContain('L0.cli');expect(actual.levels).not.toContain('L3');expect(actual.nativeSendEvidence).toBe(false);}
beforeEach(async()=>{f=await agentFixture();});
afterEach(()=>f.cleanup());
function fixtures(): NativeFormatCheckFixtures {
  const target = { id: 'mail', nativeName: 'owned-mail', path: '/private/p/owned-mail/SKILL.md', content: '---\nname: mail\n---\nbody\n' };
  const line = (payload: unknown) => JSON.stringify({ timestamp: new Date(200).toISOString(), type: 'response_item', payload });
  const header = JSON.stringify({ type: 'session_meta', payload: { id: 'session', cwd: '/private/p' } });
  const catalog = '<skills_instructions>\n## Skills\n### Skill roots\n- `r0` = `/private/p`\n### Available skills\n- owned-mail: d (file: r0/owned-mail/SKILL.md)\n</skills_instructions>';
  const call = line({ type: 'function_call', name: 'exec_command', call_id: 'call', arguments: JSON.stringify({ cmd: `/bin/cat '${target.path}'`, max_output_tokens: 5000 }) });
  const output = line({ type: 'function_call_output', call_id: 'call', output: 'Chunk ID: ab1\nWall time: 0.01 seconds\nProcess exited with code 0\nOriginal token count: 5\nOutput:\n' + target.content });
  const discovery = line({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: catalog }] });
  const positive = [header, call, output, discovery].join('\n') + '\n';
  return { identity: { root: '/private', sessionId: 'session', cwd: '/private/p', realCwd: '/private/p' }, target, since: 100, through: 400, positive,
    negatives: { malformed: '{bad\n', 'role-spoof': header + '\n' + line({ type: 'message', role: 'assistant', content: [{ type: 'input_text', text: catalog }] }) + '\n', truncated: positive.slice(0, -1), 'mixed-version': positive.replaceAll('response_item', 'future_item_v9'), 'over-budget': positive + '{}\n'.repeat(8200) },
    userMessage: JSON.parse(line({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'synthetic user text' }] })) };
}

describe('T26 independent host compatibility/journal boundaries',()=>{
 it('reopens the persisted check through a separate real SQLite connection while user parsing never promotes authorization or CLI',()=>{
  const adapterHash=hash(),input=fixtures(),canary='SELF_CHECK_USER_CANARY_'+randomUUID();input.userMessage={timestamp:new Date(200).toISOString(),type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:canary}]}};
  const result=f.adapters.selfCheck(adapterHash,version,input);expect(result.status).toBe('passed');expect(result.userMessageParsed).toBe(true);expect(result.proven).toEqual(['L2']);
  const independentDb=new Database(join(f.root,'state.sqlite'));try{const reopened=new AgentAdapterRegistry(new ResourceStore(independentDb,f.root));expect(reopened.selfCheckResult(adapterHash,version)).toEqual(result);expect(reopened.effective(adapterHash,version)).toEqual({levels:['L0.skill','L0.mcp','L2'],verified:false,nativeSendEvidence:false});record('separate-disk-connection',{result,levels:reopened.effective(adapterHash,version),journal:receiptRows()});}finally{independentDb.close();}
  const journal=JSON.stringify(receiptRows());expect(journal).not.toContain(canary);expect(journal).not.toContain(input.positive);expect(journal).not.toContain(input.target.path);expect(journal).not.toContain('skills_instructions');expect(journal).not.toContain('function_call_output');
 });
 it('rejects a changed positive format and lets the latest failed local check override the earlier green without replacing the older attempt',()=>{
  const adapterHash=hash(),first=f.adapters.selfCheck(adapterHash,version,fixtures()),changed=fixtures();changed.positive=changed.positive.replaceAll('response_item','future-log-type');const second=f.adapters.selfCheck(adapterHash,version,changed);expect(second.status).toBe('failed');noPromotion();expect(receiptRows()).toHaveLength(2);expect(f.adapters.selfCheckResult(adapterHash,version)).toEqual(second);record('format-drift-latest-failure',{first,second,effective:f.adapters.effective(adapterHash,version)});
 });
 it.each(['read','discovery'] as const)('fails closed when just the %s parser leaks a role-spoof observation',kind=>{
  const native=builtinNativeEvidenceAdapters.get('codex'),key=kind==='read'?'observeSkillReads':'observeSkillDiscoveries';const reader=registry({[key]:(lines:readonly string[],targets:readonly import('../codex-skill-read-evidence').SkillReadTarget[],since:number,through:number)=>lines.some(l=>l.includes('"role":"assistant"'))?[{skillId:targets[0].id,observedAt:new Date(200).toISOString(),recordHash:'c'.repeat(64),callId:'spoof-leak'}]:native[key]!(lines,targets,since,through)});
  const result=reader.selfCheck(hash(),version,fixtures());record('one-channel-negative-'+kind,result);expect(result.status).toBe('failed');expect(result.checks['role-spoof']).toBe(false);noPromotion(reader);
 });
 it.each(negatives)('refuses missing/empty/non-string required %s negative',name=>{
  for(const value of [undefined,'',17]){const input=fixtures();if(value===undefined)delete (input.negatives as Partial<typeof input.negatives>)[name];else (input.negatives as unknown as Record<string,unknown>)[name]=value;const result=f.adapters.selfCheck(hash(),version,input);expect(result.status).toBe('failed');expect(result.checks[name]).toBe(false);noPromotion();record('required-negative-'+name,{valueType:typeof value,result});}
 });
 it.each(['platform','adapterHash','cliVersion','owner'] as const)('does not load a persisted proof for a wrong %s binding',field=>{
  const adapterHash=hash(),check=f.adapters.selfCheck(adapterHash,version,fixtures()),rows=receiptRows(),row=rows[0];
  if(field==='owner')f.sqlite.prepare('UPDATE capability_resource_operations SET owner_store_id=? WHERE operation_id=?').run(randomUUID(),row.operation_id);
  else{const changed={...check,[field]:field==='platform'?'unsupported-test-platform':field==='adapterHash'?'f'.repeat(64):'0.166.98'};f.sqlite.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(JSON.stringify(changed),row.operation_id);}
  expect(f.adapters.selfCheckResult(adapterHash,version)).toBeNull();noPromotion();expect(f.adapters.selfCheckResult(adapterHash,'0.166.98')).toBeNull();expect(f.adapters.selfCheckResult(f.plan('claude-code').adapterBinding.hash,version)).toBeNull();record('wrong-binding-'+field,{loaded:f.adapters.selfCheckResult(adapterHash,version),effective:f.adapters.effective(adapterHash,version)});
 });
 it.each(['broken-json','fake-L3'] as const)('does not resurrect an older green after the current receipt is %s',mode=>{
  const adapterHash=hash();f.adapters.selfCheck(adapterHash,version,fixtures());const second=f.adapters.selfCheck(adapterHash,version,fixtures()),last=receiptRows().at(-1)!;f.sqlite.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(mode==='broken-json'?'{broken':JSON.stringify({...second,proven:['L3']}),last.operation_id);expect(f.adapters.selfCheckResult(adapterHash,version)).toBeNull();noPromotion();record('corrupt-current-'+mode,{loaded:f.adapters.selfCheckResult(adapterHash,version),effective:f.adapters.effective(adapterHash,version),attempts:receiptRows().length});
 });
 it('rechecks actual installed Adapter bytes before promotion and consumption, without replacing its earlier journal',()=>{
  const adapterHash=hash();f.adapters.selfCheck(adapterHash,version,fixtures());const installed=f.adapters.get(adapterHash),entry=join(f.store.root,installed.resource.relativePath,installed.metadata.entry),original=readFileSync(entry),count=receiptRows().length;writeFileSync(entry,Buffer.concat([original,Buffer.from('\n// private corruption fault\n')]));try{expect(()=>f.adapters.selfCheck(adapterHash,version,fixtures())).toThrow();expect(()=>f.adapters.effective(adapterHash,version)).toThrow();expect(()=>f.adapters.selfCheckResult(adapterHash,version)).toThrow();expect(receiptRows()).toHaveLength(count);record('adapter-byte-corruption',{originalSha256:digest(original),changedSha256:digest(readFileSync(entry)),newCheckRejected:true,consumptionRejected:true,journalCount:count});}finally{writeFileSync(entry,original);}expect(f.adapters.selfCheckResult(adapterHash,version)?.status).toBe('passed');
 });
 it.each(['observeSkillReads','observeSkillDiscoveries'] as const)('does not prove compatibility when required positive %s support is missing',key=>{
  const reader=registry({[key]:undefined}),result=reader.selfCheck(hash(),version,fixtures());record('missing-positive-'+key,result);expect(result.status).toBe('failed');expect(result.checks.positive).toBe(false);noPromotion(reader);
 });
 it.each(['empty-call-id','missing-call-id','unexpected-raw-field'] as const)('does not certify a malformed positive observation: %s',shape=>{
  const native=builtinNativeEvidenceAdapters.get('codex'),reader=registry({observeSkillReads:(lines,targets,since,through)=>native.observeSkillReads!(lines,targets,since,through).map(value=>{const mutated:Record<string,unknown>={...value};if(shape==='empty-call-id')mutated.callId='';if(shape==='missing-call-id')delete mutated.callId;if(shape==='unexpected-raw-field')mutated.raw='unfiltered native text';return mutated as unknown as typeof value;})});
  const result=reader.selfCheck(hash(),version,fixtures());record('malformed-positive-'+shape,{result,effective:reader.effective(hash(),version)});expect(result.status).toBe('failed');expect(result.checks.positive).toBe(false);noPromotion(reader);
 });
});
