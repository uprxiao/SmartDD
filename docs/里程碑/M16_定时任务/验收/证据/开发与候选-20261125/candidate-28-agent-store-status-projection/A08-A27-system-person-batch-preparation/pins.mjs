import assert from 'node:assert/strict';
import path from 'node:path';
import {realpathSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const ROOT=path.dirname(fileURLToPath(import.meta.url));
export const REPO='/Users/liubu/hx/4.uprxiao/SmartDD';
const EXPECTED_ROOT=REPO+'/release/m16-qa-support/b11-recovery/a08-a27-system';
export const BUNDLE=REPO+'/release/m16-qa-support/c28/build/mac-arm64/WillYou.app';
export const EXE=BUNDLE+'/Contents/MacOS/WillYou';
export const ASAR='5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e';
export const NATIVE='5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080';
export const CLI=REPO+'/release/m16-qa-support/b11-recovery/verified-codex-0.169.0/package/vendor/aarch64-apple-darwin/bin/codex';
export const CLI_SHA='739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002';
const RELEASE=REPO+'/release/m16-qa-support/c28/source-and-package.json';
export const C28_SOURCE_PACKAGE_SHA='118c3a0c40b4952b277df394a6cfcb931317f0660b6cd1a4b3ab5c59b2ac85cf';
export const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
export const GROUP_FLAGS=Object.freeze({'A08-zone':'--authorized-person-zone-change','A27-sleep':'--authorized-person-sleep-wake','A27-clock':'--authorized-person-absolute-clock-change'});
export function parseArgs(args){
 if(args.length===1&&args[0]==='--preflight-only')return {preflightOnly:true};
 assert.equal(args.length,4,'exact one group and explicitly authorized person operation');assert(args.includes('--run-approved'));
 const i=args.indexOf('--group');assert(i>=0);const group=args[i+1];assert(GROUP_FLAGS[group]);
 assert.equal(new Set(args).size,4);assert.deepEqual([...args].sort(),['--run-approved','--group',group,GROUP_FLAGS[group]].sort());
 return {group,preflightOnly:false};
}
export function verifyPins(){
 assert.equal(realpathSync(ROOT),EXPECTED_ROOT);assert.equal(realpathSync(BUNDLE),BUNDLE);assert.equal(realpathSync(EXE),EXE);assert.equal(realpathSync(CLI),CLI);
 assert.equal(hash(BUNDLE+'/Contents/Resources/app.asar'),ASAR);assert.equal(hash(BUNDLE+'/Contents/Resources/native/willyou-process-identity'),NATIVE);assert.equal(hash(CLI),CLI_SHA);assert.equal(hash(RELEASE),C28_SOURCE_PACKAGE_SHA);
 const r6=JSON.parse(readFileSync(path.join(ROOT,'../run-ITKAGr/result.json'),'utf8'));
 assert.equal(r6.actualVerifiedSupportedTool.version,'0.169.0');assert.equal(r6.actualVerifiedSupportedTool.sha,CLI_SHA);assert.equal(r6.pin,ASAR);assert.equal(r6.nativePin,NATIVE);assert.equal(r6.status,'diagnostic-complete-no-formal-evidence');
 const adapter=BUNDLE+'/Contents/Resources/capability-bundles/adapters/codex/1.6.0/28a60b2604ed0da0925e083fdc644c19ff8c221bb11c68e5876b59dfe8ca5b06';
 const a=JSON.parse(readFileSync(adapter+'/bundle.json','utf8'));
 assert.equal(a.metadata.agentId,'codex');assert(a.metadata.platforms.includes('darwin-arm64'));assert(a.metadata.cliVersions.includes('0.169.0'));assert(a.metadata.levels['0.169.0'].includes('L0.cli'));
 for(const f of a.files)assert.equal(hash(adapter+'/'+f.path),f.sha256);
 return {root:ROOT,bundle:BUNDLE,exe:EXE,asar:ASAR,native:NATIVE,cli:CLI,cliSha:CLI_SHA,preservedR6NativeVersion:'0.169.0',sourcePackageSha:C28_SOURCE_PACKAGE_SHA,adapterBundleSha:hash(adapter+'/bundle.json'),harnessSha:hash(REPO+'/scripts/lib/electron-harness.mjs'),harnessIsolationSha:hash(REPO+'/scripts/lib/electron-isolation-paths.mjs'),formalSystemOperationsOnlyByPerson:true};
}
