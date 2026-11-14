import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const dir=join(import.meta.dirname,'attempt-FeTPPD');
const rows=f=>readFileSync(join(dir,f),'utf8').trim().split('\n').map(JSON.parse);
const model=rows('model.jsonl'),decisions=rows('model-decisions.jsonl'),groups=[];
assert.equal(model.length,decisions.length);
for(let i=0;i<model.length;i++){const d=decisions[i];assert.equal(d.phase,model[i].phase);if(d.count===1)groups.push([]);groups.at(-1).push({request:model[i],decision:d});}
const versions=['0.1.0','0.1.0','0.1.0','0.1.0','0.2.0','0.2.0','0.1.0','0.2.0'];assert.equal(groups.length,versions.length);
const allCalls=new Set(),results=[];
for(const [index,g] of groups.entries()){
 const version=versions[index],first=g[0].request.body,last=g.at(-1).request.body,anth=Boolean(first.messages),expected='SCRIPT_RESOURCE_'+version;
 let call,output,path,skillContent;
 if(anth){
  assert.equal(g.length,3);const expanded=g[1].request.body.messages;
  const fresh=expanded.slice(first.messages.length).flatMap(m=>Array.isArray(m.content)?m.content:[]);
  const invoke=fresh.find(x=>x.type==='tool_use'&&x.name==='Skill');assert(invoke);
  assert(fresh.some(x=>x.type==='tool_result'&&x.tool_use_id===invoke.id&&!x.is_error));
  skillContent=fresh.filter(x=>x.type==='text').map(x=>x.text).join('\n');
  const current=last.messages.slice(expanded.length).flatMap(m=>Array.isArray(m.content)?m.content:[]);
  call=current.find(x=>x.type==='tool_use'&&x.name==='Bash');assert(call);
  output=current.find(x=>x.type==='tool_result'&&x.tool_use_id===call.id);assert(output&&!output.is_error);
  assert(String(output.content).startsWith(expected+'\n'));path=call.input.command;
 }else{
  assert.equal(g.length,2);
  skillContent=first.input.filter(x=>x.type==='message').flatMap(x=>x.content??[]).findLast(x=>x.type==='input_text'&&x.text.startsWith('<skill>'))?.text;assert(skillContent);
  call=last.input.findLast(x=>x.type==='function_call'&&x.name==='exec_command');assert(call);
  assert(!first.input.some(x=>x.type==='function_call'&&x.call_id===call.call_id));
  output=last.input.find(x=>x.type==='function_call_output'&&x.call_id===call.call_id);assert(output);assert(output.output.includes('Process exited with code 0'));assert(output.output.endsWith(expected+'\n'));path=JSON.parse(call.arguments).cmd;
 }
 assert(skillContent.includes('SKILL_BODY_'+version));assert(path.startsWith("'/private/"));assert(path.endsWith("/scripts/run.sh'"));assert(skillContent.includes(path.slice(1,-1).replace('/scripts/run.sh','')));
 const id=call.call_id??call.id;assert(!allCalls.has(id));allCalls.add(id);
 results.push({turn:index+1,phase:g[0].decision.phase,version,toolCallId:id,script:path,expectedOutput:expected,currentInvocationVerified:true,currentSkillExpansionVerified:true});
}
const cleanup=JSON.parse(readFileSync(join(dir,'cleanup.json')));assert(cleanup.length===4);assert(cleanup.every(c=>c.exitCode===0&&c.signal===null));
writeFileSync(join(dir,'audit-result.json'),JSON.stringify({scope:'Offline association audit of recorded real native execution; no additional native/model calls.',turns:results,all8CurrentCallsVerified:true,trackedNativeProcesses:cleanup.length,allExitedZero:true},null,2)+'\n');console.log('Verified 8 fresh Skill expansions and matching native script outputs; all 4 native processes exited 0.');
