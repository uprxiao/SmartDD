import assert from 'node:assert/strict';
import {realpath,lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,digest} from '../guards-c30-final.mjs';
export const cliPath=join(repo,'release/m16-qa-support/b11-recovery/verified-codex-0.169.0/package/vendor/aarch64-apple-darwin/bin/codex');
export const cliSha='739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002';
export async function verifyNativeRunner(args){
 assert.deepEqual(args,[cliPath,cliSha]);assert.equal(await realpath(cliPath),cliPath);
 const s=await lstat(cliPath);assert(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o111)!==0);assert.equal(await digest(cliPath),cliSha);
 return {path:cliPath,sha:cliSha,version:'0.169.0',boundary:'Same verified official standalone CLI as C10/B11, used read-only. No inherited CLI HOME or credentials.'};
}
export const originalKeys=()=>['light','dark'].flatMap(theme=>[480,900].flatMap(width=>['1920x1080'].flatMap(size=>['observe','control'].map(mode=>theme+'-rw'+width+'-win'+size+'|B11-access-'+mode))));
export async function verifyOriginalKeys(){
 const path=join(repo,'docs/里程碑/M12_浏览器自动化/验收/S1执行计划.json');
 const raw=JSON.parse(await readFile(path,'utf8')).latestT145MatrixScopeDisposition.rows;
 assert.equal(raw.length,456);const keys=raw.filter(r=>r.key.split('|')[0].endsWith('win1920x1080')&&['B11-access-observe','B11-access-control'].includes(r.key.split('|')[1])).map(r=>r.key);
 assert.equal(keys.length,8);assert.deepEqual(keys.sort(),originalKeys().sort());return {path,sha:await digest(path),keys};
}
