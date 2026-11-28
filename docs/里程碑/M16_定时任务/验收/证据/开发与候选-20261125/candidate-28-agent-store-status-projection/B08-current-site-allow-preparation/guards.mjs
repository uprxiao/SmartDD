import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {realpath,readFile,lstat,readdir,mkdir,mkdtemp} from 'node:fs/promises';
import {dirname,join} from 'node:path';

export const repo='/Users/liubu/hx/4.uprxiao/SmartDD';
export const support=join(repo,'release/m16-qa-support/b08-permission-recovery');
export const bundle=join(repo,'release/m16-qa-support/c28/build/mac-arm64/WillYou.app');
export const exe=join(bundle,'Contents/MacOS/WillYou');
export const manifest=join(repo,'release/m16-qa-support/c28/source-and-package.json');
export const manifestSha='118c3a0c40b4952b277df394a6cfcb931317f0660b6cd1a4b3ab5c59b2ac85cf';
export const pin='5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e';
export const nativePin='5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080';
export const filesPin='e07fbff84183650e8b3482d8c2499038787c9fd7aea691180cbf86e84fb3aea5';
export const cli=join(repo,'release/m16-qa-support/b11-recovery/verified-codex-0.169.0/package/vendor/aarch64-apple-darwin/bin/codex');
export const cliPin='739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002';
export const privatePrefix='/private/tmp/willyou-m16-b08-permission-c28-';
export const permission='idle-detection';
export const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
export const expectedArgs=[bundle,pin,nativePin,filesPin,cli,cliPin];
export async function verifyPackage(args){
  assert.deepEqual(args,expectedArgs);
  assert.equal(await realpath(bundle),bundle);assert.equal(await realpath(exe),exe);
  assert.equal(await digest(manifest),manifestSha);
  const m=JSON.parse(await readFile(manifest,'utf8'));
  assert.equal(m.bundle,bundle);assert.equal(m.appAsar,pin);assert.equal(m.nativeProcessIdentitySha256,nativePin);assert.equal(m.nativeFilesSha256,filesPin);
  const res=join(bundle,'Contents/Resources');
  assert.equal(await digest(join(res,'app.asar')),pin);
  assert.equal(await digest(join(res,'native/willyou-process-identity')),nativePin);
  assert.equal(await digest(join(res,'native/willyou-files')),filesPin);
  assert.equal(await realpath(cli),cli);assert((await lstat(cli)).isFile());assert.equal(await digest(cli),cliPin);
  return {bundle,pin,nativePin,filesPin,manifestSha,cli,cliPin,cliVersion:'0.169.0'};
}

async function exactPrivateDirectory(path) {
  assert.equal(await realpath(path),path,'Private directory must be canonical');
  const s=await lstat(path);
  assert(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0,'Expected own private directory');
}
export function isolation(root) {
  const home=join(root,'home'),cliHome=join(root,'cli-home');
  return {root,home,cliHome,userData:join(root,'data'),project:join(root,'project'),env:{
    HOME:home,ZDOTDIR:home,SMARTDD_CLI_HOME:cliHome,CODEX_HOME:join(cliHome,'.codex'),
    CLAUDE_CONFIG_DIR:join(cliHome,'.claude'),XDG_CONFIG_HOME:join(home,'.config')
  }};
}

// Used directly by the copied, previously validated C28 harness before spawn.
export async function verifyFreshLaunch({userData,cwd,env,executable,inspectMain,
    mockKeychainFixture,startupMainHook,nodeModeNegative,nodeModeArguments=[],resume=null}) {
  assert(executable===exe&&inspectMain===true&&mockKeychainFixture===true);
  assert(!startupMainHook&&!nodeModeNegative&&nodeModeArguments.length===0&&resume===null);
  const root=dirname(userData);
  assert(/^\/private\/tmp\/willyou-m16-b08-permission-c28-[A-Za-z0-9]+$/.test(root));
  const expected=isolation(root);
  assert.equal(userData,expected.userData);assert.equal(cwd,root);
  for(const [key,value] of Object.entries(expected.env))assert.equal(env[key],value,'Wrong private '+key);
  for(const d of [root,expected.home,expected.cliHome,expected.userData,expected.project,expected.env.CODEX_HOME,expected.env.CLAUDE_CONFIG_DIR,expected.env.XDG_CONFIG_HOME])await exactPrivateDirectory(d);
  assert.deepEqual((await readdir(root)).sort(),['cli-home','data','home','project']);
  assert.deepEqual(await readdir(expected.home),['.config']);
  assert.deepEqual((await readdir(expected.cliHome)).sort(),['.claude','.codex']);
  for(const d of [expected.userData,expected.project,expected.env.CODEX_HOME,expected.env.CLAUDE_CONFIG_DIR,expected.env.XDG_CONFIG_HOME])assert.deepEqual(await readdir(d),[],'Fresh isolated directory must be empty');
  return expected;
}
export async function makeRoot(){
  const root=await mkdtemp(privatePrefix),iso=isolation(root);
  for(const p of [iso.home,iso.cliHome,iso.userData,iso.project,iso.env.CODEX_HOME,iso.env.CLAUDE_CONFIG_DIR,iso.env.XDG_CONFIG_HOME])await mkdir(p,{recursive:true,mode:0o700});
  return iso;
}

export function assertOnlyDecision(rows,profileId,origin,decision) {
  assert(Array.isArray(rows)&&rows.every(r=>r?.state?.schemaVersion===1&&Array.isArray(r.state.permissions)&&Array.isArray(r.state.certificates)));
  assert.equal(new Set(rows.map(r=>r.profileId)).size,rows.length);
  const wanted=rows.filter(r=>r.profileId===profileId);
  assert(wanted.length<=1);
  assert(rows.every(r=>r.state.certificates.length===0),'No certificate exception may be created in this test');
  const items=rows.flatMap(r=>r.state.permissions.map(p=>({profileId:r.profileId,...p})));
  if(decision===null){assert.deepEqual(items,[],'No remaining permission');return null;}
  assert.equal(items.length,1,'Exactly one expected site permission');
  const result=items[0];assert.equal(result.profileId,profileId);assert.equal(result.origin,origin);assert.equal(result.permission,permission);assert.equal(result.decision,decision);assert(Number.isSafeInteger(result.updatedAt)&&result.updatedAt>0);
  return result;
}
export function assertOwnPrompt(prompt,page,origin){
  assert(prompt&&typeof prompt.id==='string'&&/^[0-9a-f-]{36}$/.test(prompt.id));
  assert.equal(prompt.pageId,page.id);assert.equal(prompt.profileId,page.profile);assert.equal(prompt.origin,origin);assert.deepEqual(prompt.permissions,[permission]);
  return prompt;
}
