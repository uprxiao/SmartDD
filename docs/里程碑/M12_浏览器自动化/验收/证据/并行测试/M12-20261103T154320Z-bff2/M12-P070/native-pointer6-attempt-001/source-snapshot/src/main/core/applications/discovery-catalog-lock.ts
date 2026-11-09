import { lstatSync,realpathSync } from 'node:fs';
import { ApplicationError } from '@shared/applications';
import type { ProcessIdentity } from './process-identity';
import { withCoordinatorLock,type CoordinatorLockOptions } from './coordinator-lock';
/** H precedes C. Preserve the canonical root across the entire wait. */
export async function withDiscoveryLock<T>(root:string,host:ProcessIdentity,action:()=>T|Promise<T>,options:CoordinatorLockOptions={}):Promise<T>{
  const original=lstatSync(root);
  const verify=()=>{const stat=lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(root)!==root||stat.dev!==original.dev||stat.ino!==original.ino)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','共享目录的规范位置或归属已变化，保留原锁');};
  return Promise.resolve().then(()=>{verify();return withCoordinatorLock(root,'catalog',()=>{verify();return action();},options,host);});
}
