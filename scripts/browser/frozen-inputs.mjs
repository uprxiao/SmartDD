// Shared by external M12 I drivers. Copying bytes alone loses executable modes;
// runtime SOURCE output also differs from the repository's build recipe.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {access,chmod,copyFile,lstat,mkdir,readFile,stat} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function copyFrozenInput({source,destination,sha256,mode}){
  assert.match(sha256,/^[a-f0-9]{64}$/,'Explicit input digest required');
  const original=await lstat(source);assert(original.isFile()&&!original.isSymbolicLink(),'Frozen input must be a regular file');
  const expectedMode=mode??(original.mode&0o777);assert(Number.isInteger(expectedMode)&&expectedMode>=0&&expectedMode<=0o777,'Invalid input mode');
  assert.equal(sha(await readFile(source)),sha256,'Source differs from frozen digest');
  await mkdir(dirname(destination),{recursive:true});
  await copyFile(source,destination,constants.COPYFILE_EXCL);await chmod(destination,expectedMode);
  assert.equal(sha(await readFile(destination)),sha256,'Copied bytes differ');
  assert.equal((await stat(destination)).mode&0o777,expectedMode,'Copied permissions differ');
  return{sha256,mode:expectedMode};
}
export async function checkFrozenBrowserRuntime({resources,arch}){
  assert(['arm64','x64'].includes(arch),'Known architecture required');
  const base=join(resources,'agent-browser'),sourcePath=join(base,'SOURCE.json'),source=JSON.parse(await readFile(sourcePath,'utf8'));
  assert(Array.isArray(source.files),'Built runtime SOURCE.files is required; do not use the repository build recipe');
  const entry=source.files.find(file=>file.arch===arch);assert(entry,'Runtime helper architecture missing');assert.match(entry.sha256,/^[a-f0-9]{64}$/);
  const helper=resolve(base,entry.path),path=relative(resolve(base),helper);assert(path&&!path.startsWith('..')&&!isAbsolute(path),'Runtime helper escapes its resource root');
  assert.equal(sha(await readFile(helper)),entry.sha256,'Runtime helper digest mismatch');
  const files=[];
  for(const executable of [helper,join(resources,'native/willyou-app'),join(resources,'native/willyou-process-identity')]){
    const metadata=await lstat(executable);assert(metadata.isFile()&&!metadata.isSymbolicLink(),'Native input must be a regular file');assert(metadata.mode&0o111,'Native input lost executable permissions');await access(executable,constants.X_OK);
    files.push({path:relative(resources,executable),sha256:sha(await readFile(executable)),mode:metadata.mode&0o777});
  }
  return{version:source.version,sourceSha256:sha(await readFile(sourcePath)),files};
}
