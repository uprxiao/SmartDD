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
