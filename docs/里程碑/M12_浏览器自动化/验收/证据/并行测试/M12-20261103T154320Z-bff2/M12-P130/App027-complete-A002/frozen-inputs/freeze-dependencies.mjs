// File-only package snapshot. Resolves metadata, never imports SDK/esbuild code.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,realpath,copyFile,chmod,stat,symlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root='/private/tmp/willyou-m12-t132-App027-A-002',old='/private/tmp/willyou-m12-t132-App024-A-002',req=createRequire(old+'/package.json'),sha=b=>createHash('sha256').update(b).digest('hex'),packages=new Map(),links=[],files=[],skipped=[];
async function locate(name,from){for(const base of createRequire(from+'/package.json').resolve.paths(name)??[]){const path=join(base,name,'package.json');try{await stat(path);return await realpath(dirname(path))}catch(error){if(error.code!=='ENOENT')throw error}}return null}
async function link(path,target){await mkdir(dirname(root+'/'+path),{recursive:true});const text=relative(dirname(root+'/'+path),target);await symlink(text,root+'/'+path);links.push({path,target:text,realTarget:target})}
async function copyTree(source,dest){await mkdir(dest,{recursive:true});for(const e of await readdir(source,{withFileTypes:true})){if(e.name==='node_modules')continue;const a=source+'/'+e.name,b=dest+'/'+e.name;if(e.isDirectory())await copyTree(a,b);else{const actual=await realpath(a),s=await stat(actual);if(!s.isFile())throw Error('Unexpected non-file dependency entry');await copyFile(actual,b);await chmod(b,s.mode&511);files.push({path:relative(root,b),sha256:sha(await readFile(b)),mode:s.mode&511,bytes:s.size})}}}
async function freeze(source){source=await realpath(source);if(packages.has(source))return packages.get(source);assert(packages.size<200,'Bounded selected package graph');const meta=JSON.parse(await readFile(source+'/package.json')),name=meta.name,version=meta.version,dest=root+'/deps/packages/'+name.replaceAll('/','_')+'-'+version+'-'+sha(source).slice(0,8),row={source,name,version,destination:dest,dependencies:[]};packages.set(source,row);await copyTree(source,dest);
 const dependencies={...meta.dependencies,...meta.peerDependencies,...meta.optionalDependencies};
 for(const dep of Object.keys(dependencies??{}).sort()){const path=await locate(dep,source),optional=dep in(meta.optionalDependencies??{})||Boolean(meta.peerDependenciesMeta?.[dep]?.optional)||dep in(meta.peerDependencies??{});
  if(!path){assert(optional,'Required package absent: '+name+' -> '+dep);skipped.push({from:name,dependency:dep,reason:'Uninstalled optional/peer metadata dependency; no runtime import substituted'});continue}
  const dm=JSON.parse(await readFile(path+'/package.json'));if(dm.os&&!dm.os.includes(process.platform)||dm.cpu&&!dm.cpu.includes(process.arch)){assert(optional);skipped.push({from:name,dependency:dep,reason:'Other OS/CPU optional package'});continue}
  const child=await freeze(path);await link(relative(root,dest+'/node_modules/'+dep),child.destination);row.dependencies.push({name:dep,destination:child.destination});
 }
 return row;
}
await mkdir(root+'/deps',{recursive:true});
const entries=[['typescript','/private/tmp/willyou-m12-t125-original-profile-continuation-003/node_modules/typescript'],['ws','/private/tmp/willyou-m12-t125-original-profile-continuation-003/node_modules/ws'],['esbuild',dirname(dirname(createRequire(req.resolve('vite')).resolve('esbuild')))],['@modelcontextprotocol/ext-apps',await locate('@modelcontextprotocol/ext-apps',old)],['@modelcontextprotocol/server',await locate('@modelcontextprotocol/server',old)]];
// Root node_modules is replaced only in this unexecuted private preparation.
const {unlink}=await import('node:fs/promises');await unlink(root+'/node_modules');await mkdir(root+'/node_modules');
for(const[name,source]of entries){assert(source);const row=await freeze(source);await link('node_modules/'+name,row.destination)}
const result={schema:'selected-public-dependency-private-snapshot-v1',packages:[...packages.values()],files:files.sort((a,b)=>a.path.localeCompare(b.path)),links,skipped,executionSources:'All runtime JS/SDK/compiler files resolve to this private snapshot, not changing workspace source. Native binaries hash/mode frozen but never executed during preparation.',NativeAppOSHTTPModelExecution:false};
await writeFile(root+'/dependency-layout.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({packages:packages.size,files:files.length,links:links.length,bytes:files.reduce((n,f)=>n+f.bytes,0),skipped:skipped.length,NativeExecution:false}));
