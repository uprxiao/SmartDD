// Static AST parsing only: never transpiles or imports production modules.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('/private/tmp/willyou-m12-t130-native-u-root-001/work/node_modules/typescript');
const base='/private/tmp/willyou-m12-t091-source-030/source',old='/private/tmp/willyou-m12-t130-native-u-root-001/work';
const pending=['src/renderer/features/files/csv/acceptance.test.ts'],files=[],edges=[],missing=[];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function local(from,spec){let p;
 if(spec.startsWith('@main/'))p=path.join(base,'src/main',spec.slice(6));
 else if(spec.startsWith('@shared/'))p=path.join(base,'src/shared',spec.slice(8));
 else if(spec.startsWith('@renderer/'))p=path.join(base,'src/renderer',spec.slice(10));
 else if(spec.startsWith('@root/'))p=path.join(base,spec.slice(6));
 else if(spec.startsWith('.'))p=path.resolve(base,path.dirname(from),spec);else return null;
 const candidates=[p,...['.ts','.tsx','.js','.mjs','.json'].map(x=>p+x),...['.ts','.tsx','.js','.mjs'].map(x=>path.join(p,'index'+x))];
 const resolved=candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());if(!resolved){missing.push({from,spec});return null;}return path.relative(base,resolved);
}
while(pending.length){const rel=pending.pop();if(files.some(f=>f.path===rel))continue;const bytes=fs.readFileSync(path.join(base,rel));files.push({path:rel,sha256:hash(bytes),mode:fs.statSync(path.join(base,rel)).mode&0o777,sameOld:fs.existsSync(path.join(old,rel))&&hash(fs.readFileSync(path.join(old,rel)))===hash(bytes)});
 if(rel.endsWith('.json'))continue;
 const source=ts.createSourceFile(rel,bytes.toString(),ts.ScriptTarget.Latest,true);
 function edge(spec,kind,isTypeOnly){const resolved=local(rel,spec);edges.push({from:rel,spec,kind,isTypeOnly,resolved});if(resolved&&!isTypeOnly)pending.push(resolved);}
 function visit(n){
  if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)){const c=n.importClause;const typeOnly=!!c&&(c.isTypeOnly||!c.name&&c.namedBindings&&ts.isNamedImports(c.namedBindings)&&c.namedBindings.elements.every(e=>e.isTypeOnly));edge(n.moduleSpecifier.text,'import',!!typeOnly);}
  else if(ts.isExportDeclaration(n)&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier)){const c=n.exportClause;edge(n.moduleSpecifier.text,'export',n.isTypeOnly||!!c&&ts.isNamedExports(c)&&c.elements.every(e=>e.isTypeOnly));}
  else if(ts.isCallExpression(n)&&n.arguments.length&&ts.isStringLiteral(n.arguments[0])&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(n.expression)&&n.expression.text==='require'))edge(n.arguments[0].text,'dynamic-or-require',false);
  ts.forEachChild(n,visit);
 }visit(source);
}
files.sort((a,b)=>a.path.localeCompare(b.path));
const out={schema:1,entry:'src/renderer/features/files/csv/acceptance.test.ts',method:'TypeScript5.9.3 createSourceFile AST only; type-only edges not followed; no transpilation/collection/runtimeproductionimport',files,edges,missing};
fs.writeFileSync(path.join(__dirname,'source-import-closure.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({files:files.length,missing,bare:[...new Set(edges.filter(e=>!e.resolved&&!e.isTypeOnly&&!e.spec.startsWith('node:')&&!e.spec.startsWith('.')).map(e=>e.spec))],differences:files.filter(f=>!f.sameOld).map(f=>f.path)}));
