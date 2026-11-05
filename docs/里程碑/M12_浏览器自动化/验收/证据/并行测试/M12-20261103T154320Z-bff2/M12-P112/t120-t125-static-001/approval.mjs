import assert from 'node:assert/strict';
import {readFile,realpath,stat} from 'node:fs/promises';
import {ROOT,sha} from './io.mjs';
export function validateAuthorization(receipt,{payloadSha256,marker}){
 assert(receipt?.status==='explicitly-authorized','SOP_NEW_PAYLOAD_NOT_AUTHORIZED');
 assert.equal(receipt.scope,'M12-T120-T125-SOP-REPRODUCE-FIX','Prior or wider unreviewed scope is not this payload receipt');
 assert.equal(receipt.payloadSha256,payloadSha256);assert.equal(receipt.marker,marker);
 assert.equal(receipt.destination?.provider,'openai');assert.equal(receipt.destination?.model,'gpt-6.1-sol');
 assert(typeof receipt.userMessageReference==='string'&&receipt.userMessageReference.length>0);
 return true;
}
export function validateLease(lease,{executable,now=Date.now()}){
 assert(lease?.status==='granted'&&lease.coordinator==='root','No coordinator resource grant');
 assert.equal(lease.privateRoot,ROOT);assert.equal(lease.executable,executable);
 assert(lease.resources?.includes('Native')&&lease.resources.includes('UI')&&lease.resources.includes('PTY'));
 assert(Number.isFinite(Date.parse(lease.notBefore))&&now>=Date.parse(lease.notBefore));
 assert(Number.isFinite(Date.parse(lease.expiresAt))&&now<Date.parse(lease.expiresAt));
 assert(lease.revoked!==true);assert(lease.initialFocusHook==null,'Passive exact-own NativeDOMvisible3s only; no automatic focus hook in this attempt');return true;
}
export async function verifyExecutionInputs(ready){
 assert.equal(await realpath(ROOT),ROOT);
 for(const input of ready.inputs){assert(!input.path.startsWith('/')&&!input.path.split('/').includes('..'));const p=ROOT+'/'+input.path;assert.equal(sha(await readFile(p)),input.sha256,input.path);assert.equal((await stat(p)).mode&511,input.mode,input.path);}
 return true;
}
// Called before any credential, CLI identity, App, listener, or OS operation.
export async function loadPermit({authorizationPath,leasePath}){
 assert.equal(authorizationPath,ROOT+'/authorization.receipt.json');assert.equal(leasePath,ROOT+'/lease.receipt.json');assert.equal(await realpath(authorizationPath),authorizationPath);assert.equal(await realpath(leasePath),leasePath);
 const [payloadBytes,configBytes,pinBytes,readyBytes,authorizationBytes,leaseBytes]=await Promise.all([readFile(ROOT+'/payload-review.json'),readFile(ROOT+'/batch-config.json'),readFile(ROOT+'/pin.json'),readFile(ROOT+'/execution-ready.json'),readFile(authorizationPath),readFile(leasePath)]);
 const payload=JSON.parse(payloadBytes),config=JSON.parse(configBytes),pin=JSON.parse(pinBytes),ready=JSON.parse(readyBytes),authorization=JSON.parse(authorizationBytes),lease=JSON.parse(leaseBytes);
 validateAuthorization(authorization,{payloadSha256:sha(payloadBytes),marker:config.marker});validateLease(lease,{executable:pin.executable});await verifyExecutionInputs(ready);
 return {config,payload,pin,ready,lease,payloadSha256:sha(payloadBytes),authorizationReference:authorization.userMessageReference};
}
