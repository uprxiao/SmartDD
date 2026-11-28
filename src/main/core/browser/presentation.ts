import {getMainShellIdentity} from '@main/app/window-host';
export type PresentationStatus='shown'|'superseded'|'unavailable';
type Intent={taskId:string;pageId:string;operationId:string;clientInputId:string};
type Pending={intent:Intent;host:number;document:number;timer:ReturnType<typeof setTimeout>;resolve:(result:PresentationStatus)=>void};
/** Internal acknowledgement only: the trusted renderer must select the intended
 * tab. This does not grant browser authority or replace navigation completion. */
export class BrowserPresentationRequests {
  private readonly pending=new Map<string,Pending>();
  request(intent:Intent,emit:()=>void):Promise<PresentationStatus>{
    const identity=getMainShellIdentity();if(!identity)return Promise.resolve('unavailable');
    this.finish(intent.operationId,'superseded');
    return new Promise(resolve=>{
      const timer=setTimeout(()=>this.finish(intent.operationId,'unavailable'),2500);
      this.pending.set(intent.operationId,{intent,...identity,timer,resolve});
      try{emit();}catch{this.finish(intent.operationId,'unavailable');}
    });
  }
  acknowledge(intent:Intent,shown:boolean):void{
    const item=this.pending.get(intent.operationId),identity=getMainShellIdentity();
    if(!item||!identity||item.host!==identity.host||item.document!==identity.document||item.intent.taskId!==intent.taskId||item.intent.pageId!==intent.pageId||item.intent.clientInputId!==intent.clientInputId)return;
    this.finish(intent.operationId,shown?'shown':'superseded');
  }
  invalidate():void{for(const id of this.pending.keys())this.finish(id,'superseded');}
  private finish(id:string,status:PresentationStatus){const item=this.pending.get(id);if(!item)return;this.pending.delete(id);clearTimeout(item.timer);item.resolve(status);}
}
