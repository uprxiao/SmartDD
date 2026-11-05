import assert from 'node:assert/strict';
import {readFile,readdir,lstat,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {canonical,sha,compareCodePoints} from './plan-reader.mjs';
const filePath=s=>typeof s==='string'&&s!==''&&!isAbsolute(s)&&!s.includes('\\')&&s.split('/').every(x=>x&&x!=='.'&&x!=='..');
export const renderedFilesHash=files=>sha(canonical(files.map(({path,size,sha256})=>({path,size,sha256})).sort((a,b)=>compareCodePoints(a.path,b.path))));
export function templateFilesHash(manifest,skillId){const skill=manifest.skills.find(x=>x.id===skillId);assert(skill);const prefix=skill.path+'/';const files=manifest.files.filter(f=>f.path.startsWith(prefix)).map(f=>({...f,path:f.path.slice(prefix.length)})).sort((a,b)=>compareCodePoints(a.path,b.path));assert(files.some(f=>f.path==='SKILL.md'));return sha(canonical(files));}
export async function readDeliveredSkill({directory,expected,packageHash,storeId,root}){
 assert.equal(await realpath(root),root);assert.equal(await realpath(directory),directory);assert(directory.startsWith(root+'/'));assert.equal((await lstat(directory)).isDirectory(),true);
 const manifest=JSON.parse(await readFile(join(directory,'bundle.json'))),marker=JSON.parse(await readFile(join(directory,'.willyou-owned-bundle.json')));
 assert.equal(manifest.schema,'willyou-owned-bundle-v1');assert.equal(marker.schema,1);assert.equal(marker.storeId,storeId);assert.equal(marker.hash,sha(canonical(manifest)));assert.equal(manifest.metadata.kind,'codex-agent-projection-v1');assert.equal(manifest.metadata.nativeName,expected.nativeName);assert.equal(manifest.metadata.sourceHash,expected.templateHash);assert.equal(manifest.metadata.sourceResourceId,'app:'+packageHash);
 assert(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=4096);const names=[];const walk=async(dir,prefix='')=>{for(const name of await readdir(dir)){const path=prefix?prefix+'/'+name:name,st=await lstat(join(dir,name));assert(!st.isSymbolicLink());if(st.isDirectory())await walk(join(dir,name),path);else{assert(st.isFile());names.push(path)}}};await walk(directory);
 assert.deepEqual([...names].sort(compareCodePoints),[...manifest.files.map(f=>f.path),'bundle.json','.willyou-owned-bundle.json'].sort(compareCodePoints));
 const files=[];let skillBytes;
 for(const file of manifest.files){assert(filePath(file.path));const path=join(directory,file.path),st=await lstat(path);assert(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1);assert.equal(st.size,file.size);assert.equal(st.mode&0o111,file.executable?0o100:0);const bytes=await readFile(path);assert.equal(sha(bytes),file.sha256);files.push({path:file.path,size:bytes.length,sha256:sha(bytes),executable:file.executable});if(file.path==='SKILL.md')skillBytes=bytes;}
 assert(skillBytes);const renderedHash=renderedFilesHash(files);assert.equal(renderedHash,expected.renderedHash);
 return{skillBytes,files,renderedHash,skillFileSha256:sha(skillBytes),bundleHash:marker.hash,storeId:marker.storeId};
}
