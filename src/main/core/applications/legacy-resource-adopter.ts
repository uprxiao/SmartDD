import { closeSync,constants,fstatSync,lstatSync,openSync,readSync,readdirSync } from 'node:fs';
import { dirname, join,relative } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { treeHash } from '../capabilities/assets';
import { writeOwnedTree } from '../capabilities/files';
import { ensureStoreDirectory } from './package-files';
import type { ResourceRecord, ResourceStore } from './resource-store';
/** Read legacy bytes without changing the schema1 marker, names, paths or hash algorithm. */
export function readLegacyOwnedTree(root:string,expectedHash:string):Record<string,string>{
 try{
  const files:Record<string,string>=Object.create(null);let count=0,total=0,visited=0;
  const walk=(directory:string,depth:number)=>{
   const dir=lstatSync(directory);if(!dir.isDirectory()||dir.isSymbolicLink()||depth>32||++visited>4096)throw Error('legacy directory');
   const names=readdirSync(directory);if(!names.length)throw Error('undeclared empty directory');
   for(const name of names){
    const path=join(directory,name),stat=lstatSync(path);if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw Error('legacy file');if(stat.isDirectory()){walk(path,depth+1);continue;}
    if(++count>4096||stat.nlink!==1||(stat.mode&0o111)!==0||stat.size>4*1024*1024||(total+=stat.size)>32*1024*1024)throw Error('legacy budget/ownership');
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=fstatSync(fd);if(before.dev!==stat.dev||before.ino!==stat.ino||before.size!==stat.size||before.ctimeMs!==stat.ctimeMs)throw Error('legacy changed');const buffer=Buffer.alloc(stat.size+1);let length=0;while(length<buffer.length){const n=readSync(fd,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}const bytes=buffer.subarray(0,length),after=fstatSync(fd),text=bytes.toString('utf8');if(length!==stat.size||after.size!==stat.size||after.ino!==stat.ino||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||!Buffer.from(text).equals(bytes))throw Error('legacy changed bytes');files[relative(root,path)]=text;}finally{closeSync(fd);}
   }
  };walk(root,0);const marker=JSON.parse(files['.smartdd-owned.json']);if(marker.owner!=='SmartDD'||marker.schema!==1||Object.keys(marker).length!==2)throw Error('legacy marker');delete files['.smartdd-owned.json'];if(treeHash(files)!==expectedHash)throw Error('legacy hash');return files;
 }catch{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原M4完整资源或归属无法核验，不能从当前版本猜测补齐');}
}

/** Preserve the original M4 paths, bytes, marker and legacy-tree-v1 algorithm. */
export class LegacyCapabilityResourceAdopter {
  constructor(readonly store: ResourceStore) {}
  private read(relative: string,expectedHash: string): Record<string,string> {
    ensureStoreDirectory(this.store.root,dirname(relative)); return this.readDirectory(join(this.store.root,relative),expectedHash);
  }
  private readDirectory(root:string,expectedHash:string):Record<string,string>{return readLegacyOwnedTree(root,expectedHash);}
  async adoptStandard(skillId: string,hash: string): Promise<ResourceRecord> { if (!/^[a-z][a-z0-9-]{0,63}$/.test(skillId) || !/^[a-f0-9]{64}$/.test(hash)) throw new ApplicationError('INVALID_INPUT','标准Skill身份无效'); return this.adopt('standard-skill',`standard-skill:${skillId}:${hash}`,`packages/${skillId}/${hash}`,hash); }
  async adoptRuntime(hash: string): Promise<ResourceRecord> { if (!/^[a-f0-9]{64}$/.test(hash)) throw new ApplicationError('INVALID_INPUT','历史运行资源摘要无效'); return this.adopt('legacy-runtime','legacy-runtime:' + hash,'runtime/' + hash,hash); }
  private async adopt(kind: string,resourceId: string,relativePath: string,hash: string): Promise<ResourceRecord> {
    const files = this.read(relativePath,hash);
    return this.store.publish({ resourceId,kind,contentHash: hash,relativePath,dependencies: [],materialize: stage => writeOwnedTree(stage,files,join(this.store.root,'conflicts')),verify: directory => { this.readDirectory(directory,hash); } });
  }
  verify(resource: ResourceRecord): Record<string,string> {
    if (!['standard-skill','legacy-runtime'].includes(resource.kind) || resource.ownerStoreId !== this.store.storeId || resource.state !== 'ready' || resource.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4资源尚未就绪');
    if (resource.kind === 'standard-skill' && resource.relativePath !== 'packages/' + resource.resourceId.slice('standard-skill:'.length).replace(':','/')) throw new ApplicationError('OWNERSHIP_CONFLICT','标准Skill原路径不同');
    if (resource.kind === 'legacy-runtime' && resource.relativePath !== 'runtime/' + resource.contentHash) throw new ApplicationError('OWNERSHIP_CONFLICT','历史运行资源原路径不同');
    return this.read(resource.relativePath,resource.contentHash);
  }
}
