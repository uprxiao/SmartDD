// Pure generated-source checks only. Does not execute Python, inspect env, scan files, or launch an App.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {matchDigestCandidates} from './scripts/applications/scan-private-shell-snapshot.mjs';
const root=new URL('.',import.meta.url).pathname,run=readFileSync(root+'scripts/applications/m11-r10-acceptance-ui.mjs','utf8'),tree=ts.createSourceFile('run.mjs',run,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let probeInitializer,configInitializer;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='probeProgram')probeInitializer=node.initializer.getText(tree);if(ts.isCallExpression(node)&&node.expression.getText(tree)==='writeFile'&&node.arguments[0]?.getText(tree)==="join(state,'config.toml')")configInitializer=node.arguments[1].getText(tree);ts.forEachChild(node,visit);}visit(tree);
assert(probeInitializer&&configInitializer);
const program=new Function('tokenReceipt','return ('+probeInitializer+')')(root+'static-only-token-digests.json');assert(program.includes('\n'));writeFileSync(root+'static-token-program.py',program+'\n');
const config=new Function('port','return ('+configInitializer+')')(12345);writeFileSync(root+'static-private-config.toml',config);
const raw=Buffer.from('e7'.repeat(32),'ascii'),forms={raw64hex:raw,base64:Buffer.from(raw.toString('base64'),'ascii'),utf16le:Buffer.from(raw.toString('ascii'),'utf16le'),utf16be:Buffer.from(raw.toString('ascii'),'utf16le').swap16()},hashes=Object.fromEntries(Object.entries(forms).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')]));
for(const[form,bytes]of Object.entries(forms)){const result=matchDigestCandidates(Buffer.concat([Buffer.from('!'),bytes,Buffer.from('!')]),hashes);assert(result.some(x=>x.form===form&&x.offset===1),'Encoding candidate not detected: '+form);assert(result.every(x=>Object.keys(x).sort().join(',')==='form,offset'),'Never return a candidate value');}
assert.deepEqual(matchDigestCandidates(Buffer.from('no-secret-here'),hashes),[]);
console.log(JSON.stringify({generatedPythonSource:true,generatedPrivateTOML:true,pureEncodingChecks:4,negativeEncodingCheck:1,PythonExecuted:false,envRead:false,filesScanned:false,AppNativeExecuted:false}));
