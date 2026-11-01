import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const workspace='/Users/liubu/Documents/ChatGPT/SmartDD-m10';
const {build}=await import(pathToFileURL(join(workspace,'node_modules/vite/dist/node/index.js')));
const scratch=mkdtempSync('/private/tmp/willyou-m11-view-fingerprints-');symlinkSync(join(workspace,'node_modules'),join(scratch,'node_modules'),'dir');
const configurations=[{kind:'zentao',baseUrl:'https://private.example.test/',username:'fixture',authMode:'token'},{kind:'foxmail',sourcePath:'/private/tmp/private-source',account:'fixture@example.test',queryDays:30},{kind:'smtp',host:'smtp.example.test',port:465,username:'fixture',fromAddress:'fixture@example.test',authMode:'password',mode:'implicit-tls'}];
const result={schema:'m11-retained-config-view-identities-v1',at:new Date().toISOString(),oldSource:'/private/tmp/willyou-m11-s1/source-attempt-002',newSource:workspace,values:{}};
for(const [label,root] of [['old',result.oldSource],['new',workspace]]){
 const output=join(scratch,label);await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:{'@shared':join(root,'src/shared'),'@main':join(root,'src/main'),'@root':root}},build:{ssr:join(root,'src/main/core/applications/config-view-registry.ts'),target:'node22',outDir:output,minify:false,rollupOptions:{external:id=>id.startsWith('node:')||(!id.startsWith('.')&&!id.startsWith('/')&&!id.startsWith('@shared/')&&!id.startsWith('@main/')&&!id.startsWith('@root/')),output:{format:'cjs',entryFileNames:'views.cjs',inlineDynamicImports:true}}}});
 const {builtinConfigViews}=createRequire(import.meta.url)(join(output,'views.cjs'));
 result.values[label]=Object.fromEntries(configurations.map(config=>{const value=builtinConfigViews.resolve({providerId:config.kind,sourceSchemaVersion:1,targetApiMajor:1,identityContractMajor:1},config,[config.kind==='foxmail'?'local-readonly':config.authMode]);return[config.kind,{converterHash:value.converterHash,viewDigest:value.viewDigest}]}));
}
result.identical=JSON.stringify(result.values.old)===JSON.stringify(result.values.new);writeFileSync(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root:scratch,...result}));
