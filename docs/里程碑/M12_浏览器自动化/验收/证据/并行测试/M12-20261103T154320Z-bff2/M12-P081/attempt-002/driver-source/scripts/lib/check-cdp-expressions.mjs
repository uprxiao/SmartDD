// Syntax-only preflight for literal JavaScript passed to the Electron harness.
// Does not execute browser expressions or cover templates with substitutions.
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';

const paths=process.argv.slice(2);assert(paths.length,'Pass one or more JavaScript driver paths');
let checked=0,failures=0;
for(const path of paths){
 const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
 function compileLiteral(node,functionBody=false){
  if(ts.isConditionalExpression(node)){compileLiteral(node.whenTrue,functionBody);compileLiteral(node.whenFalse,functionBody);return;}
  if(!ts.isStringLiteral(node)&&!ts.isNoSubstitutionTemplateLiteral(node))return;
  checked++;
  try{new Function(functionBody?'return ('+node.text+')':node.text);}catch(error){failures++;console.error(JSON.stringify({path,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,error:String(error)}));}
 }
 function visit(node){
  const argument=ts.isCallExpression(node)?node.arguments[0]:null;
  if(argument&&ts.isPropertyAccessExpression(node.expression)&&['evaluate','waitFor','mainEvaluate'].includes(node.expression.name.text)&&(ts.isStringLiteral(argument)||ts.isNoSubstitutionTemplateLiteral(argument))){
   compileLiteral(argument);
  }
  if(argument&&ts.isStringLiteral(argument)&&['Runtime.evaluate','Runtime.callFunctionOn'].includes(argument.text)){
   const params=node.arguments[1];
   if(params&&ts.isObjectLiteralExpression(params))for(const property of params.properties){
    if(!ts.isPropertyAssignment(property))continue;
    const name=property.name.getText(source).replace(/^['"]|['"]$/g,'');
    if(name==='expression')compileLiteral(property.initializer);
    if(name==='functionDeclaration')compileLiteral(property.initializer,true);
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
}
console.log(JSON.stringify({paths:paths.length,literalExpressions:checked,failures,executed:false,dynamicTemplates:'not covered'}));
if(failures)process.exitCode=1;
