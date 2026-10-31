import {describe,it,expect} from 'vitest';
import {codexSkillReadEvidence} from '../codex-skill-read-evidence';
const target={id:'mail',path:'/private/中文 path/SKILL.md',content:'---\nname: mail\n---\nFull skill body\n'};
const record=(payload:unknown,time=200)=>JSON.stringify({type:'response_item',timestamp:new Date(time).toISOString(),payload});
const call=record({type:'function_call',name:'exec_command',call_id:'owned',arguments:JSON.stringify({cmd:"/bin/cat '"+target.path+"'",max_output_tokens:5000})});
const output=(body=target.content)=>record({type:'function_call_output',call_id:'owned',output:'Chunk ID: ab123\nWall time: 0.0100 seconds\nProcess exited with code 0\nOriginal token count: 50\nOutput:\n'+body},300);
describe('bounded native Skill read evidence',()=>{
 it('requires a complete matching successful native result, without inferring discovery',()=>{expect(codexSkillReadEvidence([call,output()],[target],100,400)).toEqual([{skillId:'mail',observedAt:new Date(300).toISOString(),callId:'owned',recordHash:expect.stringMatching(/^[a-f0-9]{64}$/)}]);});
 it.each(['truncated','',target.content+'extra'])('rejects incomplete or altered output %s',body=>expect(codexSkillReadEvidence([call,output(body)],[target],100,400)).toEqual([]));
 it('rejects old-run, future, duplicate and reversed records',()=>{for(const [rows,start,end] of [[[call,output()],250,400],[[call,output()],100,250],[[call,call,output()],100,400],[[call,output(),output()],100,400],[[output(),call],100,400]] as const)expect(codexSkillReadEvidence(rows,[target],start,end)).toEqual([]);});
 it('does not evaluate commands or accept a path mention as reading',()=>{for(const cmd of ['echo '+target.path,"/bin/cat '"+target.path+"'; true","/bin/cat '"+target.path+"' | head"]){const bad=record({type:'function_call',name:'exec_command',call_id:'owned',arguments:JSON.stringify({cmd})});expect(codexSkillReadEvidence([bad,output()],[target],100,400)).toEqual([]);}});
 it('rejects failed output and another target even if body is identical',()=>{expect(codexSkillReadEvidence([call,output().replace('code 0','code 1')],[target],100,400)).toEqual([]);expect(codexSkillReadEvidence([call,output()],[{...target,path:'/another/SKILL.md'}],100,400)).toEqual([]);});
});
const nativeTarget={...target,path:'/private/owned/SKILL.md'};
const catalog='text(ALL_TOOLS.filter(x=>/zentao|bug|current.*project/i.test(x.name+" "+x.description)));';
const nativeCall=(cmd='cat '+nativeTarget.path,tail=catalog)=>record({type:'custom_tool_call',name:'exec',call_id:'native',input:'text(await tools.exec_command({cmd:'+JSON.stringify(cmd)+',max_output_tokens:12000}));\n'+tail+'\n'});
const nativeOutput=(body=target.content,hasCatalog=true,exit=0)=>record({type:'custom_tool_call_output',call_id:'native',output:[{type:'input_text',text:'Script completed\nWall time 0.1 seconds\nOutput:\n'},{type:'input_text',text:JSON.stringify({chunk_id:'abc123',wall_time_seconds:0.01,exit_code:exit,original_token_count:40,output:body})},...(hasCatalog?[{type:'input_text',text:JSON.stringify([{name:'zentao_read',description:'Read assigned work'}])}]:[])]},300);
describe('native exec-wrapped Skill reads',()=>{
 it('recognizes the observed exec command/result and independent pure tool discovery',()=>{expect(codexSkillReadEvidence([nativeCall(),nativeOutput()],[nativeTarget],100,400)).toEqual([{skillId:'mail',observedAt:new Date(300).toISOString(),callId:'native',recordHash:expect.stringMatching(/^[a-f0-9]{64}$/)}]);});
 it('supports a single quoted Unicode path without a catalog statement',()=>{expect(codexSkillReadEvidence([nativeCall("/bin/cat '"+target.path+"'",''),nativeOutput(target.content,false)],[target],100,400)).toHaveLength(1);});
 it.each(['',target.content.slice(0,-1),target.content+'extra'])('rejects truncated or changed exec output',body=>{expect(codexSkillReadEvidence([nativeCall(),nativeOutput(body)],[nativeTarget],100,400)).toEqual([]);});
 it('rejects failed, missing, duplicate, reversed, cross-run and mismatched target results',()=>{
  for(const rows of [[nativeCall(),nativeOutput(target.content,true,1)],[nativeCall(),nativeOutput(target.content,false)],[nativeCall(),nativeCall(),nativeOutput()],[nativeCall(),nativeOutput(),nativeOutput()],[nativeOutput(),nativeCall()]])expect(codexSkillReadEvidence(rows,[nativeTarget],100,400)).toEqual([]);
  expect(codexSkillReadEvidence([nativeCall(),nativeOutput()],[nativeTarget],250,400)).toEqual([]);expect(codexSkillReadEvidence([nativeCall(),nativeOutput()],[{...nativeTarget,path:'/other/SKILL.md'}],100,400)).toEqual([]);
 });
 it('never evaluates JS or accepts additional commands and fabricated output',()=>{
  for(const cmd of ['echo '+nativeTarget.path,'cat '+nativeTarget.path+'; true','cat '+nativeTarget.path+' | head'])expect(codexSkillReadEvidence([nativeCall(cmd),nativeOutput()],[nativeTarget],100,400)).toEqual([]);
  for(const tail of ['text({exit_code:0,output:"fabricated"});','await tools.exec_command({cmd:"echo fake"});',catalog+'\ntext("fake");'])expect(codexSkillReadEvidence([nativeCall(undefined,tail),nativeOutput()],[nativeTarget],100,400)).toEqual([]);
  const fabricated=record({type:'custom_tool_call',name:'exec',call_id:'native',input:'text('+JSON.stringify({exit_code:0,output:target.content})+');'});expect(codexSkillReadEvidence([fabricated,nativeOutput()],[nativeTarget],100,400)).toEqual([]);
 });
 it('rejects an output body that merely quotes a successful wrapper',()=>{
  const fake=JSON.parse(nativeOutput());fake.payload.output[1].text=JSON.stringify({chunk_id:'abc123',wall_time_seconds:0,exit_code:0,original_token_count:40,output:target.content,session_id:123});expect(codexSkillReadEvidence([nativeCall(),JSON.stringify(fake)],[nativeTarget],100,400)).toEqual([]);
 });
});
