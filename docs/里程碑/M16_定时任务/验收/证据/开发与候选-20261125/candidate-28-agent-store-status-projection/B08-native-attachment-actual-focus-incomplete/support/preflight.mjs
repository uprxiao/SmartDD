import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {repo,support,bundle,pin,nativePin,filesPin,name,cases,digest,verifyPackage,verifyPath,canonicalSelection} from './guards.mjs';
const pins=await verifyPackage([bundle,pin,nativePin,filesPin]);
await assert.rejects(verifyPackage([bundle,'0'.repeat(64),nativePin,filesPin]));
await assert.rejects(verifyPackage(['/private/tmp/willyou-m16-c27-build.M1DDawVE/standard/mac-arm64/WillYou.app',pin,nativePin,filesPin]));
const root=await mkdtemp('/private/tmp/willyou-m16-b08-attachment-c28-');
try{
 for(const c of cases)await mkdir(join(root,'artifacts',c),{recursive:true,mode:0o700});
 for(const c of cases){const p=join(root,'artifacts',c,name);await verifyPath(root,c,p);assert.equal(await canonicalSelection(p.replace('/private/tmp/','/tmp/')),p);}
 const sample=join(root,'artifacts',cases[0],name);
 await assert.rejects(verifyPath(root.replace('-c28-','-c27-'),cases[0],sample));await assert.rejects(verifyPath(root,cases[0],'/tmp/'+name));
 await assert.rejects(verifyPath(root,cases[1],sample));await writeFile(sample,'preflight only',{flag:'wx',mode:0o600});await assert.rejects(verifyPath(root,cases[0],sample));
}finally{await rm(root,{recursive:true,force:true});}
const files=['driver.mjs','isolated-electron.mjs','guards.mjs','fixture.cjs','fixture.ts','front-observer','front-observer.m','preflight.mjs'];
const dev=await realpath(join(repo,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));assert(dev.includes('/.pnpm/electron@42.11.14/'));
assert((await lstat(join(support,'front-observer'))).isFile());
for(const n of ['driver.mjs','isolated-electron.mjs','guards.mjs','fixture.cjs','preflight.mjs'])execFileSync(process.execPath,['--check',join(support,n)]);
const cdpCheck=execFileSync(process.execPath,[join(repo,'scripts/lib/check-cdp-expressions.mjs'),join(support,'driver.mjs'),join(support,'isolated-electron.mjs')],{encoding:'utf8'}).trim();
const hashEntries=await Promise.all(files.map(async n=>[n,await digest(join(support,n))]));
console.log(JSON.stringify({schema:'B08-C28-restored-preflight',pins,exactLocalFixtureInterpreter:dev,privatePathTests:{newRoot:true,canonicalMacAlias:true,rejectOldRoot:true,rejectEscape:true,rejectOtherCase:true,rejectExistingFile:true},cdpLiteralCheck:JSON.parse(cdpCheck),files:Object.fromEntries(hashEntries),actualAppLaunch:false,actualNativeInput:false},null,2));
