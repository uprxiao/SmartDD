import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const hash=s=>createHash('sha256').update(s).digest('hex');
const parse=(path,source)=>ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const filename=n=>n.getText();
function callbacks(path,source){
 const ast=parse(path,source),direct=[],forwarded=[],declarations=new Map();
 function findDecl(n){if(ts.isFunctionDeclaration(n)&&n.name)declarations.set(n.name.text,n);ts.forEachChild(n,findDecl);}findDecl(ast);
 function walk(n){
  if(ts.isCallExpression(n)&&n.arguments.length){
   const callee=ts.isIdentifier(n.expression)?n.expression.text:ts.isPropertyAccessExpression(n.expression)?n.expression.name.text:null;
   if(['js','observeMain','shellGuard','exactNativeInput'].includes(callee)){
    const a=n.arguments[0],line=ast.getLineAndCharacterOfPosition(a.getStart(ast)).line+1,meta={path,line,callee};
    if(ts.isArrowFunction(a)||ts.isFunctionExpression(a))direct.push({...meta,source:a.getText(ast)});
    else if(ts.isIdentifier(a)&&declarations.has(a.text))direct.push({...meta,source:declarations.get(a.text).getText(ast)});
    else{assert(ts.isIdentifier(a)&&a.text==='fn'&&['shellGuard','observeMain'].includes(callee),'Unexpected dynamic serialized callback '+path+':'+line);forwarded.push({...meta,name:a.text});}
   }
  }ts.forEachChild(n,walk);
 }walk(ast);return {direct,forwarded};
}
// No renderer environment or App connection: resolve each function as an independent script,
// not a closure over the harness. Known runtime globals are browser DOM, Node process/Buffer,
// and standard JS. The checker reports unresolved identifiers, including object shorthand.
export async function checkSerializedCallbacks(dir,overrides={}){
 const entries=[],forwarded=[];
 for(const file of ['driver.mjs','states.mjs','source-success.mjs']){const source=overrides[file]??await readFile(join(dir,file),'utf8'),found=callbacks(file,source);entries.push(...found.direct);forwarded.push(...found.forwarded);}
 const virtual=join(dir,'__safe8_serialized_functions.ts'),prefix='declare const process: any; declare const Buffer: any;\n';let content=prefix;
 for(const e of entries){e.start=content.length;content+='void ('+e.source+');\n';e.end=content.length;}
 const opts={target:ts.ScriptTarget.ESNext,lib:['lib.esnext.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts'],noEmit:true,types:[],skipLibCheck:true};const host=ts.createCompilerHost(opts),get=host.getSourceFile.bind(host);host.getSourceFile=(path,...args)=>path===virtual?ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS):get(path,...args);
 const program=ts.createProgram([virtual],opts,host),codes=new Set([2304,2552,18004,2662,2591,2580]),unresolved=program.getSemanticDiagnostics(program.getSourceFile(virtual)).filter(d=>codes.has(d.code)).map(d=>{const e=entries.find(e=>d.start>=e.start&&d.start<e.end);return {path:e?.path,line:e?.line,callee:e?.callee,code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')};});
 return {checked:entries.length,forwarded,unresolved,executed:false,boundary:'Isolated TS lexical scope check, not a renderer execution; inner strings/dynamic protocol arguments separately syntax checked or replayed.'};
}
