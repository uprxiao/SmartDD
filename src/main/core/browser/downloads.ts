// Destination reservation follows Orca bd9455b6165 (MIT); WillYou owns the
// task/profile lifecycle and always selects the system Downloads destination.
import {existsSync} from 'node:fs';
import {join,resolve,basename,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Session,WebContents,DownloadItem} from 'electron';
import {shell} from 'electron';
import {ApplicationError} from '@shared/applications';
import {browserDownloadFilename,browserDownloadCandidate,type BrowserDownload} from '@shared/browser-downloads';
import {BrowserError} from './errors';
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
  explicit(path:string):{name:string;path:string;release:()=>void}{
    const key=this.key(path);if(this.reserved.has(key))throw new ApplicationError('RESOURCE_BUSY','此路径正在被另一条下载使用');this.reserved.add(key);let released=false;
    return{name:basename(path),path,release:()=>{if(!released){released=true;this.reserved.delete(key);}}};
  }
}
interface Owner {contents:WebContents;taskId:string;pageId:string;profileId:string}
interface Live {item:DownloadItem;detach:()=>void}
interface Expected {contents:WebContents;path:string;active:boolean;recordId?:string;complete:(record:BrowserDownload)=>void;fail:(error:unknown)=>void}
export class BrowserDownloads {
  private readonly owners=new Map<WebContents,Owner>();
  private readonly detachOwners=new Map<WebContents,()=>void>();
  private readonly sessions=new Map<Session,(event:Electron.Event,item:DownloadItem,contents:WebContents)=>void>();
  private readonly records=new Map<string,BrowserDownload>();
  private readonly live=new Map<string,Live>();
  private readonly expected=new Map<WebContents,Expected>();
  private readonly expectations=new Set<Expected>();
  private closed=false;
  private readonly destinations:BrowserDownloadReservations;
  constructor(private readonly options:{directory:()=>string;available:(profileId:string,taskId:string)=>boolean;changed?:(taskId:string)=>void}){this.destinations=new BrowserDownloadReservations(options.directory);}
  private changed(record:BrowserDownload){record.updatedAt=Date.now();if(!this.closed)this.options.changed?.(record.taskId);}
  install(owner:Owner):void{
    const existing=this.owners.get(owner.contents);if(existing){if(existing.taskId!==owner.taskId||existing.pageId!==owner.pageId||existing.profileId!==owner.profileId)throw Error('Download owner changed');return;}
    this.owners.set(owner.contents,owner);const destroyed=()=>{this.owners.delete(owner.contents);this.detachOwners.delete(owner.contents);for(const expected of this.expectations)if(expected.contents===owner.contents)expected.fail(new BrowserError('BROWSER_TAB_CLOSED','下载期间网页已关闭'));};owner.contents.once('destroyed',destroyed);this.detachOwners.set(owner.contents,()=>owner.contents.off('destroyed',destroyed));
    const session=owner.contents.session;if(this.sessions.has(session))return;
    const listener=(event:Electron.Event,item:DownloadItem,contents:WebContents)=>{
      const source=this.owners.get(contents);let available=false;try{available=!!source&&!source.contents.isDestroyed()&&this.options.available(source.profileId,source.taskId);}catch{/* Deny unavailable profiles. */}
      if(this.closed||!source||!available){event.preventDefault();this.expected.get(contents)?.fail(new BrowserError('BROWSER_UNAVAILABLE','下载来源页面或登录态不可用'));return;}
      const safe=<T>(read:()=>T,fallback:T):T=>{try{return read();}catch{return fallback;}};
      const pending=this.expected.get(contents),expected=pending?.active?pending:undefined;if(expected)this.expected.delete(contents);
      const id=randomUUID(),record:BrowserDownload={id,taskId:source.taskId,pageId:source.pageId,name:browserDownloadFilename(safe(()=>item.getFilename(),'download')),path:null,destination:expected?'explicit':'downloads',url:safe(()=>item.getURL(),''),state:'progress',receivedBytes:0,totalBytes:Math.max(0,safe(()=>item.getTotalBytes(),0)),updatedAt:Date.now(),error:null};this.records.set(id,record);if(expected)expected.recordId=id;
      let release=()=>{};
      try{const reservation=expected?this.destinations.explicit(expected.path):this.destinations.reserve(record.name);release=reservation.release;record.name=reservation.name;record.path=reservation.path;
        // Electron permits this only synchronously inside will-download. Do not
        // await filesystem work and accidentally open a native Save dialog.
        item.setSavePath(reservation.path);
      }catch(error){release();event.preventDefault();record.state='failed';record.error=error instanceof Error?error.message:String(error);this.changed(record);expected?.fail(error);return;}
      let finished=false;
      const readProgress=()=>{record.receivedBytes=safe(()=>item.getReceivedBytes(),record.receivedBytes);record.totalBytes=Math.max(0,safe(()=>item.getTotalBytes(),record.totalBytes));};
      const finish=(state:string,cancelNative=false)=>{
        if(finished)return;finished=true;readProgress();record.state=state==='completed'?'done':state==='cancelled'?'cancelled':'failed';record.error=state==='interrupted'?'下载连接被中断':null;record.path=safe(()=>item.getSavePath(),record.path??'')||record.path;
        item.off('updated',updated);item.off('done',done);release();this.live.delete(id);
        // Detach before cancellation: native done(cancelled) must not overwrite
        // the interruption failure or cancel an explicit expectation twice.
        if(cancelNative)try{item.cancel();}catch{/* The failed record remains usable. */}
        this.changed(record);if(record.state==='done')expected?.complete(record);else expected?.fail(new BrowserError('BROWSER_ERROR',record.state==='cancelled'?'下载已取消':'下载连接被中断'));
      };
      const updated=(_event:Electron.Event,state:string)=>{
        readProgress();this.changed(record);
        // Like Orca's download manager, defer native cancellation until outside
        // updated; resumable interruptions never emit terminal done by themselves.
        if(state==='interrupted')setImmediate(()=>{if(!finished&&!this.closed&&this.live.get(id)?.item===item&&safe(()=>item.getState()==='interrupted'&&item.canResume(),false))finish('interrupted',true);});
      };
      const done=(_event:Electron.Event,state:string)=>finish(state);
      item.on('updated',updated);item.once('done',done);this.live.set(id,{item,detach:()=>{item.off('updated',updated);item.off('done',done);release();}});this.changed(record);
    };
    session.on('will-download',listener);this.sessions.set(session,listener);
  }
  snapshot(taskId:string):BrowserDownload[]{return[...this.records.values()].filter(record=>record.taskId===taskId).reverse().map(record=>({...record}));}
  /** Arm before a guarded click; start only at its actual dispatch. The first
   * native event from this page consumes the override, never later downloads. */
  expect(contents:WebContents,path:string,signal:AbortSignal):{result:Promise<BrowserDownload>;start:()=>void;claimed:()=>boolean;cancel:(error:unknown)=>void}{
    if(this.closed||!this.owners.has(contents)||contents.isDestroyed())throw new BrowserError('BROWSER_TAB_CLOSED','网页已关闭');
    if(!isAbsolute(path)||path.includes('\0')||!basename(path))throw new ApplicationError('INVALID_INPUT','下载保存路径无效');
    if(this.expected.has(contents))throw new ApplicationError('RESOURCE_BUSY','本页已有下载正在等待触发');
    let accept!:(value:BrowserDownload)=>void,reject!:(error:unknown)=>void,settled=false;
    const result=new Promise<BrowserDownload>((yes,no)=>{accept=yes;reject=no;});void result.catch(()=>{});
    const finish=(error:unknown,record?:BrowserDownload)=>{
      if(settled)return;settled=true;if(this.expected.get(contents)===entry)this.expected.delete(contents);this.expectations.delete(entry);signal.removeEventListener('abort',aborted);
      if(record)accept({...record});else{const item=entry.recordId?this.live.get(entry.recordId)?.item:undefined;try{item?.cancel();}catch{/* Preserve the original operation failure. */}reject(error);}
    };
    const entry:Expected={contents,path,active:false,complete:record=>finish(null,record),fail:error=>finish(error)};
    const aborted=()=>entry.fail(signal.reason??new ApplicationError('CANCELED','下载操作已取消'));
    this.expected.set(contents,entry);this.expectations.add(entry);signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
    return{result,start:()=>{if(settled)throw signal.reason??new ApplicationError('CANCELED','下载操作已取消');entry.active=true;},claimed:()=>entry.recordId!==undefined,cancel:error=>entry.fail(error)};
  }
  async action(taskId:string,id:string,action:'cancel'|'open'|'reveal'|'remove'):Promise<void>{
    const record=this.records.get(id);if(!record||record.taskId!==taskId)throw new ApplicationError('SCOPE_DENIED','没有此任务的下载记录');
    if(action==='cancel'){this.live.get(id)?.item.cancel();return;}
    if(action==='remove'){if(this.live.has(id))throw new ApplicationError('RESOURCE_BUSY','请先取消正在进行的下载');this.records.delete(id);this.changed(record);return;}
    if(record.state!=='done'||!record.path)throw new ApplicationError('RESOURCE_STATE_CHANGED','下载尚未完成');
    if(action==='reveal')shell.showItemInFolder(record.path);else{const error=await shell.openPath(record.path);if(error)throw new ApplicationError('BROWSER_ERROR',error);}
  }
  dispose():void{this.closed=true;for(const expected of this.expectations)expected.fail(new BrowserError('BROWSER_UNAVAILABLE','浏览器服务已关闭'));for(const{item,detach}of this.live.values()){try{item.cancel();}catch{/* A native item may already be complete. */}detach();}for(const[session,listener]of this.sessions)session.off('will-download',listener);for(const[contents,detach]of this.detachOwners)if(!contents.isDestroyed())detach();this.live.clear();this.sessions.clear();this.owners.clear();this.detachOwners.clear();this.expected.clear();}
}
