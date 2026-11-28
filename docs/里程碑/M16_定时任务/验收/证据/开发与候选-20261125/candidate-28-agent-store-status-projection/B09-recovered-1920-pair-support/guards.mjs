import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {realpath,readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
export const repo='/Users/liubu/hx/4.uprxiao/SmartDD';
export const support=join(repo,'release/m16-qa-support/b09-recovery');
export const oldBundle=join(repo,'release/m16-qa-support/old-reference/WillYou.app');
export const newBundle=join(repo,'release/m16-qa-support/c28/build/mac-arm64/WillYou.app');
export const oldPin='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2';
export const newPin='5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e';
export const oldNative='3ea4c07164ebd92391822629e00f4efa4a07a97f33088ef53b3c9b6b532c6040';
export const newNative='5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080';
export const filesPin='e07fbff84183650e8b3482d8c2499038787c9fd7aea691180cbf86e84fb3aea5';
export const manifest=join(repo,'release/m16-qa-support/c28/source-and-package.json');
export const manifestSha='118c3a0c40b4952b277df394a6cfcb931317f0660b6cd1a4b3ab5c59b2ac85cf';
export const expectedArgs=[oldBundle,oldPin,oldNative,newBundle,newPin,newNative,filesPin];
export const specs=[{side:'old-clean',bundle:oldBundle,hash:oldPin,native:oldNative},{side:'new',bundle:newBundle,hash:newPin,native:newNative}];
export const digest=async f=>createHash('sha256').update(await readFile(f)).digest('hex');
export const originalMapping={
 'B01-B02-normal-selected-tab-toolbar':['B01-tabs-entry','B02-toolbar-ready'],
 'B01-long-tab-unselected':['B01-long-title-url'],
 'B03-address-edit':['B03-address-edit'],
 'B08-find-matches':['B08-find-matches'],
 'B08-find-zero':['B08-find-zero'],
 'R01-11-launcher':['R01-11-launcher-recent'],
};
export const coreStates=Object.values(originalMapping).flat();
export async function verifyPins(args){
 assert.deepEqual(args,expectedArgs);
 assert.equal(await digest(manifest),manifestSha);
 const m=JSON.parse(await readFile(manifest,'utf8'));assert.equal(m.bundle,newBundle);assert.equal(m.appAsar,newPin);assert.equal(m.nativeProcessIdentitySha256,newNative);assert.equal(m.nativeFilesSha256,filesPin);
 for(const s of specs){const r=join(s.bundle,'Contents/Resources');assert.equal(await realpath(s.bundle),s.bundle);assert.equal(await realpath(join(s.bundle,'Contents/MacOS/WillYou')),join(s.bundle,'Contents/MacOS/WillYou'));assert.equal(await digest(join(r,'app.asar')),s.hash);assert.equal(await digest(join(r,'native/willyou-process-identity')),s.native);assert.equal(await digest(join(r,'native/willyou-files')),filesPin);}
 return {specs,filesPin,manifestSha};
}
export async function verifySideRoot(root){
 assert(/^\/private\/tmp\/willyou-m16-b09-c28-side-[A-Za-z0-9]+$/.test(root));
 for(const p of [root,join(root,'home'),join(root,'home','.config'),join(root,'cli-home'),join(root,'cli-home','.codex'),join(root,'cli-home','.claude'),join(root,'data')]){assert.equal(await realpath(p),p);const s=await lstat(p);assert(s.isDirectory()&&!s.isSymbolicLink());}
 for(const p of [join(root,'data'),join(root,'cli-home','.codex'),join(root,'cli-home','.claude')])assert.deepEqual(await readdir(p),[]);
 return true;
}
export function fullscreenVerdict(native,geometry){
 if(!native||!geometry)return false;
 const b=native.bounds,c=native.contentBounds,d=native.actualDisplay;
 return native.visible===true&&native.minimized===false&&native.fullScreen===true&&native.shellZoomFactor===1&&d?.scaleFactor===1&&d.bounds.width===1920&&d.bounds.height===1080&&b.x===d.bounds.x&&b.y===d.bounds.y&&b.width===1920&&b.height===1080&&c.width===1920&&c.height===1080&&geometry.inner[0]===1920&&geometry.inner[1]===1080&&geometry.dpr===1;
}
