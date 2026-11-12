import {constants,closeSync,existsSync,fchmodSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readSync,readdirSync,realpathSync,writeSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ApplicationError,isPackagePath} from '@shared/applications';
import {ensureStoreDirectory} from '../package-files';

const LIMITS={files:20000,bytes:1024*1024*1024,depth:32};
export function syncPluginPath(path:string):void {const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
export function assertPluginDataTree(root:string):void {
  let files=0,bytes=0;
  const walk=(directory:string,depth:number)=>{
    const stat=lstatSync(directory);
    if(depth>LIMITS.depth||stat.isSymbolicLink()||!stat.isDirectory()||realpathSync(directory)!==directory)throw new ApplicationError('OWNERSHIP_CONFLICT','插件私有数据目录包含链接或层级超限，原数据未改变');
    for(const name of readdirSync(directory)){
      if(!isPackagePath(name)||++files>LIMITS.files)throw new ApplicationError('TOO_LARGE','插件私有数据条目无效或数量超限');
      const path=join(directory,name),item=lstatSync(path);
      if(item.isSymbolicLink()||!item.isDirectory()&&(!item.isFile()||item.nlink!==1))throw new ApplicationError('OWNERSHIP_CONFLICT','插件私有数据包含链接或特殊文件，原数据未改变');
      if(item.isDirectory())walk(path,depth+1);else if((bytes+=item.size)>LIMITS.bytes)throw new ApplicationError('TOO_LARGE','插件私有数据超过迁移预算，原数据未改变');
    }
  };
  walk(root,0);
}
/** Called only after every child using the original directory has closed. No links or special files are followed. */
export function copyPluginDataTree(source:string|undefined,target:string):void {
  if(existsSync(target))throw new ApplicationError('OWNERSHIP_CONFLICT','插件候选数据目录已被占用');
  if(source)assertPluginDataTree(source);
  mkdirSync(target,{mode:0o700});
  const walk=(from:string,to:string)=>{
    if(realpathSync(from)!==from||lstatSync(from).isSymbolicLink())throw new ApplicationError('OWNERSHIP_CONFLICT','复制时插件数据目录变成链接');
    for(const name of readdirSync(from).sort()){
      const input=join(from,name),output=join(to,name),stat=lstatSync(input);
      if(stat.isDirectory()){ensureStoreDirectory(to,name);walk(input,output);continue;}
      const src=openSync(input,constants.O_RDONLY|constants.O_NOFOLLOW);let dst:number|undefined;
      try{
        dst=openSync(output,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
        const before=fstatSync(src);
        if(!before.isFile()||before.nlink!==1||before.dev!==stat.dev||before.ino!==stat.ino||before.size!==stat.size||realpathSync(input)!==input)throw new ApplicationError('RESOURCE_STATE_CHANGED','复制时插件数据发生变化');
        const buffer=Buffer.allocUnsafe(64*1024);let total=0,count:number;
        while((count=readSync(src,buffer,0,buffer.length,null))>0){
          total+=count;if(total>stat.size)throw new ApplicationError('RESOURCE_STATE_CHANGED','复制时插件数据增长');
          let offset=0;while(offset<count){const written=writeSync(dst,buffer,offset,count-offset);if(written===0)throw new ApplicationError('SOURCE_UNAVAILABLE','插件数据复制未能写入');offset+=written;}
        }
        const after=fstatSync(src);
        if(total!==stat.size||before.mtimeMs!==after.mtimeMs||before.size!==after.size||before.mode!==after.mode)throw new ApplicationError('RESOURCE_STATE_CHANGED','复制时插件数据发生变化');
        fchmodSync(dst,before.mode&0o700);
        fsyncSync(dst);
      }finally{closeSync(src);if(dst!==undefined)closeSync(dst);}
    }
    syncPluginPath(to);
  };
  if(source)walk(source,target);else syncPluginPath(target);
  syncPluginPath(dirname(target));
}
