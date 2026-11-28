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
 for(const file of ['driver.mjs','states.mjs','transport.mjs']){const source=overrides[file]??await readFile(join(dir,file),'utf8'),found=callbacks(file,source);entries.push(...found.direct);forwarded.push(...found.forwarded);}
 const virtual=join(dir,'__safe16_serialized_functions.ts'),prefix='declare const process: any; declare const Buffer: any;\n';let content=prefix;
 for(const e of entries){e.start=content.length;content+='void ('+e.source+');\n';e.end=content.length;}
 const opts={target:ts.ScriptTarget.ESNext,lib:['lib.esnext.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts'],noEmit:true,types:[],skipLibCheck:true};const host=ts.createCompilerHost(opts),get=host.getSourceFile.bind(host);host.getSourceFile=(path,...args)=>path===virtual?ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS):get(path,...args);
 const program=ts.createProgram([virtual],opts,host),codes=new Set([2304,2552,18004,2662,2591,2580]),unresolved=program.getSemanticDiagnostics(program.getSourceFile(virtual)).filter(d=>codes.has(d.code)).map(d=>{const e=entries.find(e=>d.start>=e.start&&d.start<e.end);return {path:e?.path,line:e?.line,callee:e?.callee,code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')};});
 return {checked:entries.length,forwarded,unresolved,executed:false,boundary:'Isolated TS lexical scope check, not a renderer execution; inner strings/dynamic protocol arguments separately syntax checked or replayed.'};
}
function panelExpression(source){const ast=parse('states.mjs',source);let expr=null;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='panel'){function inside(c){if(ts.isCallExpression(c)&&ts.isIdentifier(c.expression)&&c.expression.text==='js'){assert(ts.isArrowFunction(c.arguments[0])&&!expr);expr=c.arguments[0].getText(ast);assert.equal(c.arguments[1].getText(ast),'selector');}ts.forEachChild(c,inside);}inside(n);}else ts.forEachChild(n,visit);}visit(ast);assert(expr);return expr;}
export async function replayOriginalPanelFailure(dir){
 const root='/private/tmp/willyou-m16-b09-c28-1920-safe16-pair-meMtSv',actualFile=join(root,'B09-safe16-pair-result.json'),actualText=await readFile(actualFile,'utf8'),actual=JSON.parse(actualText),priorState=await readFile(join(root,'states.snapshot.mjs'),'utf8'),fixedState=await readFile(join(dir,'states.mjs'),'utf8');
 assert.equal(hash(priorState),'bda5accf3c8e110ff35ebbea26caceb92e586aa4aa826622c95a8449adcdf80a');assert.equal(actual.status,'failed-or-partial');assert.equal(actual.captures.length,0);assert.equal(actual.originalRows.length,0);assert.match(actual.error,/ReferenceError: selector is not defined/);const group=actual.groupErrors.at(-1);assert.equal(group.side,'old-clean');assert.equal(group.combo,'light-rw480-win1920x1080');assert.equal(group.group,'network');const current=group.actualSnapshot,t=current.tabs.find(t=>t.id===current.activeId);assert.equal(t.failure.kind,'not-running');assert.equal(t.failure.errorName,'ERR_CONNECTION_REFUSED');const width=actual.actions.findLast(x=>x.kind==='real-keyboard-panel-width');assert.equal(width.after.width,480);assert(width.after.focused&&width.after.docFocus);
 const old=panelExpression(priorState),fixed=panelExpression(fixedState);assert.equal(fixed,old.replace('return {selector,rect:','return {selector:sel,rect:'));const selector='.bw-failure[role="alert"]';assert(priorState.includes("'.bw-failure[role=\"alert\"]',{expectedText:c.error,needPreview:false}"));
 const sampleRect={x:1440,y:100,width:480,height:920,right:1920,bottom:1020},sampleStyle={fontSize:'13px',lineHeight:'20px',visibility:'visible',display:'block'};const basic={getBoundingClientRect:()=>sampleRect,querySelectorAll:()=>[],scrollWidth:480,clientWidth:480};const panel={...basic,innerText:t.failure.title+' '+t.failure.errorName,querySelector:q=>q==='h2'?{innerText:t.failure.title}:q==='.bw-error-name'?{innerText:t.failure.errorName}:null};const workspace={...basic,dataset:{browserTask:current.taskId,browserPage:t.id}};
 const context=()=>vm.createContext({document:{querySelector:q=>q===selector?panel:q==='.bw-workspace'?workspace:null},getComputedStyle:()=>sampleStyle});const expression=fn=>'('+fn+')(...'+JSON.stringify([selector])+')';let oldError;try{vm.runInContext(expression(old),context());}catch(e){oldError=String(e);}assert.equal(oldError,'ReferenceError: selector is not defined');const result=JSON.parse(JSON.stringify(vm.runInContext(expression(fixed),context())));assert.equal(result.selector,selector);assert.equal(result.head,t.failure.title);assert.equal(result.code,t.failure.errorName);assert.equal(result.task,current.taskId);assert.equal(result.page,t.id);assert.equal(result.preview,false);assert(result.rect.visible&&!result.overflow);
 const oldScope=await checkSerializedCallbacks(dir,{'states.mjs':priorState});assert(oldScope.unresolved.some(x=>x.path==='states.mjs'&&[18004,2304,2552].includes(x.code)&&x.message.includes('selector')));const nextScope=await checkSerializedCallbacks(dir);assert.deepEqual(nextScope.unresolved,[]);
 return {actualEvidence:{path:actualFile,sha:hash(actualText),status:actual.status,captureCount:0,previousActualWidth:width.after.width,previousActualSeparatorFocused:width.after.focused,side:group.side,combo:group.combo,failure:{kind:t.failure.kind,title:t.failure.title,errorName:t.failure.errorName}},priorStatesSha:hash(priorState),fixedStatesSha:hash(fixedState),oldExpressionSha:hash(expression(old)),fixedExpressionSha:hash(expression(fixed)),exactSelector:selector,oldRemoteError:oldError,staticRed:oldScope.unresolved,staticGreen:nextScope,syntheticReturn:{selector:result.selector,head:result.head,code:result.code,taskMatches:result.task===current.taskId,pageMatches:result.page===t.id},boundary:'Recorded actual input/error plus exact source callbacks serialized and executed in a fresh pure VM; DOM shape is synthetic, no actual captures, launch, site or geometry claimed.'};
}
