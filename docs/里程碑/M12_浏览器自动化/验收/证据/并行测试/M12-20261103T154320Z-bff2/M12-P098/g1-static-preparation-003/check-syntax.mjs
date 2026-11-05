import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {ROOT} from './io.mjs';
const files=(await readdir(ROOT)).filter(n=>n.endsWith('.mjs')),syntax=[];
for(const name of files){const text=await readFile(ROOT+'/'+name,'utf8'),source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(source.parseDiagnostics.length,0,name);syntax.push({path:name,diagnostics:0});}
const targetNames=['run.mjs','judge.mjs','judge-core.mjs','native-journal.mjs','check-static.mjs','skill-delivery.mjs','skill-files-proof.mjs','check-skill-files-proof.mjs'];
const options={allowJs:true,checkJs:true,noEmit:true,skipLibCheck:true,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.ES2023,allowSyntheticDefaultImports:true};
const program=ts.createProgram(targetNames.map(n=>ROOT+'/'+n),options);
const diagnostic=ts.getPreEmitDiagnostics(program).map(d=>({code:d.code,path:d.file?.fileName,line:d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start).line+1:undefined,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}));
const unresolved=diagnostic.filter(d=>[2304,2552].includes(d.code)&&targetNames.some(n=>d.path===ROOT+'/'+n));
const out={status:unresolved.length?'failed':'passed',syntax,unboundIdentifiers:unresolved,allSemanticDiagnostics:diagnostic,boundary:'Pure static TypeScript parse/resolution/free-variable gate, not a claim of whole-project types or App runtime. Other dynamic-object/Node-type diagnostics retained.',nativeCalls:0,modelCalls:0};
await writeFile(ROOT+'/syntax-check.json',JSON.stringify(out,null,2)+'\n');assert.equal(unresolved.length,0,JSON.stringify(unresolved));console.log(JSON.stringify({status:out.status,syntaxFiles:files.length,unboundIdentifiers:unresolved.length,otherDiagnostics:diagnostic.length}));
