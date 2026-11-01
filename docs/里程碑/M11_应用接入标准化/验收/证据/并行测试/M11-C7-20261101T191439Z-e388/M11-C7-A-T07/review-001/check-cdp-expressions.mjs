// Syntax-only preflight for literal JavaScript passed to the Electron harness.
// Does not execute browser expressions or cover templates with substitutions.
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';

const paths=process.argv.slice(2);assert(paths.length,'Pass one or more JavaScript driver paths');
let checked=0,failures=0;
for(const path of paths){
 const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 function visit(node){
  const argument=ts.isCallExpression(node)?node.arguments[0]:null;
  if(argument&&ts.isPropertyAccessExpression(node.expression)&&['evaluate','waitFor','mainEvaluate'].includes(node.expression.name.text)&&(ts.isStringLiteral(argument)||ts.isNoSubstitutionTemplateLiteral(argument))){
   checked++;
   try{new Function(argument.text);}catch(error){failures++;console.error(JSON.stringify({path,line:source.getLineAndCharacterOfPosition(argument.getStart(source)).line+1,error:String(error)}));}
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
}
console.log(JSON.stringify({paths:paths.length,literalExpressions:checked,failures,executed:false,dynamicTemplates:'not covered'}));
if(failures)process.exitCode=1;
