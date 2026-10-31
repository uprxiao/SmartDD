// Run with the own Electron binary in Node mode: its fs reads ASAR transparently.
// Read-only applicability audit, not a fresh execution of old business tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),rawFs=require('original-fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const [beforeApp,afterApp,output]=process.argv.slice(2);
for(const p of [beforeApp,afterApp])assert(p?.startsWith('/private/tmp/willyou-m10-')&&p.endsWith('/WillYou.app'));
assert(output?.startsWith('/private/tmp/willyou-m10-'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function input(root){
 const asar=path.join(root,'Contents/Resources/app.asar'),bytes=fs.readFileSync(path.join(asar,'out/main/index.js')),ast=ts.createSourceFile('main.js',bytes.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),defs=new Map();
 for(const n of ast.statements)if((ts.isClassDeclaration(n)||ts.isFunctionDeclaration(n))&&n.name){const key=(ts.isClassDeclaration(n)?'class:':'function:')+n.name.text;assert(!defs.has(key));defs.set(key,{bytes:Buffer.byteLength(n.getText(ast)),sha256:sha(n.getText(ast))});}
 const mailIndex=fs.readFileSync(path.join(root,'Contents/Resources/capability-bundles/index.json'));
 return{app:root,asarSha256:sha(rawFs.readFileSync(asar)),mainSha256:sha(bytes),defs,index:JSON.parse(mailIndex),indexSha256:sha(mailIndex)};
}
const before=input(beforeApp),after=input(afterApp),same=[],changed=[],removed=[],added=[];
for(const [key,value]of before.defs){if(!after.defs.has(key))removed.push(key);else(value.sha256===after.defs.get(key).sha256?same:changed).push(key);}
for(const key of after.defs.keys())if(!before.defs.has(key))added.push(key);
const mailClasses=[...after.defs.keys()].filter(k=>k.startsWith('class:Mail')||['class:CredentialHandles','class:SecretsStore'].includes(k));
const mailClassesExact=mailClasses.every(k=>same.includes(k));assert(mailClassesExact,'Changed mail/security implementation needs explicit follow-up');
const capabilityContentEqual=['apps','runtimes','adapters'].every(k=>JSON.stringify(before.index[k])===JSON.stringify(after.index[k]));
assert(capabilityContentEqual,'Changed shipped application/runtime/adapter requires affected business retest');
const result={schema:'m10-tested-package-applicability-v1',at:new Date().toISOString(),boundary:'Exact named definitions in actual bundles;not proof of unexecuted business paths or all module initialization',before:{app:before.app,asar:before.asarSha256,main:before.mainSha256},after:{app:after.app,asar:after.asarSha256,main:after.mainSha256},sameDefinitionCount:same.length,changedDefinitions:changed,removedDefinitions:removed,addedDefinitions:added,mailClasses:mailClasses.map(name=>({name,sha256:after.defs.get(name).sha256,byteIdentical:true})),mailClassesExact,bundleIndexEqual:before.indexSha256===after.indexSha256};
result.capabilityContentEqual=capabilityContentEqual;
result.indexDifferenceScope='Index build metadata/hash only;application,runtime and adapter entries byte-equivalent';
const postcss=require(require('node:module').createRequire(require.resolve('vite/package.json')).resolve('postcss'));
function cssRules(root){
 const assets=path.join(root,'Contents/Resources/app.asar/out/renderer/assets'),files=fs.readdirSync(assets).filter(n=>n.endsWith('.css')),rules={};
 for(const f of files)postcss.parse(fs.readFileSync(path.join(assets,f),'utf8')).walkRules(r=>{let scope=[],p=r.parent;while(p){if(p.type==='atrule')scope.unshift('@'+p.name+' '+p.params);p=p.parent;}const key=scope.join('/')+'|'+r.selector;(rules[key]??=[]).push(r.nodes.map(d=>d.toString()).join(';'));});return rules;
}
const oldRules=cssRules(beforeApp),newRules=cssRules(afterApp),cssChanged=[];
for(const key of new Set([...Object.keys(oldRules),...Object.keys(newRules)]))if(JSON.stringify(oldRules[key])!==JSON.stringify(newRules[key]))cssChanged.push({selector:key,before:oldRules[key]??null,after:newRules[key]??null});
result.rendererCss={beforeRules:Object.keys(oldRules).length,afterRules:Object.keys(newRules).length,changed:cssChanged};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({mailClasses:mailClasses.length,mailClassesExact,same:same.length,changed,removed,added,bundleIndexEqual:result.bundleIndexEqual,capabilityContentEqual}));
