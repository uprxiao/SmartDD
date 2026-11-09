import {decodeToolRequest,decodeToolPair} from './exec-carrier.mjs';
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
export function parseNativeRecords({bytes,source,expectedCwd,after,marker,targets=[],plan}){
 assert(bytes.length<=32*1024*1024,'Bounded own journal');
 const texts=bytes.toString('utf8').split('\n'),rows=[],malformed=[];
 texts.forEach((text,i)=>{if(!text)return;try{rows.push({line:i+1,row:JSON.parse(text)});}catch{malformed.push(i+1);}});
 const meta=rows.find(x=>x.row.type==='session_meta')?.row.payload;
 if(!meta||meta.cwd!==expectedCwd||meta.cli_version!=='0.166.0')return null;
 const result={source:{path:source,sha256:sha(bytes),bytes:bytes.length},session:{id:meta.id??meta.session_id,cliVersion:meta.cli_version,cwd:meta.cwd,provider:meta.model_provider},malformed,contexts:[],calls:[],outputs:[],receipts:[],skillReads:[],completions:[],markerObserved:false,userMessages:[],forbiddenEscalations:[],unmatchedOutputs:[],unexpectedReceipts:[],environmentAttempts:[],credentialAccessAttempts:[],unsupportedCarriers:[],unsupportedOutputs:[],duplicateCalls:[],outputBeforeCalls:[],invalidTimestamps:[]};
 const calls=new Map(),privateCommands=new Map();let turnId;
 for(const {line,row} of rows){
  if(!Number.isFinite(Date.parse(row.timestamp))){result.invalidTimestamps.push({source,line});continue;}if(Date.parse(row.timestamp)<Date.parse(after))continue;
  const p=row.payload??{},at=row.timestamp;
  if((row.type==='event_msg'&&p.type==='user_message')||(row.type==='response_item'&&p.type==='message'&&p.role==='user')){const text=messageText(p);result.userMessages.push({source,line,at,text,messageSha256:sha(Buffer.from(text))});if(text.includes(marker))result.markerObserved=true;}
  if(row.type==='turn_context'){turnId=p.turn_id;result.contexts.push({source,line,at,turnId,approvalPolicy:p.approval_policy,sandboxType:p.sandbox_policy?.type,model:p.model});continue;}
  if(row.type==='response_item'&&['function_call','custom_tool_call'].includes(p.type)){
   let decoded;try{decoded=decodeToolRequest(p)}catch(error){result.unsupportedCarriers.push({source,line,at,outerCallId:p.call_id,name:p.name,inputSha256:sha(Buffer.from(p.input??p.arguments??'')),reason:String(error)});calls.set(p.call_id,{unsupported:true,row,line});continue}
   if(calls.has(p.call_id)){result.duplicateCalls.push({source,line,at,outerCallId:p.call_id});continue}
   const group={row,line,decoded,calls:[]};calls.set(p.call_id,group);
   for(const sub of decoded.commands){const command=sub.command,args=sub.parameters,escalated=JSON.stringify(args??{}).includes('require_escalated'),callId=decoded.commands.length===1?p.call_id:p.call_id+'#'+sub.index,call={source,line,at,turnId,callId,outerCallId:p.call_id,callIndex:sub.index,name:p.name,requestType:p.type,argumentsSha256:decoded.inputSha256,sourceKind:decoded.sourceKind,carrierMode:decoded.mode,escalated};group.calls.push(call);privateCommands.set(callId,command);result.calls.push(call);if(escalated)result.forbiddenEscalations.push(call);
    if(typeof command==='string'){
     const navigationLike=/\bwillyou-app\s+browser\s+(?:goto|back|forward|reload|exec|tab\s+create)\b|\b(?:curl|wget|open)\s|(?:fetch|urlopen|webbrowser\.open|page\.goto|requests\.(?:get|post))\s*\(/.test(command),urls=command.match(/https?:\/\/[^\s"'`<>\\)]+/g)??[],environments=urls.filter(raw=>{try{const url=new URL(raw);return !(url.hostname==='127.0.0.1'&&url.pathname.startsWith('/biz/'))}catch{return true}});
     if(navigationLike&&environments.length)result.environmentAttempts.push({...call,urlSha256:environments.map(x=>sha(Buffer.from(x)))});
     if(/auth\.json|profile-private\.json|codex-seed|(?:printenv|env)\s+WILLYOU_(?:RUN_TOKEN|ENDPOINT)|(?:cat|readFile|read_text)[^\n]{0,160}WILLYOU_RUN_TOKEN/.test(command))result.credentialAccessAttempts.push(call);
    }
   }continue;
  }
  if(row.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(p.type)){
   const group=calls.get(p.call_id);if(!group){result.unmatchedOutputs.push({source,line,at,callId:p.call_id});continue}if(group.unsupported){result.unsupportedOutputs.push({source,line,at,callId:p.call_id,outputSha256:sha(Buffer.from(JSON.stringify(p.output)))});continue}
   if(Date.parse(at)<Date.parse(group.row.timestamp)){result.outputBeforeCalls.push({source,line,at,callId:p.call_id});continue}
   let pair;try{pair=decodeToolPair({requestRow:group.row,outputRow:row,source,requestLine:group.line,outputLine:line})}catch(error){result.unsupportedOutputs.push({source,line,at,callId:p.call_id,outputSha256:sha(Buffer.from(JSON.stringify(p.output))),reason:String(error)});continue}
   for(const sub of pair.invocations){const call=group.calls[sub.index],decoded=sub.output,text=decoded.stdout,objects=expandedObjects(text),output={source,line,at,callId:call.callId,outerCallId:p.call_id,callIndex:sub.index,callLine:call.line,turnId:call.turnId,outputSha256:decoded.outputSha256,exitCode:decoded.exitCode,childExitCodeObserved:decoded.childExitCodeObserved,childExitUnknown:decoded.childExitUnknown,outerCompleted:decoded.outerCompleted,carrierKind:decoded.carrierKind,exitEvidence:decoded.exitEvidence};result.outputs.push(output);const command=privateCommands.get(call.callId);
    for(const target of targets){const readLike=typeof command==='string'&&/\b(?:cat|sed|head|tail|awk|nl|bat)\b|\bread_text\s*\(|\breadFile(?:Sync)?\s*\(/.test(command),references=typeof command==='string'&&(command.includes(target.path)||command.includes(target.nativeName+'/SKILL.md'));assert.equal(sha(Buffer.from(target.content)),target.sha256,'Actual single SKILL.md read target hash');const texts=[text,...objects.flatMap(obj=>Object.values(obj).filter(v=>typeof v==='string'))],exact=texts.some(t=>t.includes(target.content)),meaningful=!exact&&texts.some(t=>t.includes(target.content.trimEnd()));if(readLike&&references&&(exact||meaningful))result.skillReads.push({source,line,at,callId:call.callId,outerCallId:p.call_id,callIndex:sub.index,callLine:call.line,callAt:call.at,skillId:target.skillId,appId:target.appId,path:target.path,targetHash:target.sha256,fullContent:true,trimmedFinalWhitespace:meaningful,outputSha256:output.outputSha256})}
    const unique=new Set();for(const value of objects.filter(receiptShape)){const key=value.capabilityId+' '+value.operation.id;if(unique.has(key))continue;unique.add(key);const allowed=plan?.allowed?.find(x=>x.capabilityId===value.capabilityId&&x.appId===value.source.appId&&x.packageHash===value.source.packageHash&&x.entry==='cli'&&x.contractMajor===2),item={...output,value};result.receipts.push(item);if(!allowed)result.unexpectedReceipts.push(item)}
   }continue;
  }
  if(row.type==='event_msg'&&p.type==='task_complete')result.completions.push({source,line,at,turnId:p.turn_id,text:messageText(p),messageSha256:sha(Buffer.from(messageText(p)))});
 }
 return result;
}
export async function readNativeJournal({stateRoot,expectedCwd,after,marker,targets,plan}){
 const sessions=resolve(stateRoot,'sessions'),sources=[];let root;
 try{root=await realpath(sessions);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 assert.equal(root,sessions,'Own sessions root may not be symlinked');
 async function walk(directory){for(const name of await readdir(directory)){const path=join(directory,name),s=await lstat(path);assert(!s.isSymbolicLink(),'No journal symlinks');assert(!relative(sessions,path).startsWith('..'));if(s.isDirectory())await walk(path);else if(s.isFile()&&name.endsWith('.jsonl')){assert(s.size<=32*1024*1024);sources.push(path);}}}
 await walk(sessions);const out=[];
 for(const path of sources.sort()){const bytes=await readFile(path),parsed=parseNativeRecords({bytes,source:path,expectedCwd,after,marker,targets,plan});if(parsed)out.push(parsed);}
 return out;
}
export function fullSkillReadBefore(journals,target,{before}={}){
 const reads=journals.flatMap(j=>j.skillReads).filter(r=>r.appId===target.appId&&r.skillId===target.skillId&&r.targetHash===target.sha256&&r.path===target.path&&(!before||Date.parse(r.at)<Date.parse(before.at)||(r.at===before.at&&r.source===before.source&&(r.line<before.line||r.outerCallId===before.outerCallId&&r.callIndex<before.callIndex))));
 return reads.length?{complete:true,reads}: {complete:false,reads:[]};
}
