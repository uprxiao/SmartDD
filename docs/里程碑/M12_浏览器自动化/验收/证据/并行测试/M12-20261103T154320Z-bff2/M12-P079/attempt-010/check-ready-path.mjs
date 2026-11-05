// Necessary pure-data check of actual ready/file-window functions. No realpath syscall.
import{readFile,writeFile}from'node:fs/promises';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';import vm from'node:vm';
const root=new URL('.',import.meta.url).pathname.replace(/\/$/,''),ts=createRequire(import.meta.url)('/private/tmp/willyou-m12-p069-parked-resource-001/source018-preparation-004/node_modules/typescript');
const source=await readFile(root+'/run.mjs','utf8'),ast=ts.createSourceFile('run.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const declarations={};
function visit(n){if(ts.isFunctionDeclaration(n)&&['ownedRendererUrl','hasOwnedFileWindow'].includes(n.name?.text))declarations[n.name.text]=n.getText(ast);if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='mainReadExpression')declarations.main=n.initializer.getText(ast);ts.forEachChild(n,visit);}visit(ast);
const asar=root+'/app/WillYou.app/Contents/Resources/app.asar',alias=asar.replace('/private/tmp/','/tmp/'),ctx=vm.createContext({URL,fileURLToPath,canonicalExpected:{appPathAsar:asar},realpath:async p=>p===alias?asar:p});
vm.runInContext(declarations.ownedRendererUrl+'\n'+declarations.hasOwnedFileWindow,ctx);
const checks=[];function check(name,ok){if(!ok)throw Error(name);checks.push({name,pass:true});}
check('tmp-alias-file-window-accepted',await ctx.ownedRendererUrl('file://'+alias+'/out/renderer/index.html'));
check('daily-different-App-rejected',!await ctx.ownedRendererUrl('file:///Applications/WillYou.app/Contents/Resources/app.asar/out/renderer/index.html'));
check('same-basename-different-private-copy-rejected',!await ctx.ownedRendererUrl('file:///private/tmp/other/App.app/Contents/Resources/app.asar/out/renderer/index.html'));
check('aboutblank-not-ready-file-window',!await ctx.hasOwnedFileWindow({windows:[{url:'about:blank'}]}));
const make=vm.runInContext(declarations.main,ctx);let illegalRead=false;
const app={isReady:()=>false,getAppPath:()=>{illegalRead=true;throw Error('too early');},getAppMetrics:()=>{illegalRead=true;throw Error('too early');}};
const value=vm.runInNewContext(make(1234),{process:{pid:1234,getuid:()=>501,getBuiltinModule:()=>({createRequire:()=>()=>({app})}),cwd:()=>'/'} ,JSON});
check('not-ready-main-expression-returns-without-ready-only-APIs',value.ready===false&&!illegalRead);
await writeFile(root+'/ready-path-checks.json',JSON.stringify({pureDataOnly:true,NativeExecuted:false,realpathFunctionIsFake:true,checks},null,2)+'\n');console.log(JSON.stringify({checks:checks.length,NativeExecuted:false}));
