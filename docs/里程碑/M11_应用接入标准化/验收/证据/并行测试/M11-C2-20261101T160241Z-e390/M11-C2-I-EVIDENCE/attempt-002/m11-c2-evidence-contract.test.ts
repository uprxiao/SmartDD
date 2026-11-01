// T27 I-layer format contract: actual host IO, receipt creation and proof verification.
// Only RunContext, sender/PTY identity and a scripted log-format implementation are fixtures.
import {appendFileSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {capabilitySessionSnapshotSchema,applicationNativeSkillName} from '@shared/application-session';
import type {ApplicationUiSender} from '../execution-context';
import type {RunContext} from '../run-registry';
import {NativeUserInputs} from '../native-user-inputs';
import {NativeUserMessages} from '../native-user-messages';
import {builtinNativeEvidenceAdapters,NativeEvidenceAdapterRegistry,type NativeEvidenceAdapter,type NativeEvidenceIdentity} from '../native-evidence-adapters';
import type {SkillReadTarget,SkillReadObservation} from '../codex-skill-read-evidence';
import {digest} from '../manifest';
const sender={sender:{id:125},senderFrame:{processId:52,routingId:1}} as unknown as ApplicationUiSender;
const text='发送此测试草稿，保持唯一正文😀';
let root:string,cwd:string,nativeRoot:string,file:string,current:RunContext,abort:AbortController,inputs:NativeUserInputs,messages:NativeUserMessages,now:number,target:SkillReadTarget;
const outcomes:unknown[]=[];
function record(name:string,value:unknown){
 const bytes=readFileSync(file);const source={path: file,sha256:digest(bytes),bytes:bytes.length,lineCount:bytes.toString().split('\n').length-1};
 outcomes.push({format:current.snapshot.runner,scenario:name,at:new Date().toISOString(),source,result:value});
 if(bytes.length<16384)writeFileSync(join(process.cwd(),'evidence-log-'+process.pid+'-'+outcomes.length+'.jsonl'),bytes);
 writeFileSync(join(process.cwd(),'evidence-outcomes-'+process.pid+'.json'),JSON.stringify(outcomes,null,2)+'\n');
}
const timestamp=(r:any)=>typeof r?.at==='string'?Date.parse(r.at):NaN;
function scriptedSkill(kind:'read'|'discovery',lines:readonly string[],targets:readonly SkillReadTarget[],since:number,through:number):SkillReadObservation[]{
 // The format implements roles/record shape only. Generic file/record budgets are host obligations.
 const found=new Map<string,SkillReadObservation>();
 for(const raw of lines)try{const row=JSON.parse(raw),time=timestamp(row);if(!Number.isFinite(time)||time<since||time>through||row.kind!==(kind==='read'?'fixture-read':'fixture-catalog')||row.via!==(kind==='read'?'executor':'host'))continue;
  const selected=targets.find(t=>t.id===row.skill&&t.path===row.path&&(!t.nativeName||t.nativeName===row.name));if(!selected||typeof row.call!=='string'||!row.call||kind==='read'&&row.body!==selected.content)continue;
  found.set(selected.id,{skillId:selected.id,observedAt:new Date(time).toISOString(),callId:row.call,recordHash:digest(raw)});
 }catch{/* malformed format records are not evidence */}
 return [...found.values()];
}
const scripted:NativeEvidenceAdapter={
 id:'scripted-test',
 async locate(identity,lookup){const dir=join(identity.root,'events');await lookup.directory(dir);const file=join(dir,identity.sessionId+'.events');if(!await lookup.isFile(file))throw Error('Missing scripted log');return file;},
 validateHeader(value:any,identity:NativeEvidenceIdentity){return value?.kind==='fixture-header'&&value.magic==='test-format-v1'&&value.session===identity.sessionId&&value.workspace===identity.cwd;},
 parseUserMessage(value:any,identity){const at=timestamp(value);if(!Number.isFinite(at)||value.kind!=='fixture-message'||value.author!=='human'||value.injected!==false||value.session!==identity.sessionId||value.workspace!==identity.cwd||typeof value.body!=='string')return null;return{text:value.body,timestamp:at};},
 observeSkillReads:(...args)=>scriptedSkill('read',...args),
 observeSkillDiscoveries:(...args)=>scriptedSkill('discovery',...args),
};
const registry=new NativeEvidenceAdapterRegistry([...builtinNativeEvidenceAdapters.list(),scripted]);
function setup(format:'codex'|'scripted-test'){
 const hash='a'.repeat(64),sessionId=randomUUID(),version='0.166.0';abort=new AbortController();
 const base=capabilitySessionSnapshotSchema.parse({schema:2,taskId:'owned-task',projectId:'p1',runner:'codex',createdAt:new Date(now).toISOString(),adapterBinding:{id:'codex',version:'1.0.0',hash,projectionFormatVersion:1,nativeToolNames:{}},native:{sessionId,stateRoot:nativeRoot,cwd},agentAtCreation:{version,adapterRevision:1},catalogGeneration:'test',packages:[{appId:'mail',version:'1.0.0',packageHash:hash,hashAlgorithm:'app-manifest-v1',hostApi:{min:1,max:1},dataApi:1,runtimeHash:hash,toolContractMajors:{},skills:[{skillId:'assistant',nativeName:applicationNativeSkillName('mail','assistant',hash),contentHash:hash,sourceRelativePath:'skills/assistant',projectionPath:join(root,'skill/SKILL.md')}],bindings:[],allowedOperations:['mail.send']}],standardSkills:[],mcp:[{kind:'applications',serverName:'wy_one',protocolMajor:1,runtimeHash:hash}],provenance:'created'});
 // Public snapshot/profile Runner enum is deliberately not expanded. This I-only cast supplies
 // a trusted registry-injected fixture format, not new production Runner/B-package support.
 const snapshot={...base,runner:format,adapterBinding:{...base.adapterBinding,id:format}} as unknown as RunContext['snapshot'];
 current={run:{runId:randomUUID(),taskId:snapshot.taskId,projectId:'p1',runner:format,state:'active',snapshotHash:hash,pid:80001,processStartedAt:'I-fixture-owned-process',startedAt:new Date(now).toISOString(),endedAt:null},snapshot,bindings:[],signal:abort.signal};
 inputs=new NativeUserInputs({requireSender:s=>{if(s!==sender)throw Error('wrong sender');},current:t=>t.taskId==='owned-task'&&t.ptyId==='owned-pty'?current:null,now:()=>now});
 messages=new NativeUserMessages(inputs,runId=>{if(runId!==current.run.runId)throw Error('foreign run');return current;},()=>now,()=>['L0.skill','L0.mcp','L1','L2','L3'],registry);
 messages.register(current.run.runId,version,abort.signal);const dir=format==='codex'?join(nativeRoot,'sessions/2026/11/02'):join(nativeRoot,'events');mkdirSync(dir,{recursive:true});file=join(dir,format==='codex'?'rollout-test-'+sessionId+'.jsonl':sessionId+'.events');
 const skill=current.snapshot.packages[0].skills[0];target={id:skill.skillId,nativeName:skill.nativeName,path:skill.projectionPath,content:'---\nname: fixed\n---\nSynthetic Skill body\n'};mkdirSync(dirname(target.path),{recursive:true});writeFileSync(target.path,target.content);reset();
}
function header(format:string=current.snapshot.runner){return format==='codex'?{type:'session_meta',payload:{id:current.snapshot.native.sessionId,cwd}}:{kind:'fixture-header',magic:'test-format-v1',session:current.snapshot.native.sessionId,workspace:cwd};}
function user(format:string=current.snapshot.runner,body=text):any{return format==='codex'?{timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:body}]}}:{kind:'fixture-message',at:new Date(now).toISOString(),author:'human',injected:false,session:current.snapshot.native.sessionId,workspace:cwd,body};}
function skills(format:string=current.snapshot.runner):any[]{
 if(format==='scripted-test')return[{kind:'fixture-catalog',at:new Date(now).toISOString(),via:'host',skill:target.id,path:target.path,name:target.nativeName,call:'catalog-fixture'},{kind:'fixture-read',at:new Date(now).toISOString(),via:'executor',skill:target.id,path:target.path,name:target.nativeName,call:'read-fixture',body:target.content}];
 const dir=dirname(target.path),catalog='<skills_instructions>\n## Skills\n### Skill roots\n- `r0` = `'+dir+'`\n### Available skills\n- '+target.nativeName+': synthetic (file: r0/SKILL.md)\n</skills_instructions>';
 return[{timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:catalog}]}},{timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'read-owned',arguments:JSON.stringify({cmd:"/bin/cat '"+target.path+"'"})}},{timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'function_call_output',call_id:'read-owned',output:'Chunk ID: abc123\nWall time: 0.01 seconds\nProcess exited with code 0\nOriginal token count: 5\nOutput:\n'+target.content}}];
}
const write=(row:unknown,complete=true)=>appendFileSync(file,JSON.stringify(row)+(complete?'\n':''));
function reset(){writeFileSync(file,JSON.stringify(header())+'\n');}
const submit=()=>inputs.observe(sender,{taskId:'owned-task',ptyId:'owned-pty'},'\x1b[200~'+text+'\x1b[201~\r');
async function observed(){return{users:await messages.read(current.run.runId),reads:await messages.skillReads(current.run.runId,[target]),discoveries:await messages.skillDiscoveries(current.run.runId,[target])};}
function noEvidence(value:Awaited<ReturnType<typeof observed>>){expect(value.users.messages).toEqual([]);expect(value.reads).toEqual([]);expect(value.discoveries).toEqual([]);}
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'willyou-m11-c2-evidence-'));cwd=join(root,'project');nativeRoot=join(root,'native');mkdirSync(cwd);mkdirSync(nativeRoot);now=Date.now();});
afterEach(()=>{messages?.dispose();inputs?.dispose();rmSync(root,{recursive:true,force:true});});

describe.each(['codex','scripted-test'] as const)('T27 same host contract: %s',(format)=>{
 beforeEach(()=>setup(format));
 it('positive records require a real host-generated committed-input receipt and support live file verification/one-use claim',async()=>{
  write(user());for(const r of skills())write(r);const noReceipt=await messages.read(current.run.runId);expect(noReceipt.messages).toEqual([]);submit();const value=await observed();expect(value.users.status).toBe('matched');expect(value.users.messages).toHaveLength(1);expect(value.reads).toHaveLength(1);expect(value.discoveries).toHaveLength(1);const proof=value.users.messages[0];expect(await messages.verify(proof)).toBe(true);expect(await messages.verify({...proof})).toBe(false);const intent=randomUUID();await messages.claim(proof,intent);await expect(messages.claim(proof,randomUUID())).rejects.toMatchObject({code:'AUTHORIZATION_REQUIRED'});record('positive',{...value,noReceipt,proofVerified:true,copiedProofRejected:true,secondIntentRejected:true});
 });
 it('malformed, null, partial and tool-output-as-user records do not mint user or Skill evidence',async()=>{
  submit();appendFileSync(file,'{bad json\nnull\n');const row=user();if(format==='codex'){row.payload.role='tool';row.payload.content[0].type='function_call_output';}else row.author='tool';write(row);const foreignSkills=skills().map(r=>format==='codex'?{...r,payload:{...r.payload,role:'assistant',type:'message'}}:{...r,via:'tool'});for(const r of foreignSkills)write(r);appendFileSync(file,JSON.stringify(user()).slice(0,-3));const value=await observed();record('malformed-tool-spoof',value);noEvidence(value);
 });
 it('does not accept another format in a matching current header or a foreign native header',async()=>{
  submit();const other=format==='codex'?'scripted-test':'codex';write(user(other));for(const r of skills(other))write(r);const mixed=await observed();noEvidence(mixed);writeFileSync(file,JSON.stringify(header(other))+'\n');write(user());for(const r of skills())write(r);const foreignHeader=await observed();record('cross-format',{mixed,foreignHeader});noEvidence(foreignHeader);
 });
 it('rejects a symlink file and ancestor directory with matching positive records',async()=>{
  submit();write(user());for(const r of skills())write(r);const original=readFileSync(file),saved=file+'.original';renameSync(file,saved);symlinkSync(saved,file);const linkedFile=await observed();noEvidence(linkedFile);rmSync(file);renameSync(saved,file);const dir=dirname(file);renameSync(dir,dir+'-actual');symlinkSync(dir+'-actual',dir);const linkedDirectory=await observed();record('file-and-ancestor-links',{linkedFile,linkedDirectory,sourceOriginalSha256:digest(original)});noEvidence(linkedDirectory);
 });
 it('invalidates a branded proof after inode replacement and truncation, and rejects replacement header identity',async()=>{
  submit();write(user());for(const r of skills())write(r);const proof=(await messages.read(current.run.runId)).messages[0];expect(await messages.verify(proof)).toBe(true);const bytes=readFileSync(file);renameSync(file,file+'.old');writeFileSync(file,bytes);expect(await messages.verify(proof)).toBe(false);writeFileSync(file,JSON.stringify(header())+'\n'+JSON.stringify(user()).slice(0,-5));const truncated=await observed();noEvidence(truncated);writeFileSync(file,JSON.stringify(format==='codex'?{type:'session_meta',payload:{id:'foreign',cwd}}:{...header(),session:'foreign'})+'\n');write(user());for(const r of skills())write(r);const wrongIdentity=await observed();record('replace-truncate-header',{oldProofRejected:true,truncated,wrongIdentity});noEvidence(wrongIdentity);
 });
 it('enforces the record-count budget before either format can certify an otherwise matching final record',async()=>{
  submit();appendFileSync(file,'{}\n'.repeat(8193));write(user());for(const r of skills())write(r);const value=await observed();record('over-record-budget',value);noEvidence(value);expect(value.users.issueCode).toBe('TOO_LARGE');
 });
 it('does not accept an over-line-budget user or Skill record',async()=>{
  submit();for(const r of [user(),...skills()])appendFileSync(file,' '.repeat(1024*1024+1)+JSON.stringify(r)+'\n');const value=await observed();record('over-line-budget',value);noEvidence(value);
 });
 it('does not certify positive records outside the bounded tail or the run time window',async()=>{
  submit();write(user());for(const r of skills())write(r);appendFileSync(file,'x'.repeat(4*1024*1024+1)+'\n');const outsideTail=await observed();noEvidence(outsideTail);reset();for(const row of [user(),...skills()]){if(format==='codex')row.timestamp=new Date(now-120001).toISOString();else row.at=new Date(now-120001).toISOString();write(row);}const stale=await observed();record('over-tail-and-stale',{outsideTail,stale});noEvidence(stale);
 });
 it('leaves a truncated final user/Skill event uncertified until the exact newline arrives',async()=>{
  submit();write(user(),false);const userBefore=await messages.read(current.run.runId);expect(userBefore.messages).toEqual([]);appendFileSync(file,'\n');expect((await messages.read(current.run.runId)).messages).toHaveLength(1);reset();const items=skills();for(const r of items.slice(0,-1))write(r);write(items.at(-1),false);expect(await messages.skillReads(current.run.runId,[target])).toEqual([]);appendFileSync(file,'\n');expect(await messages.skillReads(current.run.runId,[target])).toHaveLength(1);record('incomplete-newline',{userBefore,completedUser:true,incompleteReadRejected:true,completedRead:true});
 });
});
it('does not fall through to Codex records for an unregistered Agent or an adapter without optional L3',async()=>{
 setup('codex');submit();write(user());const unknown={...current,snapshot:{...current.snapshot,runner:'not-registered'}} as unknown as RunContext;const readers=new NativeUserMessages(inputs,()=>unknown,()=>now,()=>['L2','L3'],registry);readers.register(current.run.runId,'0.166.0',abort.signal);expect(await readers.read(current.run.runId)).toMatchObject({status:'unsupported',messages:[]});expect(await readers.skillDiscoveries(current.run.runId,[target])).toEqual([]);readers.dispose();
 const noL3={...scripted,id:'codex',parseUserMessage:undefined};const missing=new NativeUserMessages(inputs,()=>current,()=>now,()=>['L2','L3'],new NativeEvidenceAdapterRegistry([noL3]));missing.register(current.run.runId,'0.166.0',abort.signal);const result=await missing.read(current.run.runId);record('unknown-and-no-L3',{unknownDenied:true,result});expect(result).toMatchObject({status:'unsupported',messages:[]});missing.dispose();
});
