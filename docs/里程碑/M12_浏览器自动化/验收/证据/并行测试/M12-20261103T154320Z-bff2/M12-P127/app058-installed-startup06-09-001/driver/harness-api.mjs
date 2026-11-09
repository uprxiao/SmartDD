import assert from'node:assert/strict';
import ts from'./node_modules/typescript/lib/typescript.js';
export function assertHarnessMembers(harnessSource,driverSource){
 const parse=(name,s)=>{const f=ts.createSourceFile(name,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(f.parseDiagnostics.length,0);return f;},h=parse('harness.mjs',harnessSource),d=parse('driver.mjs',driverSource),fn=h.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='openElectron');assert(fn?.body);
 const returns=[];function returned(n){if(n!==fn&&ts.isFunctionLike(n))return;if(ts.isReturnStatement(n)&&n.expression&&ts.isObjectLiteralExpression(n.expression))returns.push(n.expression);ts.forEachChild(n,returned);}returned(fn);
 const object=returns.find(n=>n.properties.some(p=>p.name?.getText(h)==='processId'));assert(object);assert.equal(returns.filter(n=>n===object).length,1);
 const available=object.properties.map(p=>{assert(p.name&&!ts.isComputedPropertyName(p.name));return p.name.text;});assert(available.every(x=>typeof x==='string'));
 const used=new Set();function visit(n){if(ts.isPropertyAccessExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='app')used.add(n.name.text);if(ts.isElementAccessExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='app')throw Error('Computed app member requires explicit API check');ts.forEachChild(n,visit);}visit(d);
 for(const name of used)assert(available.includes(name),'Actual openElectron returned object lacks '+name);
 return{used:[...used].sort(),available:available.sort(),object,source:h};
}
