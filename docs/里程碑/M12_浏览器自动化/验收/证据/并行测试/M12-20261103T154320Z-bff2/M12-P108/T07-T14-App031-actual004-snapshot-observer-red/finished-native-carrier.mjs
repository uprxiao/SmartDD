// Header grammar reused from accepted P108 T09 finished-cli-text.mjs (d0280d39…94ac).
// Finite completed carrier only. No warning stripping, loose JSON search, running-session inference or model JS execution.
import assert from'node:assert/strict';
export function unwrapFinishedNativeCarrier({text,carrierKind,childExitCodeObserved}){
 assert(typeof text==='string'&&Number.isInteger(childExitCodeObserved));
 if(carrierKind==='legacy-function-call-output'){
  const m=/^Chunk ID: ([a-f0-9]{6,64})\nWall time: ([0-9]+(?:\.[0-9]+)?) seconds\nProcess exited with code (-?[0-9]+)\nOriginal token count: ([0-9]+)\nOutput:\n/.exec(text);
  assert(m,'Only exact original finished legacy carrier');const exit=Number(m[3]);assert(Number.isSafeInteger(exit)&&Number.isFinite(Number(m[2])));assert.equal(exit,childExitCodeObserved,'Original carrier exit must equal typed numeric exit');
  return{body:text.slice(m[0].length),carrier:{kind:carrierKind,chunkId:m[1],wallTimeSeconds:Number(m[2]),childExitCodeObserved:exit,originalTokenCount:Number(m[4]),headerBytes:Buffer.byteLength(m[0]),completed:true}};
 }
 assert.equal(carrierKind,'custom-sequential-full-result','Unknown outer carrier is not raw Native stdout');
 return{body:text,carrier:{kind:carrierKind,childExitCodeObserved,completed:true,headerBytes:0}};
}
