// Destination reservation follows Orca bd9455b6165 (MIT); WillYou owns the
// task/profile lifecycle and always selects the system Downloads destination.
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Session,WebContents,DownloadItem} from 'electron';
import {shell} from 'electron';
import {ApplicationError} from '@shared/applications';
import {browserDownloadFilename,browserDownloadCandidate,type BrowserDownload} from '@shared/browser-downloads';
export class BrowserDownloadReservations {
  private readonly reserved=new Set<string>();
  constructor(private readonly directory:()=>string,private readonly exists:(path:string)=>boolean=existsSync){}
  private key(path:string){return resolve(path).normalize('NFC').toLocaleLowerCase('en-US');}
  reserve(raw:string):{name:string;path:string;release:()=>void}{
    const name=browserDownloadFilename(raw),directory=this.directory();
    for(let attempt=0;attempt<1000;attempt++){
      const candidate=browserDownloadCandidate(name,attempt),path=join(directory,candidate),key=this.key(path);
      if(this.reserved.has(key)||this.exists(path))continue;this.reserved.add(key);let released=false;
      return{name:candidate,path,release:()=>{if(!released){released=true;this.reserved.delete(key);}}};
    }
    throw new ApplicationError('RESOURCE_BUSY','无法在系统下载目录选择不重名的文件（已尝试1000次）');
  }
}
interface Owner {contents:WebContents;taskId:string;pageId:string;profileId:string}
interface Live {item:DownloadItem;detach:()=>void}
export class BrowserDownloads {
  private readonly owners=new Map<WebContents,Owner>();
  private readonly detachOwners=new Map<WebContents,()=>void>();
  private readonly sessions=new Map<Session,(event:Electron.Event,item:DownloadItem,contents:WebContents)=>void>();
  private readonly records=new Map<string,BrowserDownload>();
  private readonly live=new Map<string,Live>();
  private closed=false;
  private readonly destinations:BrowserDownloadReservations;
  constructor(private readonly options:{directory:()=>string;available:(profileId:string)=>boolean;changed?:(taskId:string)=>void}){this.destinations=new BrowserDownloadReservations(options.directory);}
  private changed(record:BrowserDownload){record.updatedAt=Date.now();if(!this.closed)this.options.changed?.(record.taskId);}
  install(owner:Owner):void{
    const existing=this.owners.get(owner.contents);if(existing){if(existing.taskId!==owner.taskId||existing.pageId!==owner.pageId||existing.profileId!==owner.profileId)throw Error('Download owner changed');return;}
    this.owners.set(owner.contents,owner);const destroyed=()=>{this.owners.delete(owner.contents);this.detachOwners.delete(owner.contents);};owner.contents.once('destroyed',destroyed);this.detachOwners.set(owner.contents,()=>owner.contents.off('destroyed',destroyed));
    const session=owner.contents.session;if(this.sessions.has(session))return;
    const listener=(event:Electron.Event,item:DownloadItem,contents:WebContents)=>{
      const source=this.owners.get(contents);let available=false;try{available=!!source&&!source.contents.isDestroyed()&&this.options.available(source.profileId);}catch{/* Deny unavailable profiles. */}
      if(this.closed||!source||!available){event.preventDefault();return;}
      const safe=<T>(read:()=>T,fallback:T):T=>{try{return read();}catch{return fallback;}};
      const id=randomUUID(),record:BrowserDownload={id,taskId:source.taskId,pageId:source.pageId,name:browserDownloadFilename(safe(()=>item.getFilename(),'download')),path:null,url:safe(()=>item.getURL(),''),state:'progress',receivedBytes:0,totalBytes:Math.max(0,safe(()=>item.getTotalBytes(),0)),updatedAt:Date.now(),error:null};this.records.set(id,record);
      let release=()=>{};
      try{const reservation=this.destinations.reserve(record.name);release=reservation.release;record.name=reservation.name;record.path=reservation.path;
        // Electron permits this only synchronously inside will-download. Do not
        // await filesystem work and accidentally open a native Save dialog.
        item.setSavePath(reservation.path);
      }catch(error){release();event.preventDefault();record.state='failed';record.error=error instanceof Error?error.message:String(error);this.changed(record);return;}
      const updated=()=>{record.receivedBytes=safe(()=>item.getReceivedBytes(),record.receivedBytes);record.totalBytes=Math.max(0,safe(()=>item.getTotalBytes(),record.totalBytes));this.changed(record);};
      const done=(_event:Electron.Event,state:string)=>{updated();record.state=state==='completed'?'done':state==='cancelled'?'cancelled':'failed';record.error=state==='interrupted'?'下载连接被中断':null;release();item.off('updated',updated);this.live.delete(id);this.changed(record);};
      item.on('updated',updated);item.once('done',done);this.live.set(id,{item,detach:()=>{item.off('updated',updated);item.off('done',done);release();}});this.changed(record);
    };
    session.on('will-download',listener);this.sessions.set(session,listener);
  }
  snapshot(taskId:string):BrowserDownload[]{return[...this.records.values()].filter(record=>record.taskId===taskId).reverse().map(record=>({...record}));}
  async action(taskId:string,id:string,action:'cancel'|'open'|'reveal'|'remove'):Promise<void>{
    const record=this.records.get(id);if(!record||record.taskId!==taskId)throw new ApplicationError('SCOPE_DENIED','没有此任务的下载记录');
    if(action==='cancel'){this.live.get(id)?.item.cancel();return;}
    if(action==='remove'){if(this.live.has(id))throw new ApplicationError('RESOURCE_BUSY','请先取消正在进行的下载');this.records.delete(id);this.changed(record);return;}
    if(record.state!=='done'||!record.path)throw new ApplicationError('RESOURCE_STATE_CHANGED','下载尚未完成');
    if(action==='reveal')shell.showItemInFolder(record.path);else{const error=await shell.openPath(record.path);if(error)throw new ApplicationError('BROWSER_ERROR',error);}
  }
  dispose():void{this.closed=true;for(const{item,detach}of this.live.values()){try{item.cancel();}catch{/* A native item may already be complete. */}detach();}for(const[session,listener]of this.sessions)session.off('will-download',listener);for(const[contents,detach]of this.detachOwners)if(!contents.isDestroyed())detach();this.live.clear();this.sessions.clear();this.owners.clear();this.detachOwners.clear();}
}
