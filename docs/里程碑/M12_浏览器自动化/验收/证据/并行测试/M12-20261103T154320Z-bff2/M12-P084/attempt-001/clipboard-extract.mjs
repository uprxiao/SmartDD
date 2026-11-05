import assert from'node:assert/strict';
export const packageHash='eb7f1cbfad4f8d9246ff261f8b64b2d8d778d6c28ae551b9f926fb8998f86140';
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
