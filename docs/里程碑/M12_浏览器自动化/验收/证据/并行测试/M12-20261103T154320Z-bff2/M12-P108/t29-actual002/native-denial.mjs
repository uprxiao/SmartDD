import assert from'node:assert/strict';
let rules,accepted=[];
const allowed=new Set(['default-cli:allowed','default-cli:denied','named-base:allowed','named-base:denied','named-cli:allowed','named-cli:denied']);
export const exactError=(host)=>'exec_command failed: ProcessFailed { message: '+JSON.stringify('Network access to "'+host+'" was blocked: domain is not on the allowlist for the current sandbox mode.')+' }';
export function configureDenials(items){assert.equal(items.length,6);assert.deepEqual(new Set(items.map(x=>x.target.role+':'+x.target.name)),allowed);rules=structuredClone(items);accepted=[];}
export function nativeToolDenied({output,target,options={},originalError}){
 assert(rules,'Independent actual-source binding first');assert(!target.alias);assert(allowed.has(target.role+':'+target.name));assert.equal(target.host,target.name+'.localhost');assert(Number.isInteger(target.port));assert(options.mustDeny===undefined||typeof options.mustDeny==='boolean');assert.equal(output.childExitCodeObserved,null,'Never replace known nonzero/zero exit with policy proof');assert.equal(output.exitCode,null);assert.equal(output.childExitUnknown,true);assert.equal(output.outerCompleted,false);
 const matched=rules.filter(r=>JSON.stringify(r.target)===JSON.stringify(target));assert.equal(matched.length,1);const r=matched[0];assert.deepEqual(output.__t29NativeEvidence,r.evidence,'Exact current role/note/source/call/line/time');assert.equal(output.stdout.trim(),exactError(target.host),'Entire original native policy error, no contains-based approval');assert.equal(output.stdout,r.exactOutput);assert.equal(r.expectedCommand,r.actualCommand);assert(!/authorization|[a-z]+:\/\/[^\s/]*@/i.test(output.stdout));
 accepted.push({target:{...target},evidence:{...r.evidence},authority:'native-exec-ProcessFailed-domain-allowlist-policy',childExitObserved:null,rawVerbosePublished:false});
 return{schema:'t29-native-tool-policy-proof-v1',kind:'domain',target:{...target},authority:'native-exec-ProcessFailed-domain-allowlist-policy',curlExitObserved:null,childExitObserved:null,httpStatus:null,bodyCanaryObserved:false,reached:false,classification:'policy-denied',reason:'domain-not-allowlisted',errnoObserved:null,errnoNameDerived:null,rawPrinted:false,helperExecutedNotClaimed:true};
}
export function acceptedDenials(){return structuredClone(accepted)}
