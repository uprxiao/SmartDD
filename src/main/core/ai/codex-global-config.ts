import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import type { CodexGlobalSettings } from '@shared/agent-run-state';
/** Observe exactly two public preferences; never persist the source, authentication,
 * arbitrary TOML fields, or parse-error excerpts, and never write global config. */
export function readCodexGlobalSettings(root:string):CodexGlobalSettings {
  try {
    const path=join(root,'config.toml');
    const fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK);let text:string;
    try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>1024*1024)return {status:'unreadable',model:null,effort:null};
      const bytes=Buffer.alloc(1024*1024+1),length=readSync(fd,bytes,0,bytes.length,null);if(length>1024*1024)return {status:'unreadable',model:null,effort:null};
      text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
    }finally{closeSync(fd);}
    const parsed=parse(text);
    const value=(v:unknown)=>typeof v==='string'&&v.length<=256&&!/[\x00-\x1f\x7f]/.test(v)?v:null;
    return {status:'readable',model:value(parsed.model),effort:value(parsed.model_reasoning_effort)};
  }catch(e){return {status:(e as NodeJS.ErrnoException).code==='ENOENT'?'missing':'unreadable',model:null,effort:null};}
}
export function codexGlobalSettingsChanged(before:CodexGlobalSettings,after:CodexGlobalSettings):boolean {
  return before.status!=='unreadable'&&after.status!=='unreadable'&&(before.model!==after.model||before.effort!==after.effort);
}
