import { createHash } from 'node:crypto';

export interface SkillReadTarget { id:string; path:string; content:string }
export interface SkillReadObservation { skillId:string; observedAt:string; callId:string; recordHash:string }
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const quote=(text:string)=>"'"+text.replaceAll("'","'\\''")+"'";
/** Parses an already ownership-verified Codex 0.162.1 log window. This is diagnostic
 * evidence, never user intent or authorization. Callers must verify the native
 * session/header, file identity and fixed projection contents before AND after IO.
 * Deliberately accepts only an exact cat invocation and a complete successful output.
 */
export function codexSkillReadEvidence(lines:readonly string[],targets:readonly SkillReadTarget[],startedAt:number,now:number):SkillReadObservation[]{
 if(!Number.isFinite(startedAt)||!Number.isFinite(now)||now<startedAt||lines.length>8192||targets.length>128)return [];
 if(lines.reduce((n,line)=>n+Buffer.byteLength(line),0)>4*1024*1024)return [];
 const records:{raw:string;time:number;payload:any}[]=[];
 for(const raw of lines){
  if(Buffer.byteLength(raw)>1024*1024)continue;
  try{const row=JSON.parse(raw),time=typeof row.timestamp==='string'?Date.parse(row.timestamp):NaN;
   if(row.type==='response_item'&&Number.isFinite(time)&&time>=startedAt&&time<=now&&row.payload&&typeof row.payload==='object')records.push({raw,time,payload:row.payload});
  }catch{/* partial or malformed records are not evidence */}
 }
 const counts=new Map<string,{calls:number;outputs:number}>();
 for(const {payload:p} of records){if(typeof p.call_id!=='string'||!p.call_id||p.call_id.length>256)continue;
  const n=counts.get(p.call_id)??{calls:0,outputs:0};if(p.type==='function_call')n.calls++;if(p.type==='function_call_output')n.outputs++;counts.set(p.call_id,n);
 }
 const pending=new Map<string,{target:SkillReadTarget;time:number;raw:string}>(),found=new Map<string,SkillReadObservation>();
 for(const {raw,time,payload:p} of records){
  const count=counts.get(p.call_id);if(count?.calls!==1||count.outputs!==1)continue;
  if(p.type==='function_call'&&p.name==='exec_command'&&typeof p.arguments==='string'){
   try{const args=JSON.parse(p.arguments);if(typeof args.cmd!=='string'||Object.keys(args).some(k=>!['cmd','max_output_tokens','yield_time_ms'].includes(k)))continue;
    const matching=targets.filter(t=>t.path.startsWith('/')&&!/[\r\n\0]/.test(t.path)&&args.cmd==='/bin/cat '+quote(t.path));
    if(matching.length===1)pending.set(p.call_id,{target:matching[0],time,raw});
   }catch{/* unsupported command shape */}
  }else if(p.type==='function_call_output'&&typeof p.output==='string'){
   const call=pending.get(p.call_id);if(!call||time<call.time)continue;
   // Match the complete native wrapper, not a success phrase embedded in a file.
   const match=/^Chunk ID: [a-zA-Z0-9]+\nWall time: [0-9.]+ seconds\nProcess exited with code 0\n(?:Final output:\n|Original token count: [0-9]+\nOutput:\n)([\s\S]*)$/.exec(p.output);
   if(!match||match[1]!==call.target.content)continue;
   found.set(call.target.id,{skillId:call.target.id,observedAt:new Date(time).toISOString(),callId:p.call_id,recordHash:hash(call.raw+'\n'+raw)});
  }
 }
 return [...found.values()];
}
