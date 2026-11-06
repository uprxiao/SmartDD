// Pure source inspection. Imported by run.mjs before permit/openElectron.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve,relative} from 'node:path';
const ts=createRequire(import.meta.url)('typescript');
const pattern=/^[a-z0-9-]{1,64}$/;
const literal=n=>n&&(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n));
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
  if(ownArrow&&(!ts.isArrowFunction(ownArrow)||ownArrow.parameters.length!==2||!named(ownArrow.parameters[0].name,'body')||!named(ownArrow.parameters[1].name,'label')))fail(ownArrow,'own must preserve (body,label) parameter positions');
  function walk(n){
   if(ts.isCallExpression(n)&&named(n.expression,'own')){
    const label=n.arguments[1];
    if(n.arguments.length!==2||!literal(label))fail(n,'own argument 2 must be a fixed literal label');
    else{calls.push({...position(n),kind:'own',bodyArgument:1,labelArgument:2,label:label.text});if(!pattern.test(label.text))fail(label,'Label fails frozen harness pattern: '+label.text);}
   }
   if(ts.isCallExpression(n)&&(method(n.expression)==='mainEvaluate'||named(n.expression,'mainEvaluate'))){
    const options=n.arguments[1],properties=options&&ts.isObjectLiteralExpression(options)?options.properties:[],labels=properties.filter(p=>p.name&&(named(p.name,'label')||literal(p.name)&&p.name.text==='label'));
    if(n.arguments.length!==2||!options||!ts.isObjectLiteralExpression(options)||properties.some(ts.isSpreadAssignment)||labels.length!==1)fail(n,'Direct mainEvaluate options argument 2 needs one explicit label and no spread');
    else{
     const property=labels[0],value=ts.isPropertyAssignment(property)?property.initializer:ts.isShorthandPropertyAssignment(property)?property.name:null;
     if(ownArrow&&n===ownArrow.body&&properties.length===1&&ts.isShorthandPropertyAssignment(property)&&named(value,'label'))delegations.push({...position(n),wrapper:'own(body,label)',bodyArgument:1,labelArgument:2,optionsArgument:2,optionsProperty:'label',sourceParameter:2});
     else if(literal(value)){calls.push({...position(n),kind:'direct-mainEvaluate',bodyArgument:1,optionsArgument:2,optionsProperty:'label',label:value.text});if(!pattern.test(value.text))fail(value,'Label fails frozen harness pattern: '+value.text);}
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
