import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {ROOT,sha,verifyPin} from './io.mjs';
export async function permit(){const bytes=await readFile(ROOT+'/execution-ready.json'),ready=JSON.parse(bytes),pin=JSON.parse(await readFile(ROOT+'/pin.json')),lease=JSON.parse(await readFile(ROOT+'/lease.receipt.json'));
 const check=()=>{assert.equal(lease.status,'granted');assert.equal(lease.coordinator,'root');assert.equal(lease.privateRoot,ROOT);assert.equal(lease.executable,pin.executable);assert.equal(lease.executionReadySHA256,sha(bytes));assert(['Native','UI','App','PTY','HTTP','TCP','Unix','OS'].every(resource=>lease.resources.includes(resource)));assert(!lease.revoked&&Date.now()>=Date.parse(lease.notBefore)&&Date.now()<Date.parse(lease.expiresAt));};check();
 for(const input of ready.inputs){const path=input.external?input.path:ROOT+'/'+input.path;assert.equal(sha(await readFile(path)),input.sha256,path);assert.equal((await stat(path)).mode&511,input.mode,path);}await verifyPin(pin);assert.equal(sha(await readFile(pin.openssl.path)),pin.openssl.sha256);return{pin,check};}
