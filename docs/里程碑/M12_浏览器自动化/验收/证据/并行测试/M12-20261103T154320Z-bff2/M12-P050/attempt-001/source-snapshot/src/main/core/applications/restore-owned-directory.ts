import {execFileSync} from 'node:child_process';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
export interface DirectoryRestoreInput {root:string;from:string;to:string;rootIdentity:{dev:number;ino:number};sourceIdentity:{dev:number;ino:number};scope?:'C'|'H'}
export type DirectoryRestorer=(input:DirectoryRestoreInput)=>void;
/** Native anchored rename with RENAME_EXCL: even an empty target must survive. */
export function restoreOwnedDirectory(helper:string,input:DirectoryRestoreInput):void{
 if(process.platform!=='darwin')throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前系统尚未验证原目录完整恢复');
 let reply:z.infer<typeof response>;
 try{reply=response.parse(JSON.parse(execFileSync(helper,[input.scope==='H'?'--move-discovery-directory':'--restore-owned-directory',input.root,input.from,input.to,String(input.rootIdentity.dev),String(input.rootIdentity.ino),String(input.sourceIdentity.dev),String(input.sourceIdentity.ino)],{encoding:'utf8',timeout:5000,maxBuffer:4096,stdio:['ignore','pipe','ignore']})));}
 catch{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原目录完整恢复未完成，保留现场');}
 if(!reply.restored)throw new ApplicationError(reply.error==='EXDEV'?'RESOURCE_RECOVERY_REQUIRED':'OWNERSHIP_CONFLICT',reply.error==='EXDEV'?'原目录不在同一存储卷，保留现场':'原路径被占用或目录身份变化，保留双方内容');
}
const response=z.discriminatedUnion('restored',[z.object({schema:z.literal(1),restored:z.literal(true)}).strict(),z.object({schema:z.literal(1),restored:z.literal(false),error:z.enum(['EXDEV','EEXIST','OWNERSHIP'])}).strict()]);
