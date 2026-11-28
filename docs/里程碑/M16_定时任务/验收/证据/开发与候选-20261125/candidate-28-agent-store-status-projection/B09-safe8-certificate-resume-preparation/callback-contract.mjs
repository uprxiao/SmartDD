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
 for(const file of ['driver.mjs','states.mjs','sources.mjs']){const source=overrides[file]??await readFile(join(dir,file),'utf8'),found=callbacks(file,source);entries.push(...found.direct);forwarded.push(...found.forwarded);}
 const virtual=join(dir,'__safe8_serialized_functions.ts'),prefix='declare const process: any; declare const Buffer: any;\n';let content=prefix;
 for(const e of entries){e.start=content.length;content+='void ('+e.source+');\n';e.end=content.length;}
 const opts={target:ts.ScriptTarget.ESNext,lib:['lib.esnext.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts'],noEmit:true,types:[],skipLibCheck:true};const host=ts.createCompilerHost(opts),get=host.getSourceFile.bind(host);host.getSourceFile=(path,...args)=>path===virtual?ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS):get(path,...args);
 const program=ts.createProgram([virtual],opts,host),codes=new Set([2304,2552,18004,2662,2591,2580]),unresolved=program.getSemanticDiagnostics(program.getSourceFile(virtual)).filter(d=>codes.has(d.code)).map(d=>{const e=entries.find(e=>d.start>=e.start&&d.start<e.end);return {path:e?.path,line:e?.line,callee:e?.callee,code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')};});
 return {checked:entries.length,forwarded,unresolved,executed:false,boundary:'Isolated TS lexical scope check, not a renderer execution; inner strings/dynamic protocol arguments separately syntax checked or replayed.'};
}
function panelExpression(source){const ast=parse('states.mjs',source);let expr=null;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='panel'){function inside(c){if(ts.isCallExpression(c)&&ts.isIdentifier(c.expression)&&c.expression.text==='js'){assert(ts.isArrowFunction(c.arguments[0])&&!expr);expr=c.arguments[0].getText(ast);assert.equal(c.arguments[1].getText(ast),'selector');}ts.forEachChild(c,inside);}inside(n);}else ts.forEachChild(n,visit);}visit(ast);assert(expr);return expr;}
export async function replayKnownPanelPattern(dir){
 const root=join(dir,'..','next-safe8'),prior=await readFile(join(root,'states.mjs'),'utf8'),current=await readFile(join(dir,'states.mjs'),'utf8');const a=panelExpression(prior),b=panelExpression(current);assert.equal(b,a.replace('return {selector,rect:','return {selector:sel,rect:'));
 const priorScope=await checkSerializedCallbacks(dir,{'states.mjs':prior}),scope=await checkSerializedCallbacks(dir);assert(priorScope.unresolved.some(x=>x.path==='states.mjs'&&[18004,2304,2552].includes(x.code)&&x.message.includes('selector')));assert.deepEqual(scope.unresolved,[]);
 // Exact callback form; no actual safe8 capture or failure. Same defect as actual safe16 meMtSv.
 const selector='[data-browser-panel=profiles]',r={x:1200,y:100,width:400,height:600,right:1600,bottom:700},base={getBoundingClientRect:()=>r,querySelectorAll:()=>[],scrollWidth:400,clientWidth:400},panel={...base,innerText:'private synthetic fixture',querySelector:()=>null},workspace={...base,dataset:{browserTask:'synthetic-id',browserPage:'synthetic-page'}};const ctx=()=>vm.createContext({document:{querySelector:s=>s===selector?panel:s==='.bw-workspace'?workspace:null},getComputedStyle:()=>({visibility:'visible',display:'block'})});const expr=fn=>'('+fn+')(...'+JSON.stringify([selector])+')';let oldError;try{vm.runInContext(expr(a),ctx());}catch(e){oldError=String(e);}assert.equal(oldError,'ReferenceError: selector is not defined');const fixed=JSON.parse(JSON.stringify(vm.runInContext(expr(b),ctx())));assert.equal(fixed.selector,selector);assert.equal(fixed.task,'synthetic-id');assert.equal(fixed.page,'synthetic-page');assert(fixed.rect.visible&&!fixed.overflow);
 return {priorSource:join(root,'states.mjs'),priorStatesSha:hash(prior),fixedStatesSha:hash(current),priorScope:priorScope.unresolved,staticGreen:scope,exactMockSelector:selector,oldError,oldExpressionSha:hash(expr(a)),newExpressionSha:hash(expr(b)),fixedReturn:{selector:fixed.selector,task:fixed.task,page:fixed.page},boundary:'Safe8 not launched. Same actual safe16 source-level closure defect, pure static and fresh VM regression only; mock DOM, no native input or actual capture.'};
}
