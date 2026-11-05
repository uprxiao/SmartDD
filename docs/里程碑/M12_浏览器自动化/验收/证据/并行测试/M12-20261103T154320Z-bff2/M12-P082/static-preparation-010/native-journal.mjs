import {observeSkillRead,buildSkillProof} from './skill-proof.mjs';
import assert from 'node:assert/strict';
import {readFile,readdir,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,relative} from 'node:path';
const sha=x=>createHash('sha256').update(x).digest('hex');
function jsonObjects(text){const out=[];for(let start=0;start<text.length;start++){if(text[start]!=='{')continue;let depth=0,quoted=false,escaped=false;for(let i=start;i<text.length;i++){const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}if(c==='"'){quoted=true;continue}if(c==='{')depth++;else if(c==='}'&&--depth===0){try{out.push(JSON.parse(text.slice(start,i+1)))}catch{}start=i;break}}}return out}
function messageText(p){return typeof p.message==='string'?p.message:Array.isArray(p.content)?p.content.map(v=>typeof v?.text==='string'?v.text:'').join('\n'):'';}
export async function readNativeJournal({stateRoot,expectedCwd,marker,after,skillTarget}){
 const dir=join(stateRoot,'sessions'),files=[];assert(Number.isFinite(Date.parse(after)),'Bounded actual start timestamp');
 async function walk(path){let names;try{names=await readdir(path)}catch(error){if(error.code==='ENOENT')return;throw error}assert.equal(await realpath(path),path,'Own native journal directories cannot be symlinked');for(const name of names.sort()){const full=join(path,name),s=await lstat(full);assert(!s.isSymbolicLink()&&!relative(dir,full).startsWith('..'),'No native journal symlinks');if(s.isDirectory())await walk(full);else if(name.endsWith('.jsonl')){assert(s.isFile());assert(s.size<=32*1024*1024);files.push(full)}}}
 await walk(dir);
 const result={sources:[],sessions:[],contexts:[],calls:[],outputs:[],envPresence:[],assistantDone:[],forbiddenEscalations:[],skillReads:[],userMessages:[],malformedSources:[],invalidTimestamps:[],unmatchedOutputs:[],duplicateCalls:[],outputBeforeCalls:[]},calls=new Map(),privateCommands=new Map();
 for(const path of files.sort()){
  const bytes=await readFile(path);assert(bytes.length<=32*1024*1024,'Bounded own native journal');const lines=bytes.toString('utf8').split('\n'),rows=[];
  for(const[lineIndex,line]of lines.entries()){if(!line)continue;try{rows.push({line:lineIndex+1,row:JSON.parse(line)})}catch{result.malformedSources.push({source:path,line:lineIndex+1});break}}
  const meta=rows.find(x=>x.row.type==='session_meta')?.row.payload;
  if(!meta||meta.cwd!==expectedCwd||meta.cli_version!=='0.166.0')continue;
  result.sources.push({path,sha256:sha(bytes),bytes:bytes.length});result.sessions.push({source:path,sessionId:meta.id??meta.session_id,cliVersion:meta.cli_version,cwd:meta.cwd,modelProvider:meta.model_provider});let turnId;
  for(const{line,row}of rows){
   const parsedAt=Date.parse(row.timestamp??'');if(!Number.isFinite(parsedAt)){result.invalidTimestamps.push({source:path,line});continue}if(parsedAt<Date.parse(after))continue;
   const p=row.payload??{},at=row.timestamp;
   if((row.type==='event_msg'&&p.type==='user_message')||(row.type==='response_item'&&p.type==='message'&&p.role==='user')){const text=messageText(p);result.userMessages.push({source:path,line,at,text,messageSha256:sha(Buffer.from(text))});continue}
   if(row.type==='turn_context'){turnId=p.turn_id;result.contexts.push({source:path,line,at,turnId,approvalPolicy:p.approval_policy,sandboxType:p.sandbox_policy?.type,model:p.model});continue}
   if(row.type==='response_item'&&p.type==='function_call'){
    let args;try{args=JSON.parse(p.arguments)}catch{args=null}
    const command=typeof args?.cmd==='string'?args.cmd:typeof args?.command==='string'?args.command:typeof args?.code==='string'?args.code:null,escalated=JSON.stringify(args??{}).includes('require_escalated'),kind=command?.includes('willyou-app browser tab list')?'browser-tab-list':command?.includes('willyou-app browser snapshot')?'browser-snapshot':command?.includes('willyou-app browser tab create')?'browser-tab-create':command?.includes(marker+'_ENV')?'env-presence':command?.includes('SKILL.md')?'skill-read':'other';
    const call={source:path,line,at,turnId,callId:p.call_id,name:p.name,argumentsSha256:sha(Buffer.from(p.arguments??'')),commandKind:kind,escalated},key=path+'\0'+p.call_id;
    if(calls.has(key))result.duplicateCalls.push({source:path,line,callId:p.call_id});else{calls.set(key,call);privateCommands.set(key,command)}result.calls.push(call);if(escalated)result.forbiddenEscalations.push(call);continue;
   }
   if(row.type==='response_item'&&p.type==='function_call_output'){
    const key=path+'\0'+p.call_id,call=calls.get(key);if(!call){result.unmatchedOutputs.push({source:path,line,at,callId:p.call_id});continue}
    if(Date.parse(at)<Date.parse(call.at)){result.outputBeforeCalls.push({source:path,line,at,callId:p.call_id});continue}
    const text=typeof p.output==='string'?p.output:JSON.stringify(p.output),skillRead=observeSkillRead({call,command:privateCommands.get(key),outputText:text,source:path,line,at,target:skillTarget}),candidates=jsonObjects(text),code=/Process exited with code (\d+)/.exec(text)?.[1];
    if(skillRead)result.skillReads.push(skillRead);const output={source:path,line,at,callId:p.call_id,turnId:call.turnId,outputSha256:sha(Buffer.from(text)),exitCode:code===undefined?null:Number(code),commandKind:call.commandKind};result.outputs.push(output);
    for(const v of candidates){
     if(v?.schema==='willyou-app-result-v2'&&v?.source?.appId==='browser'&&['browser.tab.create','browser.nav.snapshot','browser.tab.list'].includes(v.capabilityId)){output.nativeCliResults??=[];output.nativeCliResults.push(v)}
     if(v?.marker===marker+'_ENV'&&typeof v.token_present==='boolean'&&typeof v.endpoint_present==='boolean'&&Object.keys(v).sort().join(',')==='endpoint_present,marker,token_present')result.envPresence.push({source:path,line,at,callId:p.call_id,turnId:call.turnId,...v});
    }continue;
   }
   if(row.type==='event_msg'&&p.type==='task_complete'){const text=p.last_agent_message??'';for(const key of['T041','T042'])if(typeof text==='string'&&text.includes(marker+'_'+key+'_DONE'))result.assistantDone.push({case:key,source:path,line,at,turnId:p.turn_id,messageSha256:sha(Buffer.from(text))})}
  }
 }
 result.skillReadProof=buildSkillProof(skillTarget,result.skillReads,result.calls,result.outputs);return result;
}
export function phaseComplete(journal,caseId){return journal.assistantDone.some(x=>x.case===caseId)}
