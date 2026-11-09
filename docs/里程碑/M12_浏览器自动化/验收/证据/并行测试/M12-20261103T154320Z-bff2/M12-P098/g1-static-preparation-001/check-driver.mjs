// Static source/embedded-expression checks only. No module under test is executed.
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile} from 'node:fs/promises';
import {ROOT} from './io.mjs';
const paths=['run.mjs','ui.mjs','driver-source/scripts/lib/app-focus-guard.mjs'],checks=[];let literals=0,ownBodies=0,labels=0;
for(const path of paths){const code=await readFile(ROOT+'/'+path,'utf8'),source=ts.createSourceFile(path,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const visit=node=>{
  if(ts.isCallExpression(node)){
   const method=ts.isPropertyAccessExpression(node.expression)?node.expression.name.text:null,arg=node.arguments[0];
   if(['evaluate','waitFor','mainEvaluate'].includes(method)&&(ts.isStringLiteral(arg)||ts.isNoSubstitutionTemplateLiteral(arg))){new Function(arg.text);literals++;}
   if(method==='mainEvaluate'){const options=node.arguments[1];assert(options&&ts.isObjectLiteralExpression(options)&&options.properties.some(p=>(ts.isPropertyAssignment(p)||ts.isShorthandPropertyAssignment(p))&&p.name.getText(source).replaceAll(/['"]/g,'')==='label'),'Every native main expression carries a label');labels++;}
   if(ts.isIdentifier(node.expression)&&node.expression.text==='own'&&(ts.isStringLiteral(arg)||ts.isNoSubstitutionTemplateLiteral(arg))){new Function('(()=>{const E={};'+arg.text+'})()');assert(ts.isStringLiteral(node.arguments[1]),'Own main action must have fixed safe label');ownBodies++;}
  }
  ts.forEachChild(node,visit);
 };visit(source);
}
checks.push({name:'Literal renderer/native expressions and exact-own main bodies parse without execution',passed:true,literals,ownBodies,mainLabels:labels});
const run=await readFile(ROOT+'/run.mjs','utf8'),approval=await readFile(ROOT+'/approval.mjs','utf8');
assert(run.indexOf('await loadPermit(')<run.indexOf('await readPrivateCredentialPackage('));assert(run.indexOf('await loadPermit(')<run.indexOf('await resolveRealCli('));assert(run.indexOf('await loadPermit(')<run.indexOf('app=await openElectron('));
assert(run.includes("process.pid!==${app.processId}")&&run.includes("process.execPath!==${JSON.stringify(pin.executable)}"));
assert(!run.includes("app.invoke('tasks.create'")&&!run.includes("app.invoke('tasks.start'"));
assert(run.includes("await ui.click('[data-testid=home-launch]')"));
assert(run.includes('Date.now()-stable>=1000')&&run.includes('dom.focused')&&run.includes("dom.visibility==='visible'")&&run.includes('&&native'));
assert(!run.includes('Page.bringToFront'));assert(run.includes('hookInvocations++')&&run.includes('hook.oneShot===true'));
assert(approval.includes('M12-G1-T122-T126-browser-only')&&approval.includes('payloadSha256')&&approval.includes('userMessageReference'));
checks.push({name:'Authorization before auth/CLI/App; actual UI launches; exact own PID/exe/userData; one-shot hook and Native+DOM1s mandatory',passed:true});
const expected=JSON.parse(await readFile(ROOT+'/real-cli-expected.json'));for(const key of ['launcherSha256','nativeBinarySha256','nodeSha256','sourceConfigSha256'])assert(/^[a-f0-9]{64}$/.test(expected[key]));checks.push({name:'Frozen R006 nonsecret CLI/config identity expected SHA fields present',passed:true});
const result={at:new Date().toISOString(),status:'static-driver-check-pass',checks,executedExpressions:false,appsStarted:0,modelCalls:0,authReads:0,formalNewPasses:0};await writeFile(ROOT+'/driver-static-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,literals,ownBodies,labels,formalNewPasses:0}));
