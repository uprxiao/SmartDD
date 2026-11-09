import {createHash,randomUUID} from 'node:crypto';
import {constants,createReadStream} from 'node:fs';
import {copyFile,lstat,mkdir,open,readdir,realpath,rm} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';
import {ApplicationError} from '@shared/applications';

interface Entry {path:string;directory:boolean;identity:string}
async function tree(root:string,signal?:AbortSignal):Promise<Entry[]>{
  const entries:Entry[]=[];
  const visit=async(path:string)=>{
    signal?.throwIfAborted();const s=await lstat(join(root,path),{bigint:true});
    if(s.isSymbolicLink()||!s.isDirectory()&&!s.isFile())throw new ApplicationError('BROWSER_UNAVAILABLE','登录态含不能安全复制的文件类型');
    entries.push({path,directory:s.isDirectory(),identity:[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':')});
    if(s.isDirectory())for(const name of (await readdir(join(root,path))).sort())await visit(path?join(path,name):name);
  };
  await visit('');return entries;
}
async function hash(path:string,signal?:AbortSignal):Promise<string>{
  const digest=createHash('sha256');for await(const bytes of createReadStream(path,{signal}))digest.update(bytes);return digest.digest('hex');
}
async function sync(path:string){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
/** Copy-only component for full persistent partitions, including native stores
 * whose formats we must not flatten into Cookie/localStorage DTOs. It never
 * changes/unloads the source. The caller owns profile locks, target publication
 * and durable cleanup of an unpublished clone after process interruption. */
export function browserProfileSnapshotStage(parent:string,id:string):string{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new ApplicationError('INVALID_INPUT','克隆临时身份无效');
  return join(parent,'.willyou-clone-'+id);
}
export async function copyBrowserProfileSnapshot(options:{source:string;destination:string;signal?:AbortSignal;admit?:()=>void;beforeVerify?:()=>Promise<void>;stagingId?:string}):Promise<{files:number;bytes:number}>{
  const source=await realpath(options.source),parent=await realpath(dirname(options.destination)),destination=join(parent,relative(dirname(options.destination),options.destination));
  const inside=relative(source,destination);if(!isAbsolute(options.destination)||!inside||inside!=='..'&&!inside.startsWith('..'+sep)&&!isAbsolute(inside))throw new ApplicationError('INVALID_INPUT','克隆目标必须在原登录态之外');
  try{await lstat(destination);throw new ApplicationError('RESOURCE_BUSY','克隆目标已存在');}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
  const signal=options.signal,stage=browserProfileSnapshotStage(parent,options.stagingId??randomUUID());let owned=false;
  try{
    for(let attempt=0;attempt<3;attempt++){
      signal?.throwIfAborted();options.admit?.();await mkdir(stage,{mode:0o700});owned=true;
      try{
        const before=await tree(source,signal),digests=new Map<string,string>();let bytes=0;
        for(const entry of before){
          signal?.throwIfAborted();if(!entry.path)continue;const to=join(stage,entry.path);
          if(entry.directory){await mkdir(to,{mode:0o700});continue;}
          await copyFile(join(source,entry.path),to,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);signal?.throwIfAborted();
          const file=await open(to,'r+');try{await file.chmod(0o600);await file.sync();}finally{await file.close();}
          digests.set(entry.path,await hash(to,signal));bytes+=Number((await lstat(to)).size);
        }
        await options.beforeVerify?.();options.admit?.();const after=await tree(source,signal);
        let stable=JSON.stringify(before)===JSON.stringify(after);
        if(stable)for(const[path,digest]of digests)if(await hash(join(source,path),signal)!==digest){stable=false;break;}
        if(!stable){await rm(stage,{recursive:true,force:true});owned=false;continue;}
        for(const entry of [...before].reverse())if(entry.directory)await sync(join(stage,entry.path));
        signal?.throwIfAborted();options.admit?.();
        // Exclusive directory creation, rather than check-then-rename, cannot
        // overwrite a target that appeared during source verification. The
        // manager publishes metadata only after the reserved target is durable.
        await mkdir(destination,{mode:0o700});
        try{
          for(const entry of before){
            signal?.throwIfAborted();if(!entry.path)continue;
            const to=join(destination,entry.path);
            if(entry.directory)await mkdir(to,{mode:0o700});
            else{await copyFile(join(stage,entry.path),to,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);const file=await open(to,'r+');try{await file.chmod(0o600);await file.sync();}finally{await file.close();}}
          }
          for(const entry of [...before].reverse())if(entry.directory)await sync(join(destination,entry.path));
          signal?.throwIfAborted();options.admit?.();await sync(parent);return{files:digests.size,bytes};
        }catch(error){await rm(destination,{recursive:true,force:true});throw error;}
      }catch(error){await rm(stage,{recursive:true,force:true});owned=false;throw error;}
    }
    throw new ApplicationError('RESOURCE_BUSY','原登录态在复制期间持续变化，请稍后再克隆');
  }finally{if(owned)await rm(stage,{recursive:true,force:true});}
}
