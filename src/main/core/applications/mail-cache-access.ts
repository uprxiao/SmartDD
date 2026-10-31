import {mkdirSync,lstatSync,realpathSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {acquireDatabaseAccess,type DatabaseAccessLease} from '../../db/database-access-gate';
import type {ResourceStore} from './resource-store';

/** Reserved inside the existing four-index metadata envelope, not an extra
 * allowance outside the U's 500MB budget. The gate never lives in a corrupt index. */
export const MAIL_CACHE_CONTROL_RESERVE=64*1024;
const CONTROL='.database-access.sqlite';
function controlRoot(store:ResourceStore):string{
 const root=join(dirname(store.root),'cache');
 try{mkdirSync(root,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const stat=lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(root)!==root)throw new ApplicationError('OWNERSHIP_CONFLICT','邮件缓存协调根归属不能核验');
 return root;
}
function inspect(root:string):{bytes:number;unrecognized:string[]}{
 let bytes=0;const unrecognized:string[]=[];
 for(const name of readdirSync(root).filter(name=>name===CONTROL||name.startsWith(CONTROL+'-'))){
  const stat=lstatSync(join(root,name));
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new ApplicationError('OWNERSHIP_CONFLICT','邮件缓存协调文件归属不能核验');
  bytes+=stat.size;if(![CONTROL,CONTROL+'-journal'].includes(name))unrecognized.push(name);
 }
 if(!Number.isSafeInteger(bytes)||bytes>MAIL_CACHE_CONTROL_RESERVE)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','邮件缓存协调文件超出保留预算，保留现场');
 return{bytes,unrecognized};
}
export async function acquireMailCacheAccess(store:ResourceStore,mode:DatabaseAccessLease['mode'],options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<DatabaseAccessLease>{
 const root=controlRoot(store);if(inspect(root).unrecognized.length)throw new ApplicationError('OWNERSHIP_CONFLICT','邮件缓存存在未识别协调文件，保留现场');
 try{return await acquireDatabaseAccess(root,mode,options);}
 catch(error){
  if(options.signal?.aborted)throw new ApplicationError('CANCELED','已取消等待邮件缓存协调');
  if(error instanceof Error&&error.message.includes('仍有宿主'))throw new ApplicationError('RESOURCE_BUSY','邮件缓存仍有其他宿主占用，请稍后重试');
  throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','邮件缓存协调状态不能核验，保留现场');
 }
}
export function mailCacheControlUsage(lease:DatabaseAccessLease):{bytes:number;unrecognized:string[]}{lease.assertHeld();return inspect(lease.root);}
