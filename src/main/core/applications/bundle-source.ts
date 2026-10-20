import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { ApplicationError, isPackagePath } from '@shared/applications';
import { capabilityBundleIndexSchema, type CapabilityBundleIndex } from '@shared/capability-bundles';
import { agentAdapterMetadataSchema } from '@shared/agent-adapters';
import { canonicalJson, digest } from './manifest';
import { fileNames } from './package-files';
import { ownedBundle } from './owned-bundle';
import { validateRuntime, type RuntimeBundle } from './runtime-registry';
export class CapabilityBundleSource {
  readonly index: CapabilityBundleIndex;
  constructor(readonly root: string) {
    try { this.root = realpathSync(root);const bytes = readFileSync(join(this.root,'index.json'));if(bytes.length>4*1024*1024)throw new Error();const index=capabilityBundleIndexSchema.parse(JSON.parse(bytes.toString('utf8'))),{indexHash,...content}=index;
      if(digest(canonicalJson(content))!==indexHash || index.adapters.some(a=>a.path!==`adapters/${a.agentId}/${a.version}/${a.hash}`) || index.runtimes.some(r=>r.path!==`runtimes/${r.hash}`) || new Set(index.adapters.map(a=>a.agentId+':'+a.version)).size!==index.adapters.length || new Set(index.runtimes.map(r=>r.hash)).size!==index.runtimes.length || digest(canonicalJson({adapters:index.adapters,runtimes:index.runtimes,apps:index.apps}))!==index.build.resourceSetHash)throw new Error();this.index=index;
    }catch{throw new ApplicationError('INVALID_PACKAGE','随程序分发的能力索引无效，应用能力暂不可用');}
  }
  private tree(path: string,manifestName: string): { manifest: Record<string,unknown>;files: Record<string,Buffer> } {
    try { let current=this.root;for(const part of path.split('/')){current=join(current,part);const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error();}const root=join(this.root,path),names=fileNames(root),raw=readFileSync(join(root,manifestName));if(raw.length>4*1024*1024)throw new Error();const manifest=JSON.parse(raw.toString('utf8')) as Record<string,unknown>,declared=manifest.files as {path:string;size:number;sha256:string}[];
      if(!Array.isArray(declared)||!declared.length||declared.length>4096||names.length!==declared.length+1||new Set(declared.map(f=>f.path.toLowerCase())).size!==declared.length)throw new Error();const files:Record<string,Buffer>={};let total=0;
      for(const f of declared){if(!isPackagePath(f.path)||f.path===manifestName||!names.includes(f.path)||!Number.isSafeInteger(f.size)||f.size<0||f.size>64*1024*1024)throw new Error();const file=join(root,f.path),stat=lstatSync(file);total+=stat.size;if(total>256*1024*1024||stat.size!==f.size||!stat.isFile())throw new Error();const bytes=readFileSync(file);if(digest(bytes)!==f.sha256)throw new Error();files[f.path]=bytes;}return {manifest,files};
    }catch{throw new ApplicationError('HASH_MISMATCH','随程序分发的能力完整文件树无效');}
  }
  adapters() { return this.index.adapters.map(entry=>{const source=this.tree(entry.path,'bundle.json'),metadata=agentAdapterMetadataSchema.parse(source.manifest.metadata),bundle=ownedBundle(metadata,source.files);if(bundle.hash!==entry.hash||metadata.agentId!==entry.agentId||metadata.version!==entry.version||canonicalJson(bundle.manifest)!==canonicalJson(source.manifest))throw new ApplicationError('HASH_MISMATCH','适配器与构建索引不同');return{metadata,files:source.files,hash:entry.hash};}); }
  runtime(entry = this.index.runtimes.find(r=>r.id==='applications')): RuntimeBundle { if(!entry)throw new ApplicationError('NOT_FOUND','业务桥未随程序准备');const source=this.tree(entry.path,'runtime.json'),bundle={id:entry.id,protocolMajor:entry.protocolMajor,bridgeEntry:entry.bridgeEntry,files:source.files},validated=validateRuntime(bundle);if(validated.hash!==entry.hash||canonicalJson(validated.manifest)!==canonicalJson(source.manifest))throw new ApplicationError('HASH_MISMATCH','业务桥与构建索引不同');return bundle; }
}
