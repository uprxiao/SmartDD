import { createHash } from 'node:crypto';

export interface SkillReadTarget { id:string; path:string; content:string; nativeName?:string }
export interface SkillReadObservation { skillId:string; observedAt:string; callId:string; recordHash:string }
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const quote=(text:string)=>"'"+text.replaceAll("'","'\\''")+"'";
/** A deliberately small, non-evaluating grammar for the observed native exec
 * wrapper. Arbitrary JS, extra shell commands and fabricated text are excluded. */
function execRead(input:unknown):{cmd:string;catalog:boolean}|null{
 if(typeof input!=='string'||input.length>8192)return null;
 const m=/^\s*text\(\s*await\s+tools\.exec_command\(\s*\{\s*cmd\s*:\s*("(?:[^"\\]|\\.)*")\s*((?:,\s*(?:max_output_tokens|yield_time_ms)\s*:\s*\d{1,6})*)\s*\}\s*\)\s*\)\s*;\s*([\s\S]*)$/.exec(input);
 if(!m)return null;
 const options=[...m[2].matchAll(/(max_output_tokens|yield_time_ms)\s*:/g)].map(x=>x[1]);if(new Set(options).size!==options.length)return null;
 const tail=m[3].trim(),catalog=tail.length>0;
 // Pure catalog inspection may accompany the one read. No callbacks other
 // than this bounded name/description filter are treated as evidence.
 if(catalog&&!/^text\(ALL_TOOLS\.filter\(([a-z])=>\/[A-Za-z0-9 .*|_-]{1,128}\/i?\.test\(\1\.name\+" "\+\1\.description\)\)\);$/.test(tail))return null;
 try{const cmd=JSON.parse(m[1]);return typeof cmd==='string'?{cmd,catalog}:null;}catch{return null;}
}
function execOutput(output:unknown,catalog:boolean):string|null{
 if(!Array.isArray(output)||output.length!==(catalog?3:2)||!output.every(v=>v?.type==='input_text'&&typeof v.text==='string'))return null;
 if(!/^Script completed\nWall time [0-9.]+ seconds\nOutput:\n$/.test(output[0].text))return null;
 try{
  const value=JSON.parse(output[1].text);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['chunk_id','wall_time_seconds','exit_code','original_token_count','output'].includes(k))||value.exit_code!==0||typeof value.chunk_id!=='string'||!/^[A-Za-z0-9]+$/.test(value.chunk_id)||!Number.isFinite(value.wall_time_seconds)||value.wall_time_seconds<0||!Number.isSafeInteger(value.original_token_count)||value.original_token_count<0||typeof value.output!=='string')return null;
  if(catalog){const list=JSON.parse(output[2].text);if(!Array.isArray(list)||list.length>512||!list.every(v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>k==='name'||k==='description')&&typeof v.name==='string'&&typeof v.description==='string'))return null;}
  return value.output;
 }catch{return null;}
}
/** Parses an already ownership-verified Codex 0.162.1 log window. This is diagnostic
 * evidence, never user intent or authorization. Callers must verify the native
 * session/header, file identity and fixed projection contents before AND after IO.
 * Accepts exact cat invocations in the original function-call format and the
 * bounded native exec wrapper, each with a complete successful output.
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
  const n=counts.get(p.call_id)??{calls:0,outputs:0};if(p.type==='function_call'||p.type==='custom_tool_call')n.calls++;if(p.type==='function_call_output'||p.type==='custom_tool_call_output')n.outputs++;counts.set(p.call_id,n);
 }
 const pending=new Map<string,{target:SkillReadTarget;time:number;raw:string;format:'legacy'|'exec';catalog?:boolean}>(),found=new Map<string,SkillReadObservation>();
 for(const {raw,time,payload:p} of records){
  const count=counts.get(p.call_id);if(count?.calls!==1||count.outputs!==1)continue;
  if(p.type==='function_call'&&p.name==='exec_command'&&typeof p.arguments==='string'){
   try{const args=JSON.parse(p.arguments);if(typeof args.cmd!=='string'||Object.keys(args).some(k=>!['cmd','max_output_tokens','yield_time_ms'].includes(k)))continue;
    const matching=targets.filter(t=>t.path.startsWith('/')&&!/[\r\n\0]/.test(t.path)&&args.cmd==='/bin/cat '+quote(t.path));
    if(matching.length===1)pending.set(p.call_id,{target:matching[0],time,raw,format:'legacy'});
   }catch{/* unsupported command shape */}
  }else if(p.type==='function_call_output'&&typeof p.output==='string'){
   const call=pending.get(p.call_id);if(!call||time<call.time)continue;
   // Match the complete native wrapper, not a success phrase embedded in a file.
   const match=/^Chunk ID: [a-zA-Z0-9]+\nWall time: [0-9.]+ seconds\nProcess exited with code 0\n(?:Final output:\n|Original token count: [0-9]+\nOutput:\n)([\s\S]*)$/.exec(p.output);
   if(call.format!=='legacy'||!match||match[1]!==call.target.content)continue;
   found.set(call.target.id,{skillId:call.target.id,observedAt:new Date(time).toISOString(),callId:p.call_id,recordHash:hash(call.raw+'\n'+raw)});
  }else if(p.type==='custom_tool_call'&&p.name==='exec'){
   const read=execRead(p.input);if(!read)continue;
   const matching=targets.filter(t=>t.path.startsWith('/')&&!/[\r\n\0]/.test(t.path)&&["/bin/cat "+quote(t.path),'cat '+quote(t.path),...(/^[A-Za-z0-9_./-]+$/.test(t.path)?['cat '+t.path,'/bin/cat '+t.path]:[])].includes(read.cmd));
   if(matching.length===1)pending.set(p.call_id,{target:matching[0],time,raw,format:'exec',catalog:read.catalog});
  }else if(p.type==='custom_tool_call_output'){
   const call=pending.get(p.call_id);if(!call||call.format!=='exec'||time<call.time||execOutput(p.output,!!call.catalog)!==call.target.content)continue;
   found.set(call.target.id,{skillId:call.target.id,observedAt:new Date(time).toISOString(),callId:p.call_id,recordHash:hash(call.raw+'\n'+raw)});
  }
 }
 return [...found.values()];
}
