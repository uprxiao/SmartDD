// Repack a private JQ App copy with a static compiled configuration evolution
// fixture. This is an instrumented test host, never a normal release build.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {join,dirname,resolve,relative} from 'node:path';
const require=createRequire(import.meta.url),asar=createRequire(require.resolve('electron-builder/package.json'))('@electron/asar');
const sha=value=>createHash('sha256').update(value).digest('hex');
const withoutApi1=process.argv[4]==='--without-data-api1';assert(!process.argv[4]||withoutApi1,'Unknown private host option');
const source=resolve(process.argv[2]??''),pin=process.argv[3];assert(source.startsWith('/private/tmp/willyou-m10-')&&source.endsWith('/WillYou.app')&&pin,'Only an explicitly pinned private test App is allowed');
const sourceAsar=join(source,'Contents/Resources/app.asar'),original=await readFile(sourceAsar);assert.equal(sha(original),pin);
const root=await mkdtemp('/private/tmp/willyou-m10-config-host-v2-'),target=join(root,'WillYou.app');
execFileSync('/bin/cp',['-cR',source,target],{stdio:'pipe'});
const mainPath='out/main/index.js';let main=asar.extractFile(sourceAsar,mainPath).toString('utf8');
const replaceOne=(before,after)=>{assert.equal(main.split(before).length,2,'Private fixture patch point changed');main=main.replace(before,after);};
replaceOne('"use strict";','"use strict";\nrequire("./t59-config-upgrade-fixture.cjs").guard();');

replaceOne('\nclass BuiltinPackageRegistry {','\nrequire("./t59-config-upgrade-fixture.cjs").decorateDefinitions(builtinHostApplications, foxmailSource.connectionConfigSchema);\nclass BuiltinPackageRegistry {');
const viewLine=main.split('\n').find(line=>line.startsWith('const builtinConfigViews = new ConfigViewRegistry('));assert(viewLine);replaceOne(viewLine,'const builtinConfigViews = require("./t59-config-upgrade-fixture.cjs").views('+viewLine.slice('const builtinConfigViews = '.length,-1)+', ConfigViewRegistry, foxmailSource.connectionConfigSchema);');
replaceOne('    this.connections = new ApplicationConnectionService(store, options.secrets, new ProviderConnectionVerifier(options.mailWorker, options.foxmailNative));','    require("./t59-config-upgrade-fixture.cjs").migrate(store);\n    this.connections = new ApplicationConnectionService(store, options.secrets, new ProviderConnectionVerifier(options.mailWorker, options.foxmailNative));');
const fixture=await readFile('scripts/applications/fixtures/config-upgrade-host.cjs');
let apiOverride;
if(withoutApi1){
 const candidates=asar.listPackage(sourceAsar).filter(path=>path.startsWith('/out/main/')&&path.endsWith('.js')).map(path=>({path:path.slice(1),text:asar.extractFile(sourceAsar,path.slice(1)).toString('utf8')})).filter(item=>item.text.includes('const APP_DATA_API = 1;'));assert.equal(candidates.length,1,'Locate exactly one compiled Data API policy');const originalPolicy=candidates[0];assert.equal(originalPolicy.text.split('const APP_DATA_API = 1;').length,2);apiOverride={path:originalPolicy.path,bytes:Buffer.from(originalPolicy.text.replace('const APP_DATA_API = 1;','const APP_DATA_API = 2;')),beforeSha256:sha(originalPolicy.text)};
}
const overrides=new Map([[mainPath,Buffer.from(main)],['out/main/t59-config-upgrade-fixture.cjs',fixture],...(apiOverride?[[apiOverride.path,apiOverride.bytes]]:[])]),streams=[];
async function walk(files,prefix=''){
 for(const [name,entry]of Object.entries(files)){
  const path=prefix?prefix+'/'+name:name;
  if(entry.files){streams.push({type:'directory',path,unpacked:!!entry.unpacked});await walk(entry.files,path);}
  else if(entry.link)streams.push({type:'link',path,symlink:relative(dirname(path),entry.link),unpacked:!!entry.unpacked,stat:{mode:0o120777}});
  else{const bytes=overrides.get(path),unpacked=!!entry.unpacked,metadata=unpacked?await stat(join(sourceAsar+'.unpacked',path)):{size:bytes?.length??entry.size,mode:entry.executable?0o100755:0o100644};streams.push({type:'file',path,unpacked,stat:{size:bytes?.length??metadata.size,mode:metadata.mode},streamGenerator:()=>bytes?Readable.from(bytes):unpacked?createReadStream(join(sourceAsar+'.unpacked',path)):Readable.from(asar.extractFile(sourceAsar,path))});overrides.delete(path);}
 }
}
const oldHeader=asar.getRawHeader(sourceAsar);await walk(oldHeader.header.files);
for(const [path,bytes]of overrides)streams.push({type:'file',path,unpacked:false,stat:{size:bytes.length,mode:0o100644},streamGenerator:()=>Readable.from(bytes)});
const resource=join(target,'Contents/Resources'),nextAsar=join(resource,'app.fixture.asar');await asar.createPackageFromStreams(nextAsar,streams);const nextHeader=asar.getRawHeader(nextAsar);
const plist=join(target,'Contents/Info.plist'),integrity=JSON.parse(execFileSync('/usr/bin/plutil',['-extract','ElectronAsarIntegrity','json','-o','-',plist],{encoding:'utf8'}));assert.equal(integrity['Resources/app.asar'].hash,sha(oldHeader.headerString));integrity['Resources/app.asar'].hash=sha(nextHeader.headerString);execFileSync('/usr/bin/plutil',['-replace','ElectronAsarIntegrity','-json',JSON.stringify(integrity),plist]);await rename(nextAsar,join(resource,'app.asar'));
execFileSync('/usr/bin/codesign',['--force','--sign','-','--timestamp=none','--options','runtime','--entitlements','build/entitlements.mac.plist',target],{stdio:'pipe'});execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',target],{stdio:'pipe'});
const manifest={schema:1,kind:'compiled-private-T59-format2-host',declaredDataApi:withoutApi1?2:1,apiPolicyOverride:apiOverride?{path:apiOverride.path,beforeSha256:apiOverride.beforeSha256,afterSha256:sha(apiOverride.bytes)}:null,negativeApiBoundary:withoutApi1?'Only rejection of retained API1 is tested; no implemented API2 business or release claim':null,sourceApp:source,sourceAsar:pin,app:target,executable:join(target,'Contents/MacOS/WillYou'),asar:sha(await readFile(join(resource,'app.asar'))),fixtureSha256:sha(fixture),mainSha256:sha(main),patches:['private userData guard before App startup','compiled builtin Foxmail schema2 union and identity validation','compiled equivalent schema2 to fixed API1 view','private atomic physical layout migration'],authentication:'none; no safeStorage or approval replacement',boundary:'Synthetic physical format2, real registry/view/context/Worker/native and packaged host; not a release or stock Foxmail format claim'};
assert.equal(sha(await readFile(sourceAsar)),pin);assert.notEqual(manifest.asar,pin);await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await writeFile('/private/tmp/willyou-m10-config-host-v2-latest.txt',join(root,'manifest.json')+'\n');console.log(JSON.stringify(manifest));
