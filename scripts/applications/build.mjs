import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
export function buildFoxmailReader({ output = resolve('out/native/willyou-foxmail') } = {}) {
  if (process.platform !== 'darwin') return null;
  mkdirSync(resolve(output, '..'), { recursive: true });
  execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-O2', '-mmacosx-version-min=12.0', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', '-framework', 'Foundation', '-lsqlite3', 'native/applications/foxmail.mm', '-o', output], { stdio: 'inherit' });
  return output;
}
export function buildProcessIdentity({ output = resolve('out/native/willyou-process-identity') } = {}) {
  if (process.platform !== 'darwin') return null;
  mkdirSync(resolve(output, '..'), { recursive: true });
  execFileSync('xcrun', ['clang++', '-std=c++17', '-O2', '-mmacosx-version-min=12.0', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', 'native/applications/process-identity.cc', '-o', output], { stdio: 'inherit' });
  return output;
}
export function buildApplicationCli({output=resolve('out/native/willyou-app')}={}){
  if(process.platform!=='darwin')return null;
  mkdirSync(resolve(output,'..'),{recursive:true});
  execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O2','-mmacosx-version-min=12.0','-arch',process.arch==='arm64'?'arm64':'x86_64','-framework','Foundation','native/applications/cli.mm','-o',output],{stdio:'inherit'});
  return output;
}
if (process.argv[1] === new URL(import.meta.url).pathname) { buildFoxmailReader(); buildProcessIdentity(); buildApplicationCli(); }
