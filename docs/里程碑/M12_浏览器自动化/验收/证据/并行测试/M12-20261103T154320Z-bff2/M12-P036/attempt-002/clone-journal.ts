import {z} from 'zod';
import {chmodSync,closeSync,constants,fsyncSync,lstatSync,mkdirSync,openSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {browserProfileSchema} from '@shared/browser-profiles';
import {atomicWrite,readLimited} from '../projects/transfer-files';
export const browserCloneIntentSchema=z.object({schemaVersion:z.literal(1),targetId:z.uuid(),stagingId:z.uuid(),sourceId:browserProfileSchema.shape.id,taskId:z.string().min(1),projectId:z.string().min(1),createdAt:z.number().int().nonnegative()}).strict().refine(value=>value.targetId!==value.sourceId);
export type BrowserCloneIntent=z.infer<typeof browserCloneIntentSchema>;
/** Only non-secret identities, never Cookie/storage contents or arbitrary
 * paths. Metadata publication is the commit point for the target partition. */
export class BrowserCloneJournals {
  readonly directory:string;
  private readonly parent:string;
  constructor(userData:string){this.parent=join(userData,'browser');this.directory=join(this.parent,'clone-journal');}
  private ensure(){for(const p of[this.parent,this.directory]){mkdirSync(p,{recursive:true,mode:0o700});const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink())throw new ApplicationError('BROWSER_UNAVAILABLE','克隆恢复目录不可用');chmodSync(p,0o700);}}
  path(id:string){if(!z.uuid().safeParse(id).success)throw new ApplicationError('INVALID_INPUT','克隆身份无效');return join(this.directory,id+'.json');}
  pending():string[]{this.ensure();return readdirSync(this.directory).filter(name=>name.endsWith('.json')).map(name=>{const id=name.slice(0,-5);this.path(id);return id;});}
  private exists(path:string){try{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink())throw new ApplicationError('BROWSER_UNAVAILABLE','克隆恢复文件类型无效');return true;}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return false;throw error;}}
  read(id:string):BrowserCloneIntent|null{
    this.ensure();const path=this.path(id);if(!this.exists(path))return null;
    try{const value=browserCloneIntentSchema.parse(JSON.parse(readLimited(path,65536).toString('utf8')));if(value.targetId!==id)throw Error();return value;}catch{throw new ApplicationError('BROWSER_UNAVAILABLE','克隆恢复记录无法校验，原文件保留');}
  }
  write(input:BrowserCloneIntent){const value=browserCloneIntentSchema.parse(input);this.ensure();const path=this.path(value.targetId);if(this.exists(path))throw new ApplicationError('RESOURCE_BUSY','克隆身份仍有未完成记录');atomicWrite(path,Buffer.from(JSON.stringify(value)));}
  remove(id:string,stagingId:string){const value=this.read(id);if(!value)return;if(value.stagingId!==stagingId)throw new ApplicationError('RESOURCE_STATE_CHANGED','克隆恢复记录已变化');unlinkSync(this.path(id));const fd=openSync(this.directory,constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}}
}
