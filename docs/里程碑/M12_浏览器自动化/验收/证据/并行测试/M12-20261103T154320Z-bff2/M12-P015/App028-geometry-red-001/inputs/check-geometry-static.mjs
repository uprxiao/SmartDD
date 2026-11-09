import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{spawnSync}from'node:child_process';import{createRequire}from'node:module';import{createHash}from'node:crypto';
import{assertDriverLabels}from'./check-labels.mjs';import{installObservation,readObservation,restoreObservation}from'./observe.mjs';
import{installNativeGeometry,readNativeGeometry,restoreNativeGeometry,installDOMGeometry,readDOMGeometry,restoreDOMGeometry}from'./geometry-observer.mjs';
import{geometryDelegateControls}from'./geometry-controls.mjs';
const ROOT='/private/tmp/willyou-m12-t015-App028-geometry-diagnostic-001',sha=b=>createHash('sha256').update(b).digest('hex');
const r={PID:process.pid,startedAt:new Date().toISOString(),scope:'Sequential Node--check, TS AST, labels, generated-expression compile, exact private file identities and fake EventEmitter/native-view delegation controls only. No Electron/App/addon/OS/HTTP/Downloads/provider/auth/model/product body.',syntax:[],generated:[]};
assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/cache/node-static');console.log(JSON.stringify({checkerPID:process.pid,stage:'t015-geometry-pure-static'}));
try{
  const ts=createRequire(ROOT+'/package.json')('typescript');assert.equal(fs.realpathSync(ROOT+'/node_modules'),'/private/tmp/willyou-m12-t015-App027-A-001/node_modules');
  const files=[...fs.readdirSync(ROOT).filter(x=>x.endsWith('.mjs')).map(x=>ROOT+'/'+x),...fs.readdirSync(ROOT+'/driver-source/scripts/lib').filter(x=>x.endsWith('.mjs')).map(x=>ROOT+'/driver-source/scripts/lib/'+x)];
  for(const file of files.sort()){
    const x=spawnSync(process.execPath,['--check',file],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',NODE_COMPILE_CACHE:process.env.NODE_COMPILE_CACHE}});r.syntax.push({path:path.relative(ROOT,file),pid:x.pid,code:x.status,signal:x.signal,sha256:sha(fs.readFileSync(file)),stderr:x.stderr});assert.equal(x.status,0,file+' '+x.stderr);assert.equal(x.signal,null);
    const a=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(a.parseDiagnostics.length,0);
    const visit=n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='setPath'&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0]))assert.notEqual(n.arguments[0].text,'downloads');if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='own'&&n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])){new Function('return (async()=>{'+n.arguments[0].text+'})()');r.generated.push({kind:'literal-own-compiled-only',path:path.relative(ROOT,file)});}ts.forEachChild(n,visit);};visit(a);
  }
  r.labels=await assertDriverLabels(ROOT);
  for(const body of[installObservation(55),readObservation,restoreObservation,installNativeGeometry(55,'http://fixture.invalid/page'),readNativeGeometry,restoreNativeGeometry]){new Function('E',body);r.generated.push({kind:'native-observer-compile-only',sha256:sha(Buffer.from(body))});}
  for(const body of[installDOMGeometry({url:'file:///owned-main',timeOrigin:1}),readDOMGeometry,restoreDOMGeometry]){new Function('return '+body);r.generated.push({kind:'DOM-observer-compile-only',sha256:sha(Buffer.from(body))});}
  r.fakeDelegation=geometryDelegateControls();const phase=fs.readFileSync(ROOT+'/run-phase.mjs','utf8');assert(!phase.includes('finalExternal(')&&!phase.includes('.focus(')&&!phase.includes('dispatchEvent('));assert(phase.includes('const targets=[names.normal]')&&phase.includes('utilityResourceBirthCaptured=true'));assert(!phase.includes("stage='illegal-name'")&&!phase.includes("stage='slow-10MB-cancel'"));
  const pin=JSON.parse(fs.readFileSync(ROOT+'/pin.json'));assert.equal(sha(fs.readFileSync(pin.sourceManifest)),pin.sourceManifestSha256);assert.equal(Object.keys(JSON.parse(fs.readFileSync(pin.sourceManifest)).files).length,3689);
  for(const key of['buildGate','nativeGate','resourceGate'])assert.equal(sha(fs.readFileSync(pin[key].path)),pin[key].sha256);
  for(const x of[{path:pin.executable,sha256:pin.executableSha256,mode:493},...pin.packageFiles.map(x=>({...x,path:pin.app+'/Contents/Resources/'+x.path})),...pin.runtimeCoreFiles.map(x=>({...x,path:pin.app+'/'+x.path}))]){assert.equal(sha(fs.readFileSync(x.path)),x.sha256);assert.equal(fs.statSync(x.path).mode&511,x.mode);}
  for(const name of['runtime-core','runtime-open','home','raw.json'])assert(!fs.existsSync(ROOT+'/'+name));r.passed=true;
}catch(error){r.passed=false;r.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
r.finishedAt=new Date().toISOString();fs.writeFileSync(ROOT+'/static-check.json',JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({passed:r.passed,syntax:r.syntax.length,labels:r.labels?.calls?.length,generated:r.generated.length,fakeDelegation:r.fakeDelegation,error:r.error?.message??null}));
