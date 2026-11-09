import {deriveIndexed} from './finite-indexed-carrier.mjs';
import {decodeToolRequest,decodeToolPair} from './exec-carrier-inline-extension.mjs';
import {deriveResources} from './resource-carrier.mjs';
import {deriveSkillMap,deriveLiteralAllSettled} from './skill-map-proof.mjs';
import {analyzeProgram} from './finite-ast.mjs';
import {deriveLocalPatch} from './source-patch-carrier.mjs';
// Read-only parser for this batch's typed native journal. No App/CLI/OS/model calls.
import assert from 'node:assert/strict';
import {readFile,readdir,lstat,realpath} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {sha} from './io.mjs';
const HASH=/^[a-f0-9]{64}$/;
export function jsonValues(text) {
 const out=[];if(typeof text!=='string'||text.length>32*1024*1024)return out;
 for(let start=0;start<text.length;start++){
  if(text[start]!=='{'&&text[start]!=='[')continue;
  let quoted=false,escaped=false;const stack=[];
  for(let i=start;i<text.length;i++){
   const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
   if(c==='"'){quoted=true;continue;}
   if(c==='{'||c==='[')stack.push(c);
   else if(c==='}'||c===']'){
    if(stack.pop()!==(c==='}'?'{':'['))break;
    if(!stack.length){try{out.push(JSON.parse(text.slice(start,i+1)));start=i;}catch{}break;}
   }
  }
 }
 return out;
}
function expandedObjects(value){
 const out=[],seen=new Set();let budget=0;
 const visit=(v,depth)=>{if(depth>9||++budget>15000)return;if(typeof v==='string'){if(v.length>32*1024*1024||seen.has(v))return;seen.add(v);for(const obj of jsonValues(v))visit(obj,depth+1);return;}if(!v||typeof v!=='object')return;out.push(v);for(const child of Array.isArray(v)?v:Object.values(v))visit(child,depth+1);};
 visit(value,0);return out;
}
const messageText=p=>typeof p.last_agent_message==='string'?p.last_agent_message:typeof p.message==='string'?p.message:Array.isArray(p.content)?p.content.map(x=>typeof x?.text==='string'?x.text:'').join('\n'):'';
function commandFrom(args){if(!args||typeof args!=='object')return null;for(const key of ['cmd','command','code'])if(typeof args[key]==='string')return args[key];return null;}
function receiptShape(v){return v?.schema==='willyou-app-result-v2'&&v.contractMajor===2&&v.status==='ok'&&typeof v.capabilityId==='string'&&typeof v.source?.appId==='string'&&HASH.test(v.source.packageHash??'')&&typeof v.operation?.id==='string'&&v.operation.origin==='cli'&&typeof v.completeness?.complete==='boolean';}
export function parseNativeRecords({bytes,source,expectedCwd,after,marker,targets=[],plan,stdinSecret,sourceDevelopment=false}){
 assert(bytes.length<=32*1024*1024,'Bounded own journal');
 const texts=bytes.toString('utf8').split('\n'),rows=[],malformed=[];
 texts.forEach((text,i)=>{if(!text)return;try{rows.push({line:i+1,row:JSON.parse(text)});}catch{malformed.push(i+1);}});
 const meta=rows.find(x=>x.row.type==='session_meta')?.row.payload;
 if(!meta||meta.cwd!==expectedCwd||meta.cli_version!=='0.166.0')return null;
 const result={source:{path:source,sha256:sha(bytes),bytes:bytes.length},session:{id:meta.id??meta.session_id,cliVersion:meta.cli_version,cwd:meta.cwd,provider:meta.model_provider},malformed,contexts:[],calls:[],outputs:[],receipts:[],skillReads:[],completions:[],markerObserved:false,userMessages:[],forbiddenEscalations:[],unmatchedOutputs:[],unexpectedReceipts:[],environmentAttempts:[],credentialAccessAttempts:[],unsupportedCarriers:[],unsupportedOutputs:[],duplicateCalls:[],duplicateOutputs:[],pendingCallIds:[],outputBeforeCalls:[],invalidTimestamps:[],sessionIssues:[],sessionChains:[],stdinProofs:[],approvalRequests:[],resourceReadDerivations:[]};
 const calls=new Map(),privateCommands=new Map(),sessions=new Map(),seenOutputs=new Set();let turnId;
 const register=(p,row,line,decoded)=>{const group={row,line,decoded,calls:[]};calls.set(p.call_id,group);for(const sub of decoded.commands){const command=sub.command,args=sub.parameters,escalated=args?.sandbox_permissions==='require_escalated',callId=decoded.commands.length===1?p.call_id:p.call_id+'#'+sub.index,call={source,line,at:row.timestamp,turnId,callId,outerCallId:p.call_id,callIndex:sub.index,name:p.name,toolName:sub.toolName??'exec_command',requestType:p.type,argumentsSha256:sub.toolName==='write_stdin'&&args?.chars?null:decoded.inputSha256,sourceKind:decoded.sourceKind,carrierMode:decoded.mode,escalated,...(sub.patchProof?{patchProof:sub.patchProof}:{})};group.calls.push(call);privateCommands.set(callId,command);result.calls.push(call);if(escalated){if(sourceDevelopment)result.approvalRequests.push({...call,boundary:'Request only, never self-approved; trusted native policy retains on-request'});else result.forbiddenEscalations.push(call);}if(typeof command==='string'&&/--(?:dangerously-bypass-approvals-and-sandbox|yolo)\b|--(?:sandbox|approval-policy)\s+(?:danger-full-access|never)\b/.test(command))result.forbiddenEscalations.push(call);if(typeof command==='string'){call.command=command;if(/auth\.json|profile-private\.json|codex-seed|(?:printenv|env)\s+WILLYOU_(?:RUN_TOKEN|ENDPOINT)/.test(command))result.credentialAccessAttempts.push(call);if(stdinSecret&&command.includes(stdinSecret))result.credentialAccessAttempts.push({...call,reason:'Fixture password appeared in command, forbidden even though synthetic'});}}return group;};
 const fallback=(group,row,line)=>{try{const entries=deriveIndexed({request:group.row,output:row}),decoded={commands:entries.map((e,index)=>({index,command:e.parameters.cmd,parameters:e.parameters,toolName:'exec_command'})),inputSha256:sha(Buffer.from(group.row.payload.input)),sourceKind:'strict-finite-indexed-AST',mode:'finite-indexed-original'};const registered=register(group.row.payload,group.row,group.line,decoded);registered.row=group.row;const pair={request:decoded,invocations:entries.map((e,index)=>({index,request:decoded.commands[index],output:{stdout:e.stdout,outerCompleted:true,childExitCodeObserved:e.childExitCodeObserved,exitCode:e.childExitCodeObserved,childExitUnknown:e.childExitCodeObserved===null,outputSha256:sha(Buffer.from(JSON.stringify(row.payload.output[e.outputBlock]))),carrierKind:'finite-indexed-original',exitEvidence:e.childExitCodeObserved===null?'Original forwarded output omits child exit':'Original inner full-result exit observed'}}))};return{group:registered,pair};}catch{}const options={requestRow:group.row,outputRow:row,source,requestLine:group.line,outputLine:line,targets};let entries,commands,mode;if(sourceDevelopment)try{const patch=deriveLocalPatch({...options,projectRoot:expectedCwd}),registered=register(group.row.payload,group.row,group.line,patch);return{group:registered,pair:{request:patch,invocations:[{index:0,request:patch.commands[0],output:patch.output}]}}}catch{}try{entries=deriveResources(options);commands=analyzeProgram(group.row.payload.input).commands.map(x=>({command:x.parameters.cmd,parameters:x.parameters,toolName:'exec_command'}));mode='finite-original-resource-map';}catch{let proofs;try{proofs=deriveSkillMap(options)}catch{proofs=deriveLiteralAllSettled(options)}assert(proofs.length);const audit=analyzeProgram(group.row.payload.input);assert.deepEqual(audit.unsafe,[]);assert.deepEqual(audit.unresolved,[]);assert.equal(audit.commands.length,proofs.length,'Never discard non-Skill commands in a batch');assert.equal(audit.patches.length,0);assert.equal(audit.otherTools.length,0);commands=proofs.map(x=>({command:"cat '"+x.path+"'",parameters:{cmd:"cat '"+x.path+"'"},toolName:'exec_command'}));entries=proofs.map(x=>({carrier:{outerCompleted:true,childExitCodeObserved:x.childExitCodeObserved},raw:targets.find(t=>t.path===x.path).content}));mode='finite-original-skill-map';}
 for(const e of entries)if(e.receipt)result.resourceReadDerivations.push({source,requestLine:group.line,outputLine:line,outerCallId:group.row.payload.call_id,input:e.input,receipt:e.receipt,redacted:e.redacted,mode:e.mode});const decoded={commands:commands.map((x,index)=>({...x,index})),inputSha256:sha(Buffer.from(group.row.payload.input)),sourceKind:'strict-finite-AST-map',mode};const registered=register(group.row.payload,group.row,group.line,decoded);const pair={request:decoded,invocations:entries.map((e,index)=>({index,request:decoded.commands[index],output:{...e.carrier,stdout:e.receipt?JSON.stringify(e.receipt):e.raw,exitCode:e.carrier.childExitCodeObserved,childExitUnknown:e.carrier.childExitCodeObserved===null,outerCompleted:true,outputSha256:sha(Buffer.from(JSON.stringify(row.payload.output))),carrierKind:mode}}))};return{group:registered,pair};};
 for(const {line,row} of rows){
  if(!Number.isFinite(Date.parse(row.timestamp))){result.invalidTimestamps.push({source,line});continue;}if(Date.parse(row.timestamp)<Date.parse(after))continue;
  const p=row.payload??{},at=row.timestamp;
  if((row.type==='event_msg'&&p.type==='user_message')||(row.type==='response_item'&&p.type==='message'&&p.role==='user')){const text=messageText(p);result.userMessages.push({source,line,at,text,messageSha256:sha(Buffer.from(text))});if(text.includes(marker))result.markerObserved=true;}
  if(row.type==='turn_context'){turnId=p.turn_id;result.contexts.push({source,line,at,turnId,approvalPolicy:p.approval_policy,sandboxType:p.sandbox_policy?.type,model:p.model});continue;}
  if(row.type==='response_item'&&['function_call','custom_tool_call'].includes(p.type)){
   if(calls.has(p.call_id)){result.duplicateCalls.push({source,line,at,outerCallId:p.call_id});continue}
   try{register(p,row,line,decodeToolRequest(p))}catch(error){calls.set(p.call_id,{unsupported:true,row,line,error:String(error)})}continue;
  }
  if(row.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(p.type)){
   if(seenOutputs.has(p.call_id)){result.duplicateOutputs.push({source,line,callId:p.call_id});continue;}seenOutputs.add(p.call_id);let group=calls.get(p.call_id);if(!group){result.unmatchedOutputs.push({source,line,at,callId:p.call_id});continue}
   if(Date.parse(at)<Date.parse(group.row.timestamp)){result.outputBeforeCalls.push({source,line,at,callId:p.call_id});continue}
   let pair;try{if(group.unsupported){const derived=fallback(group,row,line);group=derived.group;pair=derived.pair}else pair=decodeToolPair({requestRow:group.row,outputRow:row,source,requestLine:group.line,outputLine:line})}catch(error){result.unsupportedCarriers.push({source,line:group.line,callId:p.call_id,inputSha256:sha(Buffer.from(group.row.payload.input??group.row.payload.arguments??''))});result.unsupportedOutputs.push({source,line,at,callId:p.call_id,outputSha256:sha(Buffer.from(JSON.stringify(p.output))),reason:String(error)});continue}
   for(const sub of pair.invocations){const call=group.calls[sub.index],decoded=sub.output;try{
    const params=sub.request.parameters,tool=sub.request.toolName??(group.row.payload.name?.endsWith('write_stdin')?'write_stdin':'exec_command');let chain;
    if(tool==='write_stdin'){call.sessionId=params.session_id;chain=sessions.get(params.session_id);assert(chain&&!chain.terminal,'Only current declared still-live session may be polled');const chars=params.chars??'';if(chars){assert(stdinSecret&&/\bwillyou-app\s+browser\s+fill\b/.test(chain.command)&&/--stdin\s+value\b/.test(chain.command),'Only fixture password CLI stdin');assert(!chain.stdinDelivered);assert([stdinSecret+'\n',stdinSecret+'\u0004',stdinSecret+'\n\u0004'].includes(chars));chain.stdinDelivered=true;result.stdinProofs.push({source,line,callId:call.callId,sessionId:params.session_id,originCallId:chain.originCallId,fixtureSecretExact:true,singleDelivery:true,valuePublished:false});}chain.polls.push({line,callId:call.callId,exitCode:decoded.childExitCodeObserved});if(decoded.runningSession!==null&&decoded.runningSession!==undefined)assert.equal(decoded.runningSession,params.session_id);if(decoded.terminalSession!==null&&decoded.terminalSession!==undefined)assert.equal(decoded.terminalSession,params.session_id);if(decoded.childExitCodeObserved!==null){chain.terminal={line,callId:call.callId,exitCode:decoded.childExitCodeObserved};}}
    else if(decoded.runningSession){assert(!sessions.has(decoded.runningSession),'No session reuse');chain={sessionId:decoded.runningSession,originCallId:call.callId,originLine:line,command:sub.request.command,polls:[],stdinDelivered:false,terminal:null};sessions.set(decoded.runningSession,chain);}
   }catch(error){result.sessionIssues.push({source,line,callId:call.callId,reason:String(error)});continue;}
   const text=decoded.stdout,objects=expandedObjects(text),output={source,line,at,callId:call.callId,outerCallId:p.call_id,callIndex:sub.index,callLine:call.line,turnId:call.turnId,outputSha256:decoded.outputSha256,exitCode:decoded.exitCode,childExitCodeObserved:decoded.childExitCodeObserved,childExitUnknown:decoded.childExitUnknown,outerCompleted:decoded.outerCompleted,carrierKind:decoded.carrierKind,exitEvidence:decoded.exitEvidence,runningSession:decoded.runningSession??null};result.outputs.push(output);const command=privateCommands.get(call.callId);
    for(const target of targets){const readLike=typeof command==='string'&&/\b(?:cat|sed|head|tail|awk|nl|bat)\b|\bread_text\s*\(|\breadFile(?:Sync)?\s*\(/.test(command),references=typeof command==='string'&&(command.includes(target.path)||command.includes(target.nativeName+'/SKILL.md'));assert.equal(sha(Buffer.from(target.content)),target.sha256,'Actual single SKILL.md read target hash');const texts=[text,...objects.flatMap(obj=>Object.values(obj).filter(v=>typeof v==='string'))],exact=texts.some(t=>t.includes(target.content)),meaningful=!exact&&texts.some(t=>t.includes(target.content.trimEnd()));if(readLike&&references&&(exact||meaningful))result.skillReads.push({source,line,at,callId:call.callId,outerCallId:p.call_id,callIndex:sub.index,callLine:call.line,callAt:call.at,skillId:target.skillId,appId:target.appId,path:target.path,targetHash:target.sha256,fullContent:true,trimmedFinalWhitespace:meaningful,outputSha256:output.outputSha256})}
    const unique=new Set();for(const value of objects.filter(receiptShape)){const key=value.capabilityId+' '+value.operation.id;if(unique.has(key))continue;unique.add(key);const allowed=plan?.allowed?.find(x=>x.capabilityId===value.capabilityId&&x.appId===value.source.appId&&x.packageHash===value.source.packageHash&&x.entry==='cli'&&x.contractMajor===2),item={...output,value};result.receipts.push(item);if(call.sessionId){const chain=sessions.get(call.sessionId);if(chain)chain.businessTerminalEvidence={line,callId:call.callId,operationId:value.operation.id,requestId:value.operation.requestId,childExitCodeObserved:decoded.childExitCodeObserved};}if(!allowed)result.unexpectedReceipts.push(item)}
   }continue;
  }
  if(row.type==='event_msg'&&p.type==='task_complete')result.completions.push({source,line,at,turnId:p.turn_id,text:messageText(p),messageSha256:sha(Buffer.from(messageText(p)))});
 }
 result.pendingCallIds=[...calls.keys()].filter(id=>!seenOutputs.has(id));result.sessionChains=[...sessions.values()].map(({command,...chain})=>({...chain,commandSha256:sha(Buffer.from(command??''))}));return result;
}
export async function readNativeJournal({stateRoot,expectedCwd,after,marker,targets,plan,stdinSecret,sourceDevelopment=false}){
 const sessions=resolve(stateRoot,'sessions'),sources=[];let root;
 try{root=await realpath(sessions);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 assert.equal(root,sessions,'Own sessions root may not be symlinked');
 async function walk(directory){for(const name of await readdir(directory)){const path=join(directory,name),s=await lstat(path);assert(!s.isSymbolicLink(),'No journal symlinks');assert(!relative(sessions,path).startsWith('..'));if(s.isDirectory())await walk(path);else if(s.isFile()&&name.endsWith('.jsonl')){assert(s.size<=32*1024*1024);sources.push(path);}}}
 await walk(sessions);const out=[];
 for(const path of sources.sort()){const bytes=await readFile(path),parsed=parseNativeRecords({bytes,source:path,expectedCwd,after,marker,targets,plan,stdinSecret,sourceDevelopment});if(parsed)out.push(parsed);}
 return out;
}
export function fullSkillReadBefore(journals,target,{before}={}){
 const reads=journals.flatMap(j=>j.skillReads).filter(r=>r.appId===target.appId&&r.skillId===target.skillId&&r.targetHash===target.sha256&&r.path===target.path&&(!before||Date.parse(r.at)<Date.parse(before.at)||(r.at===before.at&&r.source===before.source&&(r.line<before.line||r.outerCallId===before.outerCallId&&r.callIndex<before.callIndex))));
 return reads.length?{complete:true,reads}: {complete:false,reads:[]};
}
