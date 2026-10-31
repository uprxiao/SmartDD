import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { definitions } from '../../resources/applications/definitions.mjs';
import bundleVerifier from './verify-bundles.cjs';
const digest = value => createHash('sha256').update(value).digest('hex');
function compare(a,b) { const aa=Array.from(a,c=>c.codePointAt(0)),bb=Array.from(b,c=>c.codePointAt(0)); for(let i=0;i<Math.min(aa.length,bb.length);i++) if(aa[i]!==bb[i])return aa[i]-bb[i]; return aa.length-bb.length; }
function canonical(value) { if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'; if(value && typeof value==='object')return '{'+Object.keys(value).sort(compare).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value); }
const runtimeEntry = resolve(process.argv[3] || 'out/applications/mcp-bridge.cjs');
const output = resolve(process.argv[2] || 'out/capability-bundles'), stage = output + '.tmp-' + randomUUID(); mkdirSync(stage,{recursive:true,mode:0o700});
const readTree = (root,dir=root) => Object.fromEntries(readdirSync(dir).sort().flatMap(name => { const p=join(dir,name),s=lstatSync(p);if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw new Error('Bundle source links/special files are not allowed');return s.isDirectory()?Object.entries(readTree(root,p)):[[p.slice(root.length+1),readFileSync(p)]]; }));
const writeTree = (root,files) => { for(const [path,bytes] of Object.entries(files)){const target=join(root,path);mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,bytes,{mode:0o600,flag:'wx'});} };
try {
  const adapters=[],runtimes=[],apps=[];
  const runtimeFiles={'mcp-bridge.cjs':readFileSync(runtimeEntry)},runtimeManifest={schema:'smartdd-app-runtime-v1',id:'applications',protocolMajor:1,bridgeEntry:'mcp-bridge.cjs',files:Object.entries(runtimeFiles).map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes)}))},runtimeHash=digest(canonical(runtimeManifest)),runtimePath='runtimes/'+runtimeHash;
  writeTree(join(stage,runtimePath),{...runtimeFiles,'runtime.json':Buffer.from(canonical(runtimeManifest)+'\n')});runtimes.push({id:'applications',protocolMajor:1,hash:runtimeHash,path:runtimePath,bridgeEntry:'mcp-bridge.cjs'});
  for(const agentId of ['claude-code','codex']) for(const adapterVersion of ['1.0.0','1.1.0']) {
    const source=readTree(resolve('resources/agent-adapters',agentId,adapterVersion)),metadata=JSON.parse(source['adapter.json'].toString('utf8'));delete source['adapter.json'];
    const manifest={schema:'willyou-owned-bundle-v1',metadata,files:Object.entries(source).map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes),executable:false})).sort((a,b)=>compare(a.path,b.path))},hash=digest(canonical(manifest)),path='adapters/'+agentId+'/'+metadata.version+'/'+hash;
    writeTree(join(stage,path),{...source,'bundle.json':Buffer.from(canonical(manifest)+'\n')});adapters.push({agentId,version:metadata.version,hash,path});
  }
  for (const definition of definitions) {
    const { tools, connectionSchemas, ...metadata } = definition;
    if (metadata.runtime.hash !== runtimeHash) throw new Error(`Pinned application runtime changed for ${metadata.appId}@${metadata.version}; review and use a new application version`);
    const files = readTree(resolve('resources/applications',metadata.appId,metadata.version));
    files['adapter/index.cjs'] = readFileSync(resolve('resources/applications/adapter.cjs'));
    files['adapter/operations.json'] = Buffer.from(canonical({ appId: metadata.appId, version: metadata.version, operations: Object.fromEntries(tools.map(t => [t.name,t.operation])) }) + '\n');
    for (const [provider,schema] of Object.entries(connectionSchemas)) files[`schemas/connections/${provider}.json`] = Buffer.from(canonical(schema) + '\n');
    const declarations = tools.map(({ input, output, operation, description, ...tool }) => {
      const inputSchemaPath = `schemas/tools/${tool.name}.input.json`, outputSchemaPath = `schemas/tools/${tool.name}.output.json`;
      files[inputSchemaPath] = Buffer.from(canonical({ ...input, description }) + '\n');
      files[outputSchemaPath] = Buffer.from(canonical(output) + '\n');
      return { ...tool, inputSchemaPath, outputSchemaPath };
    });
    const manifest = { ...metadata, tools: declarations, files: Object.entries(files).map(([path,bytes]) => ({ path, size: bytes.length, sha256: digest(bytes), executable: false })).sort((a,b) => compare(a.path,b.path)) };
    const hash = digest(canonical(manifest)), path = `apps/${metadata.appId}/${metadata.version}/${hash}`;
    writeTree(join(stage,path),{ ...files, 'manifest.json': Buffer.from(canonical(manifest) + '\n') });
    apps.push({ appId: metadata.appId, version: metadata.version, hash, path });
  }
  // Source metadata is optional. A stalled shared Git directory must not block
  // complete immutable-resource preparation; unknown status remains dirty.
  const gitOptions={encoding:'utf8',timeout:2000,killSignal:'SIGKILL',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}};
  let commit=null,dirty=true;try { commit=execFileSync('git',['rev-parse','HEAD'],gitOptions).trim();dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=normal'],gitOptions).trim(); }catch(error){if(process.env.WY_METADATA_DIAGNOSTIC)writeFileSync(process.env.WY_METADATA_DIAGNOSTIC,JSON.stringify({code:error.code,status:error.status,signal:error.signal,message:error.message,path:error.path,spawnargs:error.spawnargs,childPath:gitOptions.env.PATH,childLocks:gitOptions.env.GIT_OPTIONAL_LOCKS,observation:gitOptions.env.WY_METADATA_LOCK_OBSERVATION},null,2));}
  const build={appVersion:JSON.parse(readFileSync('package.json','utf8')).version,commit,dirty,resourceSetHash:digest(canonical({adapters,runtimes,apps}))},index={schema:'willyou-capability-bundles-v1',build,adapters,runtimes,apps};index.indexHash=digest(canonical(index));
  writeFileSync(join(stage,'index.json'),canonical(index)+'\n',{mode:0o600,flag:'wx'});writeFileSync(join(stage,'.willyou-build.json'),JSON.stringify({schema:1,kind:'capability-bundles'})+'\n',{mode:0o600,flag:'wx'});
  bundleVerifier.verifyCapabilityBundles(stage,build.appVersion);
  if(existsSync(output)){if(lstatSync(output).isSymbolicLink()||JSON.parse(readFileSync(join(output,'.willyou-build.json'),'utf8')).kind!=='capability-bundles')throw new Error('Refuse to replace an unknown output tree');const previous=output+'.old-'+randomUUID();renameSync(output,previous);try{renameSync(stage,output);}catch(error){renameSync(previous,output);throw error;}rmSync(previous,{recursive:true});}
  else {mkdirSync(dirname(output),{recursive:true});renameSync(stage,output);}
  process.stdout.write(JSON.stringify({adapters:adapters.length,runtimes:runtimes.length,apps:apps.length,indexHash:index.indexHash,resourceSetHash:build.resourceSetHash})+'\n');
}catch(error){rmSync(stage,{recursive:true,force:true});throw error;}
