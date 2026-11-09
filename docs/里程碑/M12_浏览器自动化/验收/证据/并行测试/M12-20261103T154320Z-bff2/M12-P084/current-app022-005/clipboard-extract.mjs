import assert from'node:assert/strict';
export const packageHash='d160b699f23c03712297ec6a2025e8898abacc36a4febf6d6229e8beea2b3fd6';
export function clipboardOutput(argv,event,expected){
 // receiver has compared the COMPLETE exact envelope before allowing stdout.
 // Unexpected values remain exclusively in its 0600 private capture.
 assert.equal(event.expectedSyntheticValueMatched,true,'Clipboard value/schema not exactly expected; raw output private');
 assert.equal(event.clipboardOutputPrivate,false);assert.equal(event.stderr,'');
 const v=JSON.parse(event.stdout),write=argv[2]==='write';
 assert.equal(v.schema,'willyou-app-result-v2');assert.equal(v.status,'ok');assert.equal(v.contractMajor,2);
 assert.equal(v.capabilityId,write?'browser.env.clipboard-write':'browser.env.clipboard-read');
 assert.deepEqual(v.source,{appId:'browser',revision:null,packageHash,connections:[]});
 assert.equal(v.operation.origin,'cli');assert.equal(v.operation.effectState,write?'completed':'read-only');
 assert.deepEqual(v.data,{result:{[write?'written':'text']:expected}});
 return v;
}
