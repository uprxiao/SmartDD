import assert from 'node:assert/strict';
import {readFile,writeFile,stat,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const root='/private/tmp/willyou-m12-p070-prototype-visual-005',sha=b=>createHash('sha256').update(b).digest('hex'),p=JSON.parse(await readFile(root+'/prepared.json')),c=JSON.parse(await readFile(root+'/component-build.json'));
assert.equal(sha(await readFile(p.sourceManifest)),p.sourceManifestSha256);
for(const f of p.sourceFiles){assert.equal(sha(await readFile(root+'/'+f.path)),f.sha256);assert.equal(sha(await readFile(f.upstream)),f.sha256);}
for(const f of p.distFiles)for(const prefix of [p.servedDist,p.distSource]){const path=prefix+'/'+f.path;assert.equal(sha(await readFile(path)),f.sha256,path);assert.equal((await stat(path)).mode&511,f.mode,path);}
for(const f of c.inputs)assert.equal(sha(await readFile(f.path)),f.sha256,f.path);
for(const f of c.files)assert.equal(sha(await readFile(root+'/'+f.path)),f.sha256,f.path);
assert.equal(sha(await readFile(p.browser.path)),p.browser.sha256);assert((await stat(p.browser.path)).mode&73);
try{await access(root+'/execution-started.json');throw Error('Already executed; frozen one-attempt root cannot replay');}catch(e){if(e.code!=='ENOENT')throw e;}
for(const f of ['run.mjs','judge.mjs','verify-cleanup.mjs','build-component.mjs'])execFileSync(process.execPath,['--check',root+'/'+f]);
const ts=createRequire('/Users/liubu/hx/4.uprxiao/SmartDD/package.json')('typescript'),driver=await readFile(root+'/run.mjs','utf8'),sf=ts.createSourceFile('run.mjs',driver,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(sf.parseDiagnostics.length,0);let compiled=0;
function visit(n){if(ts.isArrowFunction(n)||ts.isFunctionExpression(n)){new Function('return ('+n.getText(sf)+')');compiled++;}ts.forEachChild(n,visit);}visit(sf);
assert(driver.indexOf("execution-started.json")<driver.indexOf('const server=createServer'));
assert(driver.indexOf('server.listen(')<driver.indexOf('browser=spawn('));
assert(!driver.includes('--no-sandbox'));assert(!driver.includes('--disable-web-security'));
const localInputs=['run.mjs','judge.mjs','verify-cleanup.mjs','build-component.mjs','component-entry.jsx','prepared.json','component-build.json','contract.json','preparation-notes.json'];const inputs=[];for(const path of localInputs){const b=await readFile(root+'/'+path);inputs.push({path,bytes:b.length,sha256:sha(b)});}
const output={at:new Date().toISOString(),status:'ready-static-only',nativeStarted:false,listenersStarted:false,browserStarted:false,sourceManifestSha256:p.sourceManifestSha256,sourceFiles:p.sourceFiles.length,distFiles:p.distFiles.length,componentInputModules:c.inputs.length,componentOutputs:c.files.length,compiledFunctionExpressions:compiled,inputs,browser:p.browser,boundary:'Only file/hash/syntax/expression compilation; no browser or server execution. Main full P and private component results remain separate; no formal T111 credit.'};await writeFile(root+'/static-preflight.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({status:output.status,sourceFiles:output.sourceFiles,distFiles:output.distFiles,componentInputModules:output.componentInputModules,compiledFunctionExpressions:compiled,sha256:sha(await readFile(root+'/static-preflight.json'))}));
