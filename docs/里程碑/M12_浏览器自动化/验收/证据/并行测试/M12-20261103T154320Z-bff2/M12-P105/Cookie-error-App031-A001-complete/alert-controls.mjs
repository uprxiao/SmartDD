import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{ROOT,sha}from'./io.mjs';import{assertReadableImportFailureAlert}from'./alert-check.mjs';
export async function runAlertControls(){
 const bytes=await readFile(ROOT+'/alert-samples.json'),sample=JSON.parse(bytes),checks=[];
 for(const text of sample.expectedBusinessExamples){assert(assertReadableImportFailureAlert(text));checks.push({kind:'positive-business-text',accepted:true})}
 for(const row of sample.badActual003){assert.throws(()=>assertReadableImportFailureAlert(row.alert));checks.push({kind:'original003-'+row.kind,rejected:true})}
 for(const text of['Error: synthetic failure',' \nError : synthetic failure','Error invoking remote method hidden','browser.importCookies failed','browser:importCookies failed','  ',null,23,{message:'synthetic'}]){assert.throws(()=>assertReadableImportFailureAlert(text));checks.push({kind:'typed-or-wrapper-negative',rejected:true})}
 return{sampleSHA256:sha(bytes),source:sample.sourceRaw,positives:checks.filter(x=>x.accepted).length,negatives:checks.filter(x=>x.rejected).length,allPassed:true,checks,NativeAppExecuted:false};
}
