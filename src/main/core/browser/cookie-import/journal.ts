import {z} from 'zod';
import {chmodSync,closeSync,constants,fsyncSync,lstatSync,mkdirSync,openSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import type {SecretCipher} from '../../../secrets';
import {ApplicationError} from '@shared/applications';
import {browserProfileSchema} from '@shared/browser-profiles';
import {atomicWrite,readLimited} from '../../projects/transfer-files';

// Preserve the native CDP identity, including partition identity. An unreadable
// partition must be excluded by the source planner, never flattened here.
const partitionSchema=z.object({topLevelSite:z.url().refine(value=>{const site=new URL(value);return['http:','https:'].includes(site.protocol)&&!site.port&&site.origin===value;}),hasCrossSiteAncestor:z.boolean()}).strict();
export const browserImportCookieSchema=z.object({
  name:z.string(),value:z.string(),domain:z.string().min(1),path:z.string().startsWith('/'),
  secure:z.boolean(),httpOnly:z.boolean(),hostOnly:z.boolean(),
  sameSite:z.enum(['unspecified','no_restriction','lax','strict']),
  expirationDate:z.number().finite().nullable(),partitionKey:partitionSchema.nullable(),
  priority:z.enum(['Low','Medium','High']).optional(),sourceScheme:z.enum(['Unset','NonSecure','Secure']).optional(),sourcePort:z.number().int().min(-1).max(65535).optional(),
}).strict().superRefine((cookie,context)=>{
  if(cookie.hostOnly===cookie.domain.startsWith('.'))context.addIssue({code:'custom',message:'Cookie domain/host-only mismatch'});
  if(cookie.sameSite==='no_restriction'&&!cookie.secure||cookie.name.startsWith('__Secure-')&&!cookie.secure||cookie.name.startsWith('__Host-')&&(!cookie.secure||!cookie.hostOnly||cookie.path!=='/'))context.addIssue({code:'custom',message:'Cookie security attributes invalid'});
});
export type BrowserImportCookie=z.infer<typeof browserImportCookieSchema>;
export function browserImportCookieIdentity(cookie:BrowserImportCookie):string{
  return JSON.stringify([cookie.name,cookie.domain,cookie.path,cookie.partitionKey?.topLevelSite??null,cookie.partitionKey?.hasCrossSiteAncestor??null]);
}
const changeSchema=z.object({before:browserImportCookieSchema.nullable(),after:browserImportCookieSchema.nullable()}).strict().superRefine((change,context)=>{
  if(!change.before&&!change.after)context.addIssue({code:'custom',message:'Empty cookie change'});
  if(change.before&&change.after&&browserImportCookieIdentity(change.before)!==browserImportCookieIdentity(change.after))context.addIssue({code:'custom',message:'Cookie identity changed'});
});
export const browserImportJournalSchema=z.object({
  schemaVersion:z.literal(1),transactionId:z.uuid(),profileId:browserProfileSchema.shape.id,
  createdAt:z.number().int().nonnegative(),phase:z.enum(['prepared','committed']).optional(),changes:z.array(changeSchema),
}).strict().superRefine((journal,context)=>{
  const seen=new Set<string>();
  for(const change of journal.changes){const cookie=change.before??change.after;if(!cookie)continue;const id=browserImportCookieIdentity(cookie);if(seen.has(id))context.addIssue({code:'custom',message:'Duplicate cookie identity'});seen.add(id);}
});
export type BrowserImportJournal=z.infer<typeof browserImportJournalSchema>;
const LIMIT=64*1024*1024;
/** Durable encrypted before/after data only. The import coordinator must own the
 * profile lock and unload/gate its pages before using this store and mutating
 * native cookies. This class alone does not implement or authorize an import. */
export class BrowserImportJournals {
  private readonly browserRoot:string;
  readonly directory:string;
  constructor(userData:string,private readonly cipher:SecretCipher){this.browserRoot=join(userData,'browser');this.directory=join(this.browserRoot,'import-journal');}
  private directories():void{
    for(const path of [this.browserRoot,this.directory]){mkdirSync(path,{recursive:true,mode:0o700});const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw new ApplicationError('BROWSER_UNAVAILABLE','登录态恢复目录不可用，原记录已保留');chmodSync(path,0o700);}
  }
  path(profileId:string):string{
    const parsed=browserProfileSchema.shape.id.safeParse(profileId);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','登录态标识无效');return join(this.directory,parsed.data+'.bin');
  }
  private available():void{if(!this.cipher.isAvailable())throw new ApplicationError('BROWSER_UNAVAILABLE','系统加密存储不可用，恢复记录暂时不可读写');}
  private exists(file:string):boolean{
    try{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new ApplicationError('BROWSER_UNAVAILABLE','登录态恢复文件类型无效，原记录已保留');return true;}
    catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return false;throw error;}
  }
  pending():string[]{
    this.directories();const ids:string[]=[];
    for(const name of readdirSync(this.directory)){if(!name.endsWith('.bin'))continue;const id=name.slice(0,-4);this.path(id);ids.push(id);}return ids.sort();
  }
  /** A user-confirmed clear must survive a crash even when the encrypted
   * rollback file cannot be decrypted. Only non-secret profile identity is
   * stored here. The marker is removed last, after data and rollback deletion. */
  private clearIntent(profileId:string):string|null{
    const file=this.path(profileId)+'.clear';if(!this.exists(file))return null;
    try{const value=z.object({schemaVersion:z.literal(1),profileId:browserProfileSchema.shape.id}).strict().parse(JSON.parse(readLimited(file,4096).toString('utf8')));if(value.profileId!==profileId)throw Error();return file;}
    catch{throw new ApplicationError('BROWSER_UNAVAILABLE','清空记录无法校验，原文件已保留');}
  }
  clearing():string[]{this.directories();return readdirSync(this.directory).filter(name=>name.endsWith('.bin.clear')).map(name=>{const id=name.slice(0,-10);this.clearIntent(id);return id;}).sort();}
  requestClear(profileId:string):void{
    this.directories();const file=this.path(profileId)+'.clear';
    if(this.clearIntent(profileId))return;
    atomicWrite(file,Buffer.from(JSON.stringify({schemaVersion:1,profileId})));
  }
  finishClear(profileId:string):void{
    this.directories();const log=this.path(profileId),marker=log+'.clear';
    if(!this.clearIntent(profileId))throw new ApplicationError('RESOURCE_STATE_CHANGED','缺少已确认的清空记录');
    if(this.exists(log))unlinkSync(log);
    // Persist rollback removal before deleting the durable clear intent.
    const sync=()=>{const fd=openSync(this.directory,constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}};
    sync();unlinkSync(marker);sync();
  }
  write(input:BrowserImportJournal):void{
    const parsed=browserImportJournalSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','登录态恢复变更集无效，未写入Cookie');
    this.available();this.directories();const file=this.path(parsed.data.profileId);
    if(this.exists(file))throw new ApplicationError('RESOURCE_BUSY','登录态仍有恢复日志，请先处理');
    const text=JSON.stringify(parsed.data);if(Buffer.byteLength(text)>LIMIT)throw new ApplicationError('TOO_LARGE','登录态恢复变更集超过64MiB，未写入Cookie');
    try{const bytes=this.cipher.encrypt(text);if(bytes.length>LIMIT)throw new ApplicationError('TOO_LARGE','加密恢复记录超过64MiB，未写入Cookie');atomicWrite(file,bytes);}
    catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('BROWSER_UNAVAILABLE','无法保存加密恢复日志，未写入Cookie');}
  }
  read(profileId:string):BrowserImportJournal|null{
    this.directories();const file=this.path(profileId);if(!this.exists(file))return null;this.available();
    try{
      const journal=browserImportJournalSchema.parse(JSON.parse(this.cipher.decrypt(readLimited(file,Math.min(LIMIT,lstatSync(file).size)))));
      if(journal.profileId!==profileId)throw Error('Profile binding mismatch');return journal;
    }catch{throw new ApplicationError('BROWSER_UNAVAILABLE','登录态恢复日志无法解密或校验，原文件已保留');}
  }
  /** Mark complete only after every native write and flush. A crash during
   * final file cleanup then cannot resurrect a prepared rollback transaction. */
  commit(profileId:string,transactionId:string):void{
    const current=this.read(profileId);if(!current||current.transactionId!==transactionId)throw new ApplicationError('RESOURCE_STATE_CHANGED','登录态恢复记录已变化');if(current.phase==='committed')return;
    const next:BrowserImportJournal={...current,phase:'committed'},text=JSON.stringify(next);this.available();
    if(Buffer.byteLength(text)>LIMIT)throw new ApplicationError('TOO_LARGE','登录态完成记录超过64MiB');
    try{const bytes=this.cipher.encrypt(text);if(bytes.length>LIMIT)throw new ApplicationError('TOO_LARGE','加密完成记录超过64MiB');atomicWrite(this.path(profileId),bytes,()=>{if(this.read(profileId)?.transactionId!==transactionId)throw new ApplicationError('RESOURCE_STATE_CHANGED','登录态恢复记录已变化');});}
    catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('BROWSER_UNAVAILABLE','无法保存登录态完成状态，请先重试处理');}
  }
  remove(profileId:string,transactionId:string):void{
    const journal=this.read(profileId);if(!journal)return;
    if(journal.transactionId!==transactionId)throw new ApplicationError('RESOURCE_STATE_CHANGED','登录态恢复记录已变化，未删除');
    unlinkSync(this.path(profileId));const fd=openSync(this.directory,constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}
  }
}
