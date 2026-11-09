import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const root='/private/tmp/willyou-m12-p092-fixed-coalition-long-001',payload=root+'/payload',source=await readFile(root+'/run.mjs','utf8');
const match=source.match(/await writeFile\(payload\+'\/expected-cohort\.json'[\s\S]*?;/);assert(match);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;let data;
await new AsyncFunction('writeFile','payload','appEvent','started','raw','readFile',match[0])(async(path,value)=>{assert.equal(path,payload+'/expected-cohort.json');data=value;},payload,{pid:101},{driverPid:202},{wrapperResourceId:303,externalResourceIds:[404]},readFile);
let actual;try{actual=JSON.parse(data);assert.equal(data.at(-1),'\n');assert.equal(actual.driverPid,202);assert.equal(actual.resourceId,303);assert.deepEqual(actual.externalResourceIds,[404]);}catch(error){await writeFile(root+'/cohort-fence-preparation-error.json',JSON.stringify({staticOnly:true,NativeStarted:false,error:String(error),dataSuffix:data.slice(-8),literalSlashN:data.endsWith('\\n')},null,2)+'\n');throw error;}
await writeFile(root+'/cohort-fence-static-check.json',JSON.stringify({staticOnly:true,NativeStarted:false,exactGeneratedWriteStatementRoundtrip:true,actualFinalLF:true,testValuesSynthetic:true,sourceManifestHashPresent:typeof actual.sourceManifestSha256==='string'},null,2)+'\n');
console.log('Exact cohort fence write statement parses, finalLF valid; no actual fence or Native created');
