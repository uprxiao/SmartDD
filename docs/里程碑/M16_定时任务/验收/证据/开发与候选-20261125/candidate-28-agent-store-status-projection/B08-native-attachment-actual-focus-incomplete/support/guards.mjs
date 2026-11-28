import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {realpath,readFile,lstat,readdir} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
export const repo='/Users/liubu/hx/4.uprxiao/SmartDD';
export const support=join(repo,'release/m16-qa-support/b08-recovery');
export const bundle=join(repo,'release/m16-qa-support/c28/build/mac-arm64/WillYou.app');
export const exe=join(bundle,'Contents/MacOS/WillYou');
export const manifest=join(repo,'release/m16-qa-support/c28/source-and-package.json');
export const manifestSha='118c3a0c40b4952b277df394a6cfcb931317f0660b6cd1a4b3ab5c59b2ac85cf';
export const pin='5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e';
export const nativePin='5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080';
export const filesPin='e07fbff84183650e8b3482d8c2499038787c9fd7aea691180cbf86e84fb3aea5';
export const name='M16-B08-binary.bin';
export const cases=['cancel-focused','save-focused','cancel-finder','save-finder'];
export const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
export async function verifyPackage(args){
 assert.deepEqual(args,[bundle,pin,nativePin,filesPin]);
 assert.equal(await realpath(bundle),bundle);assert.equal(await realpath(exe),exe);
 assert.equal(await digest(manifest),manifestSha);
 const m=JSON.parse(await readFile(manifest,'utf8'));
 assert.equal(m.bundle,bundle);assert.equal(m.appAsar,pin);assert.equal(m.nativeProcessIdentitySha256,nativePin);assert.equal(m.nativeFilesSha256,filesPin);
 const res=join(bundle,'Contents/Resources');
 assert.equal(await digest(join(res,'app.asar')),pin);
 assert.equal(await digest(join(res,'native/willyou-process-identity')),nativePin);
 assert.equal(await digest(join(res,'native/willyou-files')),filesPin);
 return {bundle,pin,nativePin,filesPin,manifestSha};
}
export async function verifyPath(root,caseName,path,{empty=true}={}){
 assert(/^\/private\/tmp\/willyou-m16-b08-attachment-c28-[a-zA-Z0-9]+$/.test(root));
 assert(cases.includes(caseName));
 const dir=join(root,'artifacts',caseName);
 assert.equal(path,join(dir,name));assert.equal(basename(path),name);
 for(const p of [root,join(root,'artifacts'),dir]){
  assert.equal(await realpath(p),p);const s=await lstat(p);assert(s.isDirectory()&&!s.isSymbolicLink());
 }
 if(empty){assert.deepEqual(await readdir(dir),[]);await assert.rejects(lstat(path),{code:'ENOENT'});}
 return {root,dir,path,caseName,empty};
}
export async function canonicalSelection(raw){return join(await realpath(dirname(raw)),basename(raw));}
