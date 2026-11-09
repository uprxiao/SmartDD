import {constants,closeSync,fstatSync,lstatSync,openSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import {ApplicationError,isPackagePath} from '@shared/applications';
import {canonicalJson,compareCodePoints,digest} from './manifest';
import {PackageRegistry} from './package-registry';
import {RuntimeRegistry} from './runtime-registry';
import {AgentAdapterRegistry} from './agent-adapter-registry';
import {LegacyCapabilityResourceAdopter,readLegacyOwnedTree} from './legacy-resource-adopter';
import {verifyOwnedBundle} from './owned-bundle';
import {verifyPackageTree} from './package-files';
import type {ResourceRecord,ResourceStore} from './resource-store';
const inode=z.object({dev:z.number().int().nonnegative(),ino:z.number().int().nonnegative(),mode:z.number().int().nonnegative()}).strict();
const entry=z.object({path:z.string().refine(isPackagePath),identity:inode,kind:z.enum(['directory','file']),size:z.number().int().nonnegative().optional(),hash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export const gcTreeSchema=z.object({anchor:z.string(),anchorIdentity:inode,directory:inode,entries:z.array(entry).min(1).max(32768)}).strict();
export type GcTree=z.infer<typeof gcTreeSchema>;
export function gcPresent(path:string):boolean{try{lstatSync(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
export function gcIdentity(path:string){const s=lstatSync(path);return{dev:s.dev,ino:s.ino,mode:s.mode&0o777};}
export function gcPath(anchor:string,relative:string):string{
 if(!isPackagePath(relative)||realpathSync(anchor)!==anchor||lstatSync(anchor).isSymbolicLink())throw new ApplicationError('OWNERSHIP_CONFLICT','清理根不是原规范目录');
 let at=anchor;for(const part of relative.split('/')){at=join(at,part);const s=lstatSync(at);if(s.isSymbolicLink()||!s.isDirectory())throw new ApplicationError('OWNERSHIP_CONFLICT','清理路径含链接或其他内容');}return at;
}
function tree(directory:string){
 const entries:GcTree['entries']=[];let bytes=0;
 const walk=(path:string,depth:number)=>{if(depth>64||entries.length>32768)throw new ApplicationError('TOO_LARGE','清理文件树超过预算');const initial=lstatSync(path);if(initial.isSymbolicLink()||!initial.isDirectory()||process.getuid&&initial.uid!==process.getuid())throw new ApplicationError('OWNERSHIP_CONFLICT','清理目录归属已变化');
  for(const name of readdirSync(path).sort(compareCodePoints)){const full=join(path,name),s=lstatSync(full),relative=full.slice(directory.length+1),identity=gcIdentity(full);if(process.getuid&&s.uid!==process.getuid())throw new ApplicationError('OWNERSHIP_CONFLICT','清理条目属于其他用户');
   if(s.isDirectory()&&!s.isSymbolicLink()){entries.push({path:relative,identity,kind:'directory'});walk(full,depth+1);}
   else if(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1){if(s.size>256*1024*1024||(bytes+=s.size)>512*1024*1024)throw new ApplicationError('TOO_LARGE','清理文件超过预算');const fd=openSync(full,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=fstatSync(fd);if(before.dev!==s.dev||before.ino!==s.ino||before.size!==s.size||before.ctimeMs!==s.ctimeMs)throw Error('file changed');const content=readFileSync(fd),after=fstatSync(fd);if(content.length!==s.size||after.dev!==s.dev||after.ino!==s.ino||after.size!==s.size||after.ctimeMs!==s.ctimeMs||after.mtimeMs!==s.mtimeMs)throw Error('file changed');entries.push({path:relative,identity,kind:'file',size:s.size,hash:digest(content)});}finally{closeSync(fd);}}
   else throw new ApplicationError('OWNERSHIP_CONFLICT','清理目录含链接、共享文件或特殊条目');
  }
  const after=lstatSync(path);if(after.dev!==initial.dev||after.ino!==initial.ino||after.ctimeMs!==initial.ctimeMs||after.mtimeMs!==initial.mtimeMs)throw new ApplicationError('RESOURCE_STATE_CHANGED','清理校验期间目录发生变化');
 };walk(directory,0);return{directory:gcIdentity(directory),entries:entries.sort((a,b)=>compareCodePoints(a.path,b.path))};
}
function verifySource(store:ResourceStore,row:ResourceRecord,path:string){
 if(row.kind==='application-package'){const pkg=new PackageRegistry(store,'gc-reader').get(row.contentHash);if(row.resourceId!==pkg.resourceId||row.relativePath!==`apps/${pkg.appId}/${pkg.version}/${pkg.packageHash}`)throw Error('package identity');verifyPackageTree(path,pkg,store.storeId);}
 else if(row.kind==='runtime'){if(row.resourceId!=='runtime:'+row.contentHash||row.relativePath!=='runtime/'+row.contentHash)throw Error('runtime identity');new RuntimeRegistry(store).verify(row.contentHash);}
 else if(row.kind==='agent-adapter'){if(new AgentAdapterRegistry(store).verify(row.contentHash).resource.resourceId!==row.resourceId)throw Error('adapter identity');}
 else if(['standard-skill','legacy-runtime'].includes(row.kind))new LegacyCapabilityResourceAdopter(store).verify(row);
 else if(row.kind==='legacy-agent-projection')readLegacyOwnedTree(path,row.contentHash);
 else {
  const manifest=verifyOwnedBundle(path,row.contentHash,store.storeId),taskId=manifest.metadata.taskId;
  if(row.kind==='agent-projection'){if(row.pathScope!=='H'||manifest.metadata.kind!=='codex-agent-projection-v1'||manifest.metadata.homeId!==row.scopeIdentity||row.relativePath!=='.agents/skills/'+manifest.metadata.nativeName)throw Error('H identity');}
  else if(['session-projection','claude-projection-source','claude-projection-archive'].includes(row.kind)){
   if(typeof taskId!=='string'||!isPackagePath(taskId)||taskId.includes('/')||manifest.metadata.kind!=='claude-session-projection'||row.resourceId!==`${row.kind}:${taskId}:${row.contentHash}`||row.relativePath!==(row.kind==='session-projection'?`sessions/${taskId}/claude/plugin`:`projection-sources/claude/${taskId}/${row.kind==='claude-projection-archive'?'archives':'views'}/${row.contentHash}`))throw Error('projection identity');
  }else throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','此资源须先通过专用交付协调器核查');
 }
}
export function captureGcTree(store:ResourceStore,row:ResourceRecord):GcTree{
 if(row.ownerStoreId!==store.storeId||row.state!=='ready'||row.integrity!=='valid')throw new ApplicationError('RESOURCE_STATE_CHANGED','清理资源尚未就绪');
 const path=store.directory(row),anchor=row.pathScope==='C'?store.root:path.slice(0,-row.relativePath.length-1);gcPath(anchor,row.relativePath);
 try{verifySource(store,row,path);const captured=tree(path),parents=new Set(captured.entries.filter(e=>e.kind==='file').flatMap(e=>{const out:string[]=[];for(let p=dirname(e.path);p!=='.';p=dirname(p))out.push(p);return out;}));if(captured.entries.some(e=>e.kind==='directory'&&!parents.has(e.path)))throw new ApplicationError('OWNERSHIP_CONFLICT','清理目录含未声明的空目录');return gcTreeSchema.parse({anchor,anchorIdentity:gcIdentity(anchor),...captured});}
 catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','清理资源身份或完整文件无法核验');}
}
export function verifyGcTree(path:string,receipt:GcTree,partial=false):void{
 const actual=tree(path);if(canonicalJson(actual.directory)!==canonicalJson(receipt.directory))throw new ApplicationError('OWNERSHIP_CONFLICT','原清理目录inode或权限已变化');
 const expected=new Map(receipt.entries.map(e=>[e.path,e]));if(!partial&&actual.entries.length!==receipt.entries.length)throw new ApplicationError('HASH_MISMATCH','原清理目录已部分删除，不能恢复为可用');
 for(const found of actual.entries)if(!expected.has(found.path)||canonicalJson(found)!==canonicalJson(expected.get(found.path)))throw new ApplicationError('OWNERSHIP_CONFLICT','原清理条目被替换、修改或加入未知内容');
}
