import {canonicalJson,digest} from '../../../src/main/core/applications/manifest';
import {zentaoId,type ZentaoDetail} from './client';
interface FileCandidate {id:string;filename:string;size:number|null}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const fieldsBody=(detail:ZentaoDetail)=>Object.fromEntries(['steps','spec','description','verify','verifyCriteria'].filter(k=>detail.fields[k]!==undefined).map(k=>[k,detail.fields[k]]));
export const fieldPart=(key:string)=>'field-'+digest(key);
export const bodyBytes=(detail:ZentaoDetail)=>Buffer.from(canonicalJson(fieldsBody(detail)),'utf8');
export const jsonBytes=(value:unknown)=>Buffer.from(canonicalJson(value),'utf8');
function inlineFileId(raw:string,base:string):string|null{
  try{
    const decoded=raw.replace(/&(?:amp|quot|apos|#([0-9]+)|#x([0-9a-f]+));/gi,(s,decimal,hex)=>decimal||hex?String.fromCodePoint(parseInt(decimal??hex,decimal?10:16)):s.toLowerCase()==='&amp;'?'&':s.toLowerCase()==='&quot;'?'"':"'");
    const url=new URL(decoded,base),origin=new URL(base);if(url.origin!==origin.origin||url.username||url.password)return null;
    for(const [key,value] of url.searchParams)if(key.toLowerCase()==='fileid')return zentaoId(value);
    const match=/(?:\/files\/|file-(?:read|download)-)([0-9]{1,64})(?:[^0-9]|$)/i.exec(url.pathname);return match?zentaoId(match[1]):null;
  }catch{return null;}
}
/** Extract only IDs declared by the authorized object's server content; never follow its URLs. */
export function zentaoFiles(detail:ZentaoDetail,base:string):{files:FileCandidate[];missing:string[]}{
  const files=new Map<string,FileCandidate>(),missing:string[]=[];
  const add=(value:unknown)=>{
    if(!Array.isArray(value)&&!record(value)){if(value!==null&&value!==undefined)missing.push('attachment-metadata');return;}
    for(const [key,item] of Object.entries(value)){
      if(!record(item)){missing.push('attachment-metadata');continue;}
      let id:string;try{id=zentaoId(item.id??item.fileID??(!Array.isArray(value)?key:undefined));}catch{missing.push('attachment-identity');continue;}
      const hint=['title','name','filename','fileName'].map(k=>item[k]).find(v=>typeof v==='string'&&v.length>0);
      let name=typeof hint==='string'?hint:'file-'+id;const extension=typeof item.extension==='string'?item.extension.replace(/^\./,''):'';
      if(extension&&/^[a-z0-9]{1,20}$/i.test(extension)&&!name.toLowerCase().endsWith('.'+extension.toLowerCase()))name+='.'+extension;
      name=name.replace(/[\x00-\x1f\x7f/\\]/g,'_');if(name.length>1024){name='file-'+id;missing.push('attachment-filename:'+id);}
      const size=typeof item.size==='number'?item.size:typeof item.size==='string'&&/^\d+$/.test(item.size)?Number(item.size):null;
      if(size!==null&&(!Number.isSafeInteger(size)||size<0)){missing.push('attachment-size:'+id);continue;}
      files.set(id,{id,filename:name,size});
    }
  };
  add(detail.files);
  const actions=Array.isArray(detail.actions)?detail.actions:record(detail.actions)?Object.values(detail.actions):[];
  for(const action of actions)if(record(action)&&action.files!==undefined)add(action.files);
  const queue:unknown[]=[detail.fields,detail.actions];let nodes=0;
  while(queue.length&&nodes++<20000){
    const value=queue.pop();if(typeof value==='string'){
      const attrs=/\b(?:src|href|data-src|data-url)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;let match:RegExpExecArray|null;
      while((match=attrs.exec(value))){const id=inlineFileId(match[1]??match[2]??match[3],base);if(id&&!files.has(id))files.set(id,{id,filename:'file-'+id,size:null});}
    }else if(record(value)||Array.isArray(value))queue.push(...Object.values(value));
  }
  if(queue.length)missing.push('inline-scan-budget');if(files.size>200)missing.push('attachment-count-budget');
  return{files:[...files.values()].slice(0,200),missing};
}
