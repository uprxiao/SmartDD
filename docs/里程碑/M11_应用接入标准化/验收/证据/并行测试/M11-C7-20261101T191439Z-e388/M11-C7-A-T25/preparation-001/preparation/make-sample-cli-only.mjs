// Coordinator-only data fixture generator. Do not run on the baseline source.
// No build, child process, App, network listener, credentials or host-core edits.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,realpathSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';

const args=process.argv.slice(2),options={};
assert(args.length===10,'Required: --source BASE --target PRIVATE-t25-variant-source --source-manifest FILE --source-sha SHA256 --evidence EMPTY-DIR');
for(let i=0;i<args.length;i+=2){assert(['--source','--target','--source-manifest','--source-sha','--evidence'].includes(args[i]));assert(!Object.hasOwn(options,args[i]));options[args[i]]=args[i+1];}
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=realpathSync(options['--source']),target=realpathSync(options['--target']),evidence=resolve(options['--evidence']);
assert.notEqual(source,target);assert(!target.startsWith(source+'/')&&!source.startsWith(target+'/'));
assert(/^\/private\/(tmp\/|var\/folders\/.*\/T\/)/.test(target),'Only a private temporary variant copy may be changed');
assert(/t25.*variant|variant.*t25/i.test(basename(target)),'Target must be an explicit T25 variant copy');
assert(!evidence.startsWith(source+'/')&&!evidence.startsWith(target+'/'),'Evidence must be outside both source trees');
assert(!existsSync(evidence),'Evidence output must be new');
const manifestBytes=readFileSync(options['--source-manifest']);assert(/^[a-f0-9]{64}$/.test(options['--source-sha']));assert.equal(sha(manifestBytes),options['--source-sha']);
const manifest=JSON.parse(manifestBytes);assert(Array.isArray(manifest.files)&&Array.isArray(manifest.outFiles));
for(const entry of [...manifest.files,...manifest.outFiles]){
 assert.equal(sha(readFileSync(join(source,entry.path))),entry.sha256,'Frozen source mismatch: '+entry.path);
 assert.equal(sha(readFileSync(join(target,entry.path))),entry.sha256,'Private copy mismatch: '+entry.path);
}
const definition='resources/applications/sample-kv/definition.mjs',oldDefinition=readFileSync(join(source,definition),'utf8');
const substitutions=[
 ["version:'1.0.0'","version:'1.0.1'"],
 ["entry:'mcp'","entry:'cli'"],
 ["binding:{mcp:{tool:'smartdd_sample_kv_'+mode+'_v2'}}","binding:{cli:{command:['sample-kv','entry',mode]}}"],
];
let newDefinition=oldDefinition;
for(const [before,after] of substitutions){assert.equal(newDefinition.split(before).length-1,1,'Unexpected data definition shape');newDefinition=newDefinition.replace(before,after);}
assert(!newDefinition.includes('fallback:'),'The fixture must have no fallback');
const oldVersion='resources/applications/sample-kv/1.0.0',newVersion='resources/applications/sample-kv/1.0.1';
assert(!existsSync(join(target,newVersion)),'Never overwrite an existing fixture version');
const copied=[];
function copyData(dir,relative=''){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const rel=relative?relative+'/'+entry.name:entry.name,from=join(dir,entry.name),st=lstatSync(from);assert(!st.isSymbolicLink());
  if(st.isDirectory()){mkdirSync(join(target,newVersion,rel));copyData(from,rel);}
  else{assert(st.isFile());const bytes=readFileSync(from),to=join(target,newVersion,rel);writeFileSync(to,bytes,{flag:'wx',mode:st.mode&0o777});copied.push({path:newVersion+'/'+rel,sourcePath:oldVersion+'/'+rel,bytes:bytes.length,sha256:sha(bytes),change:'New version directory; original data bytes unchanged'});}
 }
}
mkdirSync(join(target,newVersion));
try{
 copyData(join(source,oldVersion));writeFileSync(join(target,definition),newDefinition);
 for(const entry of [...manifest.files,...manifest.outFiles]){
  assert.equal(sha(readFileSync(join(source,entry.path))),entry.sha256,'Baseline changed');
  if(entry.path!==definition)assert.equal(sha(readFileSync(join(target,entry.path))),entry.sha256,'Unrelated target file changed: '+entry.path);
 }
 const changes=[{path:definition,bytes:Buffer.byteLength(newDefinition),beforeSha256:sha(Buffer.from(oldDefinition)),sha256:sha(Buffer.from(newDefinition)),fields:['version 1.0.0 -> 1.0.1','entry mcp -> cli','read/write binding MCP -> CLI command; no fallback'],change:'Package declaration data only'},...copied];
 mkdirSync(evidence,{recursive:true});
 const result={schema:'m11-t25-private-data-variant-v1',createdAt:new Date().toISOString(),source,target,baseSourceManifestSha256:options['--source-sha'],generatorSha256:sha(readFileSync(new URL(import.meta.url))),files:changes,hostCoreModified:false,mailAndZentaoDeclarationsModified:false,outModified:false,buildStarted:false,appStarted:false,credentialOrNetworkUsed:false,note:'Coordinator must build/verify/package this private source as its own App variant. No original App or bundle is overwritten. App unavailable wording must come from the actual host.'};
 writeFileSync(join(evidence,'difference-manifest.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'data-only-variant-prepared',files:changes.length,evidence}));
}catch(error){writeFileSync(join(target,definition),oldDefinition);rmSync(join(target,newVersion),{recursive:true,force:true});throw error;}
