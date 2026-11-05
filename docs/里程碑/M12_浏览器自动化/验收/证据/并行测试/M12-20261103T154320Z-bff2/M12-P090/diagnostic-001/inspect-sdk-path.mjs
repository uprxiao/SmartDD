import assert from 'node:assert/strict';
import {readFile,writeFile,realpath,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root='/private/tmp/willyou-m12-p089-coalition-long-001/analysis-prior-004',source='/private/tmp/willyou-m12-p078-source-023/source';
assert.equal(process.env.NODE_COMPILE_CACHE,root+'/cache-node');assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,root+'/cache');await mkdir(root+'/cache',{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');const modulePath=await realpath(source+'/node_modules/@modelcontextprotocol/server/dist/validators/ajv.mjs');
const {AjvJsonSchemaValidator}=await import(pathToFileURL(modulePath));
const resources='/private/tmp/willyou-m12-s2-package-019/mac-arm64/WillYou.app/Contents/Resources',schemas=resources+'/capability-bundles/apps/browser/0.1.0/eb7f1cbfad4f8d9246ff261f8b64b2d8d778d6c28ae551b9f926fb8998f86140/schemas/capabilities/browser.nav.snapshot';
const inputText=await readFile(schemas+'.input.json','utf8'),outputText=await readFile(schemas+'.output.json','utf8'),value=JSON.parse(await readFile(root+'/snapshot-synthetic-result.json','utf8'));
assert(!('$id' in JSON.parse(inputText))&&!('$id' in JSON.parse(outputText)));
const require=createRequire(source+'/package.json'),builder=require.resolve('electron-builder'),appBuilder=createRequire(builder).resolve('app-builder-lib'),asarModule=createRequire(appBuilder)('@electron/asar');
const main=asarModule.extractFile(resources+'/app.asar','out/main/index.js'),mainText=main.toString('utf8');assert.equal(hash(main),'818ce0164a07fc33c230af67412ca22a267822b090d2ae8728f6cd707f3c7b9b');
const evidence={mainSha256:hash(main),toolServiceFreshSchemaCompiled:mainText.includes('this.validator.getValidator(selected.tool.inputSchema')&&mainText.includes('this.validator.getValidator(selected.tool.outputSchema'),strongCacheBySchemaObject:mainText.includes('this._cache.get(schema)')&&mainText.includes('this._cache.set(sch.schema, sch)')};


const paths=asarModule.listPackage(resources+'/app.asar');const sdk=paths.filter(p=>p.includes('/@modelcontextprotocol/server/')&&p.includes('ajv'));const fox=asarModule.extractFile(resources+'/app.asar','out/main/chunks/foxmail-source-CFqH-pCP.js').toString('utf8');const hits=[...fox.matchAll(/AjvJsonSchemaValidator|modelcontextprotocol\/server/g)].slice(0,12).map(m=>fox.slice(Math.max(0,m.index-80),m.index+200));console.log(JSON.stringify({sdk,hits},null,2));await writeFile(root+'/actual-sdk-load-path.json',JSON.stringify({sdk,hits},null,2)+'\n');
