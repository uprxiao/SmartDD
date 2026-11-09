import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import type {SkillReadTarget,SkillReadObservation} from './codex-skill-read-evidence';
/** Native developer catalog observation only. Does not certify reading or model use. */
export function codexSkillDiscoveryEvidence(lines:readonly string[],targets:readonly SkillReadTarget[],startedAt:number,now:number):SkillReadObservation[]{
 if(!Number.isFinite(startedAt)||!Number.isFinite(now)||now<startedAt||lines.length>8192||targets.length>128||lines.reduce((n,l)=>n+Buffer.byteLength(l),0)>4*1024*1024)return [];
 const found=new Map<string,SkillReadObservation>();
 for(const raw of lines){
  if(Buffer.byteLength(raw)>1024*1024)continue;
  try{
   const r=JSON.parse(raw),p=r.payload,time=typeof r.timestamp==='string'?Date.parse(r.timestamp):NaN;
   if(r.type!=='response_item'||p?.type!=='message'||p.role!=='developer'||!Number.isFinite(time)||time<startedAt||time>now||!Array.isArray(p.content))continue;
   for(const c of p.content){
    if(c?.type!=='input_text'||typeof c.text!=='string')continue;
    const text:string=c.text;const sections=[...text.matchAll(/<skills_instructions>\n([\s\S]*?)\n<\/skills_instructions>/g)];if(sections.length!==1)continue;
    const block=sections[0][1],split=block.split('\n### Available skills\n');if(split.length!==2)continue;
    const rootSections=split[0].split('\n### Skill roots\n');if(rootSections.length!==2)continue;
    const roots=new Map<string,string>();let invalid=false;
    for(const line of rootSections[1].split('\n')){const m=/^- `(r\d+)` = `(\/[^`\r\n]+)`$/.exec(line);if(!m||roots.has(m[1])||posix.normalize(m[2])!==m[2]){invalid=true;break;}roots.set(m[1],m[2]);}
    if(invalid)continue;
    const catalog=split[1].split('\n').map(line=>/^- ([a-zA-Z0-9_-]+): .+ \(file: (r\d+)\/([^\r\n]+)\)$/.exec(line)).filter((v):v is RegExpExecArray=>v!==null);
    for(const target of targets){
     if(!target.nativeName)continue;
     const entries=catalog.filter(m=>m[1]===target.nativeName);if(entries.length!==1)continue;
     const m=entries[0],root=roots.get(m[2]);if(!root||m[3].split('/').some(p=>p==='..'||p==='.'||!p)||posix.join(root,m[3])!==target.path)continue;
     const recordHash=createHash('sha256').update(raw).digest('hex');found.set(target.id,{skillId:target.id,observedAt:new Date(time).toISOString(),callId:'catalog:'+recordHash,recordHash});
    }
   }
  }catch{/* unknown native record stays unverified */}
 }
 return [...found.values()];
}
