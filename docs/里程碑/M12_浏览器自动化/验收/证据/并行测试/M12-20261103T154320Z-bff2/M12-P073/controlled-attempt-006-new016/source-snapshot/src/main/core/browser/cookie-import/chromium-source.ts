// Stable SQLite/WAL copy and macOS v10 decoding adapted from Orca bd9455b6165,
// MIT, Copyright (c) 2026 Lovecast Inc. No prefix-byte heuristic: schema 24+
// requires the exact source host hash, including for an empty cookie value.
import {createDecipheriv,createHash,pbkdf2Sync,timingSafeEqual} from 'node:crypto';
import {chmod,copyFile,lstat,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

export class BrowserCookieSourceError extends Error {
  constructor(readonly reason:'source-missing'|'source-unreadable'|'cookies-undecryptable'|'keychain-denied'|'keychain-timeout',message:string){super(message);}
}
export function deriveMacChromiumCookieKey(password:Uint8Array):Buffer{return pbkdf2Sync(password,'saltysalt',1003,16,'sha1');}
export function decryptMacChromiumCookie({encrypted,key,hostKey,version}:{encrypted:Buffer;key:Buffer;hostKey:string;version:number}):string{
  let plain:Buffer|undefined;
  try{
    if(key.length!==16||encrypted.subarray(0,3).toString('ascii')!=='v10'||encrypted.length<=3)throw Error();
    const decoder=createDecipheriv('aes-128-cbc',key,Buffer.alloc(16,0x20));plain=Buffer.concat([decoder.update(encrypted.subarray(3)),decoder.final()]);
    let value=plain;
    if(version>=24){const expected=createHash('sha256').update(hostKey).digest();if(plain.length<32||!timingSafeEqual(plain.subarray(0,32),expected))throw Error();value=plain.subarray(32);}
    // Legacy CBC has no host integrity prefix; decode its actual format, never
    // guess that a non-printable prefix should be removed.
    return new TextDecoder('utf-8',{fatal:true}).decode(value);
  }catch{throw new BrowserCookieSourceError('cookies-undecryptable','无法解密来源Cookie；目标登录态尚未写入');}
  finally{plain?.fill(0);}
}
async function state(path:string){
  try{const s=await lstat(path,{bigint:true});if(!s.isFile()||s.isSymbolicLink())throw new BrowserCookieSourceError('source-unreadable','来源Cookie库不是普通文件');return{device:s.dev,inode:s.ino,size:s.size,modified:s.mtimeNs,changed:s.ctimeNs};}
  catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return null;throw error;}
}
type FileState=Awaited<ReturnType<typeof state>>;
function same(a:FileState,b:FileState){return a===null||b===null?a===b:a.device===b.device&&a.inode===b.inode&&a.size===b.size&&a.modified===b.modified&&a.changed===b.changed;}
/** Reads only the selected source DB and WAL. SQLite reconstructs SHM in this
 * private copy; it never opens or repairs the user's original database. */
export async function snapshotChromiumCookies(source:string,temporaryRoot=tmpdir()):Promise<{path:string;cleanup:()=>Promise<void>}>{
  const directory=await mkdtemp(join(temporaryRoot,'willyou-cookie-source-')),destination=join(directory,'Cookies');await chmod(directory,0o700);let kept=false;
  try{
    for(let attempt=0;attempt<5;attempt++){
      for(const suffix of ['','-wal','-shm'])await rm(destination+suffix,{force:true});
      const before=await state(source),wal=await state(source+'-wal');if(!before)throw new BrowserCookieSourceError('source-missing','找不到所选浏览器的Cookie库');
      await copyFile(source,destination);await chmod(destination,0o600);
      if(wal)try{await copyFile(source+'-wal',destination+'-wal');await chmod(destination+'-wal',0o600);}catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')continue;throw error;}
      if(!same(before,await state(source))||!same(wal,await state(source+'-wal')))continue;
      if((await state(destination))?.size!==before.size||(wal?(await state(destination+'-wal'))?.size!==wal.size:await state(destination+'-wal')!==null))continue;
      kept=true;return{path:destination,cleanup:()=>rm(directory,{recursive:true,force:true})};
    }
    throw new BrowserCookieSourceError('source-unreadable','复制期间来源Cookie库持续变化，请稍后重试');
  }catch(error){if(error instanceof BrowserCookieSourceError)throw error;throw new BrowserCookieSourceError('source-unreadable','无法读取所选浏览器的Cookie库');}
  finally{if(!kept)await rm(directory,{recursive:true,force:true});}
}
