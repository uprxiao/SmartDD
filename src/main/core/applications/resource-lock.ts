import { ensureStoreDirectory } from './package-files';
import { withCoordinatorLock,type CoordinatorLockOptions } from './coordinator-lock';
/** Single-U coordinator. H precedes C; business work in C remains synchronous. */
export async function withResourceLock<T>(root:string,action:()=>T,options:CoordinatorLockOptions={}):Promise<T>{
  return withCoordinatorLock(ensureStoreDirectory(root,'locks'),'resource',()=>{
    const value=action();
    if(value instanceof Promise)throw new Error('资源协调区禁止等待网络、文件复制或异步业务');
    return value;
  },options);
}
