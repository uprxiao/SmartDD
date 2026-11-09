import {randomUUID} from 'node:crypto';
import {extname} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {FileError,type FileApplications,type FileIdentity} from '@shared/files';
import type {AttachmentExportStore} from './attachment-export-store';
import type {NativeFileResult} from '../files/native-broker';

interface NativeApplication {path:string;identity:FileIdentity;name:string;bundleId:string;icon?:string;systemDefault:boolean}
type Saved=Awaited<ReturnType<AttachmentExportStore['saved']>>;
interface Grant {owner:string;projectId:string;operationId:string;expires:number;applications:Map<string,NativeApplication>}
/** Mirrors the existing FileActions native application grants; no renderer paths or shell commands. */
export class SavedAttachmentOpeners {
 private readonly grants=new Map<string,Grant>();private closed=false;
 constructor(private readonly exports:AttachmentExportStore,private readonly now=Date.now){}
 private async file(projectId:string,id:string){
  if(this.closed)throw new ApplicationError('CANCELED','附件打开服务已关闭');
  const saved=await this.exports.saved(projectId,id);
  const denied=/^\.(app|command|sh|bash|zsh|fish|ps1|bat|cmd|exe|com|msi|pkg|dmg|scpt|scptd|workflow|jar|js|mjs|cjs|py|rb|pl|desktop|webloc|url|lnk)$/i;
  if(denied.test(extname(saved.relativePath))||/^(application\/(x-executable|x-msdownload|x-mach-binary|x-sh|x-apple-diskimage)|(?:text|application)\/javascript)(?:;|$)/i.test(saved.view.contentType))throw new ApplicationError('CAPABILITY_UNAVAILABLE','可执行文件或安装器仅支持保存，不从附件入口运行');
  const current=await this.exports.broker.request<NativeFileResult>({operation:'stat',root:saved.root,relativePath:saved.relativePath,protected:saved.protected});
  if(current.revision.device!==saved.revision.device||current.revision.inode!==saved.revision.inode||current.revision.hash!==saved.view.contentHash||current.revision.size!==saved.view.size)throw new ApplicationError('RESOURCE_STATE_CHANGED','已保存副本已被替换或修改，请重新保存原附件后打开');
  const sample=Buffer.from(current.sampleBase64??'','base64'),magic=sample.subarray(0,4).toString('hex');
  if(saved.view.size>0&&!sample.length)throw new ApplicationError('RESOURCE_STATE_CHANGED','无法核对已保存副本的文件类型');
  if(sample.subarray(0,2).toString()==='#!'||sample.subarray(0,2).toString()==='MZ'||['7f454c46','feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca'].includes(magic))throw new ApplicationError('CAPABILITY_UNAVAILABLE','可执行内容仅支持保存，不从附件入口运行');
  return{...saved,revision:current.revision};
 }
 private request(saved:Saved,operation:string,extra:Record<string,unknown>={}){
  return this.exports.broker.request({operation,root:saved.root,relativePath:saved.relativePath,directory:false,expectedIdentity:{device:saved.revision.device,inode:saved.revision.inode},expectedRevision:saved.revision,protected:saved.protected,...extra});
 }
 async applications(owner:string,projectId:string,id:string,check:(saved:Saved)=>Promise<void>):Promise<FileApplications&{filename:string}>{
  const saved=await this.file(projectId,id);await check(saved);
  const found=await this.request(saved,'applications') as {applications:NativeApplication[]};await check(saved);
  for(const[key,grant]of this.grants)if(grant.expires<this.now())this.grants.delete(key);
  while(this.grants.size>=256)this.grants.delete(this.grants.keys().next().value!);
  const listId=randomUUID(),applications=new Map(found.applications.map(app=>[randomUUID(),app]));
  this.grants.set(listId,{owner,projectId,operationId:id,expires:this.now()+10*60_000,applications});
  return{id:listId,filename:saved.relativePath,apps:[...applications].map(([id,{name,bundleId,icon,systemDefault}])=>({id,name,bundleId,icon,systemDefault})),preferredId:[...applications].find(([,app])=>app.systemDefault)?.[0],preferredUnavailable:false};
 }
 async open(owner:string,projectId:string,input:{operationId:string;listId:string;appId:string},check:(saved:Saved)=>Promise<void>){
  const grant=this.grants.get(input.listId),application=grant?.applications.get(input.appId);
  if(this.closed||!grant||grant.owner!==owner||grant.projectId!==projectId||grant.operationId!==input.operationId||grant.expires<this.now()||!application)throw new ApplicationError('SCOPE_DENIED','打开方式列表已失效或不属于当前窗口／项目，请重新读取');
  const saved=await this.file(projectId,input.operationId);await check(saved);
  // Consume before the side effect. A lost response cannot silently replay it.
  this.grants.delete(input.listId);
  try{await this.request(saved,'open-external',{application});}
  catch(error){if(error instanceof FileError&&error.code==='CHANGED')throw new ApplicationError('RESOURCE_STATE_CHANGED','副本或所选应用已变化，请核对后重新选择');throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','系统打开结果未确认，请核对外部应用；不会自动重试');}
  return{state:'opened' as const,name:application.name,filename:saved.view.filename};
 }
 dispose(){this.closed=true;this.grants.clear();}
}
