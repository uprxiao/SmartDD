import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {ROOT,sha,verifyPin} from './io.mjs';
export async function permit(){
 const readyBytes=await readFile(ROOT+'/execution-ready.json'),ready=JSON.parse(readyBytes),payloadBytes=await readFile(ROOT+'/payload-review.json'),authorization=JSON.parse(await readFile(ROOT+'/authorization.receipt.json')),lease=JSON.parse(await readFile(ROOT+'/lease.receipt.json')),pin=JSON.parse(await readFile(ROOT+'/pin.json'));
 assert(['authorized','explicitly-authorized'].includes(authorization.status));assert.equal(authorization.scope,'M12-T123-T124-R-A');assert.equal(authorization.payloadSHA256,sha(payloadBytes));assert(authorization.userAuthorizationReferences?.length||authorization.userMessageReference,'Existing authorization evidence required; do not fabricate verbatim consent');assert.equal(authorization.destination?.provider,'openai');assert.equal(authorization.destination?.model,'gpt-6.1-sol');
 const check=()=>{assert.equal(lease.status,'granted');assert.equal(lease.coordinator,'root');assert.equal(lease.privateRoot,ROOT);assert.equal(lease.executionReadySHA256,sha(readyBytes));assert.equal(lease.executable,pin.executable);assert(['Native','UI','App','PTY','HTTP','TCP','Unix','OS'].every(resource=>lease.resources.includes(resource)));assert(!lease.revoked&&Date.now()>=Date.parse(lease.notBefore)&&Date.now()<Date.parse(lease.expiresAt));};check();
 for(const input of ready.inputs){const path=input.external?input.path:ROOT+'/'+input.path;assert.equal(sha(await readFile(path)),input.sha256,path);assert.equal((await stat(path)).mode&511,input.mode,path)}await verifyPin(pin);
 return{payload:JSON.parse(payloadBytes),pin,check,payloadSHA256:sha(payloadBytes),authorizationReference:authorization.userAuthorizationReferences??[authorization.userMessageReference]};
}
