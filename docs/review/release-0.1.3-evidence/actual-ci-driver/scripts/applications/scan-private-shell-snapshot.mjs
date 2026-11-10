// Dedicated release013 probe: digest-match only within this fresh M11 root; no secret values returned.
import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {lstat,readdir,realpath,open} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
const patterns=[['raw64hex',/(?=([a-fA-F0-9]{64}))/g],['base64',/(?=([A-Za-z0-9+/]{86}==))/g],['utf16le',/(?=((?:[a-fA-F0-9]\x00){64}))/g],['utf16be',/(?=((?:\x00[a-fA-F0-9]){64}))/g]];
export function matchDigestCandidates(bytes,hashes,baseOffset=0){
 const text=bytes.toString('latin1'),hits=[];
 for(const[form,pattern]of patterns)for(const m of text.matchAll(pattern)){
  const candidate=Buffer.from(m[1],'latin1'),digest=createHash('sha256').update(candidate).digest('hex');candidate.fill(0);
  if(digest===hashes[form])hits.push({form,offset:baseOffset+m.index});
 }
 return hits;
}
export async function scanPrivateShellSnapshot(root,probe){
 const resolved=await realpath(root);assert.equal(resolved,root);assert(root.startsWith('/private/tmp/willyou-m11-r10-release013-'));assert(Number.isInteger(constants.O_NOFOLLOW));
 assert.equal(probe.schema,'release013-own-token-digests-v1');assert.equal(probe.tokenLength,64);
 for(const key of['raw64hex','base64','utf16le','utf16be'])assert(/^[a-f0-9]{64}$/.test(probe.hashes[key]));
 const result={startedAt:new Date().toISOString(),scope:'Regular file contents beneath this fresh runtime root only; no symlink following; digest matching raw64hex/base64-of-ASCII/UTF16LE/UTF16BE, no token values stored',root,forms:Object.keys(probe.hashes),regularFiles:0,bytesRead:0,skippedSymlinks:[],skippedSpecialFiles:[],errors:[],matches:[]},seen=new Set();
 const contained=p=>p===root||p.startsWith(root+'/');
 async function walk(dir){
  assert(contained(await realpath(dir)),'Refuse directory outside own fresh root');
  for(const name of(await readdir(dir)).sort()){
   const path=join(dir,name),rel=relative(root,path);let h;
   try{
    const s=await lstat(path);if(s.isSymbolicLink()){result.skippedSymlinks.push(rel);continue;}if(s.isDirectory()){await walk(path);continue;}if(!s.isFile()){result.skippedSpecialFiles.push(rel);continue;}
    assert(contained(await realpath(path)),'Refuse file outside own fresh root');h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const actual=await h.stat();assert(actual.isFile()&&actual.dev===s.dev&&actual.ino===s.ino,'Own file identity changed before read');
    result.regularFiles++;let read=0,carry=Buffer.alloc(0);
    for await(const chunk of h.createReadStream({highWaterMark:65536,autoClose:false})){
     const bytes=Buffer.concat([carry,chunk]),start=read-carry.length;
     for(const hit of matchDigestCandidates(bytes,probe.hashes,start)){const key=rel+'|'+hit.form+'|'+hit.offset;if(!seen.has(key)){seen.add(key);result.matches.push({path:rel,offset:hit.offset,form:hit.form});}}
     read+=chunk.length;result.bytesRead+=chunk.length;carry=Buffer.from(bytes.subarray(Math.max(0,bytes.length-256)));
    }
   }catch(error){result.errors.push({path:rel,code:error.code??'PRIVATE_SCAN_FAILED'});}finally{if(h)await h.close();}
  }
 }
 await walk(root);result.finishedAt=new Date().toISOString();return result;
}
