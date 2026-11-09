// Independent actual artifact bytes, never assistant path assertions alone.
import assert from 'node:assert/strict';import{readFile,lstat,realpath}from'node:fs/promises';import{resolve,relative,dirname}from'node:path';import{sha}from'./io.mjs';
export function validateArtifact({file,bytes,mode,taskRoot,capabilityId,format}){
 assert(file&&typeof file.path==='string'&&file.path.startsWith(taskRoot+'/'));assert.equal(resolve(file.path),file.path);assert(Number.isInteger(file.bytes)&&file.bytes>0&&file.bytes<=32*1024*1024);assert.equal(file.bytes,bytes.length);assert.equal(file.sha256,sha(bytes));assert.equal(mode,0o600);
 const kind=capabilityId.includes('screenshot')?'screenshot':capabilityId==='browser.capture.stop'?'har':'other';
 if(kind==='screenshot'){if(format==='jpeg')assert(bytes.subarray(0,3).equals(Buffer.from([255,216,255])));else{assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert(bytes.length>=33&&bytes.toString('ascii',12,16)==='IHDR');assert(bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0);}}
 if(kind==='har'){const har=JSON.parse(bytes.toString('utf8'));assert(har.log&&Array.isArray(har.log.entries));}
 return{path:file.path,bytes:file.bytes,sha256:file.sha256,mode,kind,capabilityId};
}
export async function collectArtifacts({receipts,userData,taskId}){
 const taskRoot=resolve(userData,'browser/artifacts',taskId),out=[];for(const rec of receipts){const file=rec.value?.data?.file;if(!file)continue;assert(file.path.startsWith(taskRoot+'/'),'Only real current task artifact');let p=file.path;while(p!==dirname(taskRoot)){const s=await lstat(p);assert(!s.isSymbolicLink());assert.equal(await realpath(p),p);if(p===taskRoot)break;p=dirname(p);}const stat=await lstat(file.path);assert(stat.isFile());const bytes=await readFile(file.path),proof=validateArtifact({file,bytes,mode:stat.mode&511,taskRoot,capabilityId:rec.value.capabilityId,format:rec.value.data.format});let parsed;if(!['screenshot'].includes(proof.kind))try{parsed=JSON.parse(bytes.toString('utf8'))}catch{assert(proof.kind!=='har','HAR must parse');}out.push({...proof,...(parsed===undefined?{}:{parsed}),operationId:rec.value.operation.id,requestId:rec.value.operation.requestId});}return out;
}
