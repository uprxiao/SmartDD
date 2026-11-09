// Static only: no broker/compiler, App, socket listen, kernel helper or OS probe.
import assert from 'node:assert/strict';
import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{spawnSync}from'node:child_process';
import{fileURLToPath}from'node:url';
import{createRequire}from'node:module';
import vm from'node:vm';
const root=fileURLToPath(new URL('.',import.meta.url)).replace(/\/$/,''),sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,root+'/cache');
const syntax=spawnSync(process.execPath,['--check',root+'/run.mjs'],{encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
const python=spawnSync('/usr/bin/python3',['-c',`import ast,pathlib,sys
for n in ['native_api.py','kernel.py','judge.py','test_judge.py']:ast.parse((pathlib.Path(sys.argv[1])/n).read_text())
print('Python AST only; no native imports')`,root],{encoding:'utf8'});assert.equal(python.status,0,python.stderr);
const require=createRequire(import.meta.url),ts=require('/private/tmp/willyou-m12-p069-parked-resource-001/source018-preparation-004/node_modules/typescript');
const source=await readFile(root+'/run.mjs','utf8'),ast=ts.createSourceFile('run.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),ctx={JSON,appEvent:{pid:1234},userData:root+'/runtime/userData',appAsar:root+'/app/WillYou.app/Contents/Resources/app.asar',lifecycle:root+'/app-lifecycle.jsonl',canonicalExpected:{userData:root+'/runtime/userData',appPathAsar:root+'/app/WillYou.app/Contents/Resources/app.asar'}};
let count=0;
function visit(node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='mainReadExpression'){const fn=vm.runInNewContext(node.initializer.getText(ast),ctx);new vm.Script(fn(1234));count++;}
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='lifecycleExpression'){const fn=vm.runInNewContext('('+node.getText(ast)+')',ctx);new vm.Script(fn());count++;}
 if(ts.isVariableDeclaration(node)&&['quit','expression'].includes(node.name.getText(ast))&&ts.isTemplateExpression(node.initializer)){const code=vm.runInNewContext(node.initializer.getText(ast),ctx);new vm.Script(code);count++;}
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='domFocusExpression'){const code=vm.runInNewContext(node.initializer.getText(ast),ctx);new vm.Script(code);count++;}
 ts.forEachChild(node,visit);
}visit(ast);assert.equal(count,5);
const options={allowJs:true,checkJs:true,noEmit:true,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,skipLibCheck:true};const program=ts.createProgram([root+'/run.mjs'],options);const unbound=program.getSemanticDiagnostics().filter(d=>d.file?.fileName===root+'/run.mjs'&&[2304,2552].includes(d.code)).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).filter(x=>!/^Cannot find name '(process|Buffer)'/.test(x));assert.deepEqual(unbound,[]);
const broker=await readFile(root+'/broker.m','utf8');for(const text of ['createsNewApplicationInstance = YES','allowsRunningApplicationSubstitution = NO','activates = NO','hides = YES','NSApplicationActivationPolicyProhibited','kernelAppExitCodeAvailable','launch-callback-pending'])assert(broker.includes(text),text);
for(const forbidden of ['coalition_create','posix_spawnattr_setcoalition','task_for_pid','ptrace','ignore-certificate-errors'])assert(!source.includes(forbidden)&&!broker.includes(forbidden),forbidden);
const names=['broker.m','run.mjs','kernel.py','native_api.py','judge.py','native-api-provenance.json','App019-build-gate.json','test_judge.py','pure-data-checks.json','cached-primary-references.json','check-lifecycle.mjs','jsonl-roundtrip-check.json','jsonl-negative-control.json','009-jsonl-original-check.json','check-ready-path.mjs','ready-path-checks.json'];const inputs=[];for(const n of names){const b=await readFile(root+'/'+n);inputs.push({path:n,sha256:sha(b),bytes:b.length});}
const out={staticOnly:true,NativeExecuted:false,AppStarted:false,compilerInvoked:false,objectiveCSemanticsVerified:false,renderedCdpExpressionsCompiled:count,unboundIdentifiers:unbound,inputs,readyForReviewOnly:true,runtimeReady:false,pending:['explicit Native/build lease','actual Werror Objective-C compiler gate','owned callback PID/port and actual private userData/package gate','actual resourceCID/counter permission','actual quit/termination/cleanup boundary'],proposedCommand:'WILLYOU_TEST_CACHE_DIR='+root+'/cache node '+root+'/run.mjs --execute'};
await writeFile(root+'/static-preflight.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({staticInputs:inputs.length,generatedExpressions:count,NativeExecuted:false,compilerInvoked:false,runtimeReady:false}));
