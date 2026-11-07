// Pure source inspection. Imported by run.mjs before permit/openElectron.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve,relative} from 'node:path';
const ts=createRequire(import.meta.url)('typescript');
const pattern=/^[a-z0-9-]{1,64}$/;
const literal=n=>n&&(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n));
const finiteLabels=n=>literal(n)?[n.text]:ts.isConditionalExpression(n)?((a,b)=>a&&b?[...a,...b]:null)(finiteLabels(n.whenTrue),finiteLabels(n.whenFalse)):null;
const named=(n,name)=>ts.isIdentifier(n)&&n.text===name;
const method=n=>ts.isPropertyAccessExpression(n)?n.name.text:ts.isElementAccessExpression(n)&&literal(n.argumentExpression)?n.argumentExpression.text:null;
export async function readDriverGraph(root){
 const files=new Map();
 async function visit(file){
  file=resolve(file);assert(file.startsWith(root+'/'),'Driver import must remain in private root');
  if(files.has(file))return;
  const text=await readFile(file,'utf8');files.set(file,text);
  const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),imports=[];
  function walk(n){
   if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&literal(n.moduleSpecifier))imports.push(n.moduleSpecifier.text);
   if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&literal(n.arguments[0]))imports.push(n.arguments[0].text);
   ts.forEachChild(n,walk);
  }
  walk(tree);for(const item of imports)if(item.startsWith('.'))await visit(resolve(dirname(file),item));
 }
 await visit(root+'/run.mjs');return files;
}
export function inspectDriverLabels(files,root){
 const calls=[],delegations=[],issues=[];
 for(const[file,text]of files){
  const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length,0,'Driver must parse: '+file);
  const position=n=>{const at=n.getStart(tree),p=tree.getLineAndCharacterOfPosition(at);return{file:relative(root,file),line:p.line+1,column:p.character+1,offset:at}};
  const fail=(n,reason)=>issues.push({...position(n),reason});
  let ownArrow;
  function declarations(n){if(ts.isVariableDeclaration(n)&&named(n.name,'own')){if(ownArrow)fail(n,'Duplicate own wrapper');ownArrow=n.initializer;}ts.forEachChild(n,declarations);}
  declarations(tree);
  if(ownArrow&&(!ts.isArrowFunction(ownArrow)||ownArrow.parameters.length!==3||!named(ownArrow.parameters[0].name,'body')||!named(ownArrow.parameters[1].name,'label')||!named(ownArrow.parameters[2].name,'options')||!ownArrow.parameters[2].initializer||!ts.isObjectLiteralExpression(ownArrow.parameters[2].initializer)||ownArrow.parameters[2].initializer.properties.length!==0))fail(ownArrow,'own must preserve (body,label,options={}) positions');
  function walk(n){
   if(ts.isCallExpression(n)&&named(n.expression,'own')){
    const label=n.arguments[1];
    if(![2,3].includes(n.arguments.length)||!finiteLabels(label))fail(n,'own argument 2 must be finite literal labels');
    else{for(const value of finiteLabels(label)){calls.push({...position(n),kind:'own',bodyArgument:1,labelArgument:2,label:value,finiteConditional:ts.isConditionalExpression(label)});if(!pattern.test(value))fail(label,'Label fails frozen harness pattern: '+value);}}
    if(n.arguments.length===3){const o=n.arguments[2];if(!ts.isObjectLiteralExpression(o)||o.properties.length!==1||!ts.isPropertyAssignment(o.properties[0])||!named(o.properties[0].name,'timeoutMs'))fail(n,'Own argument3 may contain only explicit timeoutMs');}
   }
   if(ts.isCallExpression(n)&&(method(n.expression)==='mainEvaluate'||named(n.expression,'mainEvaluate'))){
    const options=n.arguments[1],properties=options&&ts.isObjectLiteralExpression(options)?options.properties:[],labels=properties.filter(p=>p.name&&(named(p.name,'label')||literal(p.name)&&p.name.text==='label'));
    if(n.arguments.length!==2||!options||!ts.isObjectLiteralExpression(options)||properties.some(ts.isSpreadAssignment)||labels.length!==1)fail(n,'Direct mainEvaluate options argument 2 needs one explicit label and no spread');
    else{
     const property=labels[0],value=ts.isPropertyAssignment(property)?property.initializer:ts.isShorthandPropertyAssignment(property)?property.name:null;
     if(ownArrow&&n===ownArrow.body&&properties.length===2&&ts.isShorthandPropertyAssignment(property)&&named(value,'label')&&properties.some(p=>ts.isPropertyAssignment(p)&&named(p.name,'timeoutMs')&&ts.isPropertyAccessExpression(p.initializer)&&named(p.initializer.expression,'options')&&p.initializer.name.text==='timeoutMs'))delegations.push({...position(n),wrapper:'own(body,label,options={})',bodyArgument:1,labelArgument:2,optionalTimeoutArgument:3,optionsArgument:2,optionsProperty:'label',sourceParameter:2,onlyOtherForwardedOption:'timeoutMs'});
     else if(finiteLabels(value)){for(const label of finiteLabels(value)){calls.push({...position(n),kind:'direct-mainEvaluate',bodyArgument:1,optionsArgument:2,optionsProperty:'label',label,finiteConditional:ts.isConditionalExpression(value)});if(!pattern.test(label))fail(value,'Label fails frozen harness pattern: '+label);}}
     else fail(n,'Nonliteral direct mainEvaluate label is not the exact own parameter delegation');
    }
   }
   ts.forEachChild(n,walk);
  }
  walk(tree);
 }
 if(delegations.length!==1)issues.push({reason:'Expected exactly one own -> mainEvaluate label delegation',actual:delegations.length});
 return{pattern:pattern.source,files:[...files.keys()].map(f=>relative(root,f)).sort(),calls,delegations,issues};
}
export async function assertDriverLabels(root){
 const harness=await readFile(root+'/driver-source/scripts/lib/electron-harness.mjs','utf8');
 assert(harness.includes('label === undefined || /^[a-z0-9-]{1,64}$/.test(label)'),'Frozen harness label guard must remain exact');
 const result=inspectDriverLabels(await readDriverGraph(root),root);
 assert.deepEqual(result.issues,[],'Every actual driver mainEvaluate label must pass before App admission');
 return result;
}
