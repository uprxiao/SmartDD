// Read the actual fixed Git object, not a hand-maintained list or a moving checkout.
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const ts=createRequire(import.meta.url)('typescript');
export const commit='fe59fa44d0f12ba1e58b1cccc2c888ac99e743da';
export const path='packages/contracts/src/orchestrationV2.ts';
export function readT3Baseline(root){
 if(!root)throw Error('Pass M14_T3_ROOT pointing to a local T3 Git checkout');
 const source=execFileSync('git',['-C',root,'show',`${commit}:${path}`],{encoding:'utf8'});
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true), declarations=new Map();
 function visit(n){if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name))declarations.set(n.name.text,n.initializer);ts.forEachChild(n,visit);}visit(ast);
 const decl=declarations.get('OrchestrationV2TurnItem');
 if(!ts.isCallExpression(decl)||decl.expression.getText(ast)!=='Schema.Union'||!ts.isArrayLiteralExpression(decl.arguments[0]))throw Error('Unexpected T3 union schema');
 function discriminant(obj,seen=new Set()){
  if(!ts.isObjectLiteralExpression(obj))throw Error('Expected fields object');
  for(const p of obj.properties){
   if(ts.isPropertyAssignment(p)&&p.name.getText(ast)==='type'){
    const v=p.initializer;if(!ts.isCallExpression(v)||v.expression.getText(ast)!=='Schema.Literal'||!ts.isStringLiteral(v.arguments[0]))throw Error('Expected type literal');
    return v.arguments[0].text;
   }
  }
  for(const p of obj.properties)if(ts.isSpreadAssignment(p)&&ts.isIdentifier(p.expression)){
   const name=p.expression.text;if(seen.has(name))continue;seen.add(name);
   let ref=declarations.get(name);while(ref&&(ts.isAsExpression(ref)||ts.isSatisfiesExpression(ref)||ts.isParenthesizedExpression(ref)))ref=ref.expression;
   if(ref&&ts.isObjectLiteralExpression(ref)){const value=discriminant(ref,seen);if(value)return value;}
  }
 }
 const types=decl.arguments[0].elements.map(member=>{
  if(!ts.isCallExpression(member)||member.expression.getText(ast)!=='Schema.Struct')throw Error('Unexpected union member');
  const type=discriminant(member.arguments[0]);if(!type)throw Error('Unresolved union discriminator');return type;
 });
 if(new Set(types).size!==types.length)throw Error('Duplicate discriminator');
 return {commit,path,sourceSha256:createHash('sha256').update(source).digest('hex'),types};
}
export function coverageGaps(types,itemTypes,excluded,renamed){
 return types.filter(type=>!itemTypes.includes(renamed[type]??type)&&!excluded[type]);
}
export const exclusions={fork:'No thread forks in this milestone',secret_request:'Credentials use existing WillYou services; no model-to-secret-file flow',link_request:'No remote machine connection in this milestone'};
export const renames={dynamic_tool:'tool_call'};
