import assert from 'node:assert/strict';
import {readFile,readdir,lstat,realpath,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
const PRIVATE_ROOT='/private/tmp/willyou-m12-p083-profile-lifecycle-a4-app020-004';
const ALLOWED_OUTPUT_ROOTS=new Set([PRIVATE_ROOT,PRIVATE_ROOT+'/dummy-check/output']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Read-only by construction: no supplied resource path reaches any write API. */
export async function collectReadonlyResources(resourceRoot){
 const canonicalRoot=await realpath(resourceRoot),files=[];
 async function visit(directory){
  for(const entry of(await readdir(directory)).sort()){
   const resourcePath=join(directory,entry),entryStat=await lstat(resourcePath);
   if(entryStat.isDirectory()){await visit(resourcePath);continue}
   let actualStat=entryStat;
   if(entryStat.isSymbolicLink()){
    const actualPath=await realpath(resourcePath);assert(!relative(canonicalRoot,actualPath).startsWith('..'),'Resource link leaves bounded resource root');actualStat=await lstat(actualPath);assert(actualStat.isFile(),'Directory symlink is not traversed implicitly');
   }
   assert(actualStat.isFile(),'Resource entry must be a regular file');
   const resourceBytes=await readFile(resourcePath);files.push({path:relative(canonicalRoot,resourcePath),sha256:sha(resourceBytes),mode:actualStat.mode&511,bytes:resourceBytes.length});
  }
 }
 await visit(canonicalRoot);return files;
}
/** There is no output-file parameter. Only these exact private directories can
 * receive a newly constructed pin.json, and rename never follows a target link. */
export async function writePrivatePin(value,{outputRoot=PRIVATE_ROOT}={}){
 const canonicalOutput=resolve(outputRoot);assert(ALLOWED_OUTPUT_ROOTS.has(canonicalOutput),'Only exact private pin output directories permitted');assert.equal(await realpath(canonicalOutput),canonicalOutput,'Private output root cannot be a symlink');
 const privatePinPath=join(canonicalOutput,'pin.json'),privateTempPath=join(canonicalOutput,'.pin-'+randomBytes(12).toString('hex')+'.tmp');
 try{await writeFile(privateTempPath,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await rename(privateTempPath,privatePinPath)}catch(error){try{await unlink(privateTempPath)}catch{}throw error}
 return privatePinPath;
}
