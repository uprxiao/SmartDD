import type { FileCheckpointReceipt,FileDocument } from '@shared/files';
import type { PptxAction,PptxEditState,PptxOpenResult,PptxPending } from '@shared/file-pptx';
import { pptxPendingInputs,pptxPendingKey } from '@shared/file-pptx';
import { OFFICE_LIMITS } from '@shared/file-office';
import { parsePptxChartValues } from '@shared/file-pptx-chart';
import { rpc } from '@renderer/lib/ipc';
import type { OfficeFidelityFailure } from '@shared/file-office-fidelity';
import type { FileBuffer } from '../file-buffer';

const message=(error:unknown)=>(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/,'').replace(/^\[[A-Z_]+\]\s*/,'');
export type PptxTextTarget=Pick<PptxPending,'slideId'|'elementId'|'cell'|'chartValues'>;
interface View extends PptxTextTarget {zoom:number}
interface ViewHistory {before:View;after:View}

/** A document owner, independent of PDF view mounts. Input under composition
 * stay in recovery; failed saves freeze automatic retries until explicit save. */
export class PptxBuffer {
  fidelity:OfficeFidelityFailure|undefined;
  copyingLossy=false;
  copyNotice='';
  id:string|null=null;
  result:PptxOpenResult|null=null;
  private inputs=new Map<string,PptxPending>();
  get pending():PptxPending|null{return [...this.inputs.values()].at(-1)??null;}
  get pendingInputs():readonly PptxPending[]{return [...this.inputs.values()];}
  pendingFor(slideId:string,elementId?:string,cell?:PptxTextTarget['cell'],chartValues?:true){return this.inputs.get(pptxPendingKey({slideId,elementId,cell,chartValues}));}
  selection:PptxTextTarget|null=null;
  elementEditing:PptxTextTarget|null=null;
  disk:FileDocument|null=null;
  busy=false;saving=false;composing=false;editing=false;flushingInput=false;
  // A pointer click follows blur. Let that click enter the serialized action
  // queue while the previous input is flushing, instead of disabling its target.
  get controlsBusy(){return this.busy&&!this.flushingInput;}
  viewRevision=0;
  selectionRevision=0;
  private undoViews:ViewHistory[]=[];
  private redoViews:ViewHistory[]=[];
  private closed=false;
  private autosavePaused=false;
  private loading:Promise<void>|null=null;
  private openError='';
  private queue:Promise<unknown>=Promise.resolve();
  private refreshing:Promise<void>|null=null;
  private refreshRequested=false;
  private checkpointTimer?:ReturnType<typeof setTimeout>;
  private saveTimer?:ReturnType<typeof setTimeout>;
  private durable?:FileCheckpointReceipt;
  private durableVersion=-1;
  private bufferVersion=0;
  private writeRequired=false;
  private autoSaveStopped=false;
  constructor(private readonly host:FileBuffer){}
  get dirty(){return Boolean(this.pending||this.result?.state.dirty||this.writeRequired);}
  get editable(){return Boolean(!this.closed&&!this.host.sourceUnavailable&&this.host.file.writable&&this.result&&!this.result.state.info.signed&&!this.result.state.protected);}
  private notify(){if(!this.closed)this.host.notify();}
  private assert(){if(this.closed||!this.id||!this.result)throw new Error('演示文稿尚未就绪或已关闭');}
  async load():Promise<void>{
    if(this.loading)return this.loading;if(this.result)return;
    const id=this.id=crypto.randomUUID();this.host.loadState='loading';this.host.loadError=this.openError='';this.notify();
    this.loading=(async()=>{
      try{
        const result=await rpc.files.openPptx({id,ref:this.host.file.ref,baseHash:this.host.baseHash});if(this.closed||this.id!==id)return;
        this.result=result;this.host.pdfPosition.page=Math.max(1,Math.min(this.host.pdfPosition.page,result.state.info.slides.length));this.viewRevision++;
        this.host.loadState='ready';this.host.draftOptions=await rpc.files.drafts(this.host.file.ref);
      }catch(error){if(!this.closed&&this.id===id){this.host.loadState='error';this.host.loadError=this.openError=message(error);}}
      finally{if(this.id===id){this.loading=null;this.notify();}}
    })();return this.loading;
  }
  private serialize<T>(operation:()=>Promise<T>):Promise<T>{
    const run=this.queue.catch(()=>undefined).then(async()=>{
      this.assert();this.busy=true;this.notify();try{return await operation();}finally{this.busy=false;this.notify();}
    });this.queue=run;return run;
  }
  private view():View{const slideId=this.result!.state.info.slides[this.host.pdfPosition.page-1]?.id??this.result!.state.info.slides[0].id;return {slideId,zoom:this.host.pdfPosition.zoom,...(this.selection?.slideId===slideId?{elementId:this.selection.elementId,...(this.selection.cell?{cell:this.selection.cell}:{})}:{})};}
  private selectView(view:View){
    const page=Math.max(0,this.result!.state.info.slides.findIndex(slide=>slide.id===view.slideId))+1;
    const element=view.elementId?this.result!.state.info.slides[page-1].elements?.find(element=>element.id===view.elementId):undefined;
    const cell=view.cell&&element?.table?.cells[view.cell.row]?.[view.cell.column]?view.cell:undefined;
    const next=element?{slideId:this.result!.state.info.slides[page-1].id,elementId:element.id,...(cell?{cell}:{})}:null;
    if(page!==this.host.pdfPosition.page||JSON.stringify(next)!==JSON.stringify(this.selection))this.selectionRevision++;
    if(page!==this.host.pdfPosition.page||view.zoom!==this.host.pdfPosition.zoom||JSON.stringify(next)!==JSON.stringify(this.selection)){this.host.pdfPosition.page=page;this.host.pdfPosition.zoom=view.zoom;this.selection=next;this.viewRevision++;}
  }
  private accept(state:PptxEditState){this.assert();if(this.fidelity&&this.fidelity.version!==state.version){this.fidelity=undefined;this.copyNotice='';}const view=this.view();this.result={...this.result!,state};this.selectView(view);this.notify();}
  private rememberView(version:number,before:View){
    if(this.result!.state.version===version)return;
    this.undoViews.push({before,after:this.view()});this.redoViews=[];
    if(this.undoViews.length>=OFFICE_LIMITS.historyEntries)this.undoViews.shift();
  }
  setNotes(slideId:string,text:string,original:string,originalVersion=this.result?.state.version){
    this.setText({slideId,text},original,originalVersion);
  }
  setElementText(slideId:string,elementId:string,text:string,original:string,originalVersion=this.result?.state.version){
    this.setText({slideId,elementId,text},original,originalVersion);
  }
  setTableText(slideId:string,elementId:string,cell:{row:number;column:number},text:string,original:string,originalVersion=this.result?.state.version){
    this.setText({slideId,elementId,cell,text},original,originalVersion);
  }
  setChartValues(slideId:string,elementId:string,text:string,original:string,originalVersion=this.result?.state.version){
    this.setText({slideId,elementId,chartValues:true,text},original,originalVersion);
  }
  beginChartValues(slideId:string,elementId:string):boolean{
    if(!this.editable||this.closed||this.composing)return false;
    const chart=this.result?.state.info.slides.find(slide=>slide.id===slideId)?.elements?.find(element=>element.id===elementId)?.chart;
    if(!chart?.editableValues)return false;
    this.elementEditing={slideId,elementId,chartValues:true};this.selectElement(slideId,elementId);this.schedule();return true;
  }
  private setText(input:PptxPending,original:string,originalVersion?:number){
    if(!this.editable||this.closed)return;
    // A reverting keystroke during a pending RPC is still a new edit. The old
    // response must not erase it just because it matched the old baseline.
    this.fidelity=undefined;this.copyNotice='';
    const key=pptxPendingKey(input);
    if(!this.busy&&input.text===original&&originalVersion===this.result?.state.version)this.inputs.delete(key);
    else this.inputs.set(key,input);
    this.bufferVersion++;if(!this.autoSaveStopped)this.host.saveError='';this.schedule();this.notify();
  }
  selectElement(slideId:string,elementId?:string){this.selectView({slideId,elementId,zoom:this.host.pdfPosition.zoom});this.notify();}
  selectTableCell(slideId:string,elementId:string,cell:{row:number;column:number}){this.selectView({slideId,elementId,cell,zoom:this.host.pdfPosition.zoom});this.notify();}
  beginTableText(slideId:string,elementId:string,cell:{row:number;column:number}):boolean{
    if(!this.editable||this.closed||this.composing)return false;
    const entry=this.result?.state.info.slides.find(slide=>slide.id===slideId)?.elements?.find(element=>element.id===elementId)?.table?.cells[cell.row]?.[cell.column];
    if(!entry||entry.horizontalMerge||entry.verticalMerge)return false;
    this.elementEditing={slideId,elementId,cell};this.selectTableCell(slideId,elementId,cell);this.schedule();return true;
  }
  beginElementText(slideId:string,elementId:string):boolean{
    if(!this.editable||this.closed||this.composing)return false;
    const element=this.result?.state.info.slides.find(slide=>slide.id===slideId)?.elements?.find(element=>element.id===elementId);
    if(element?.text===undefined)return false;
    this.elementEditing={slideId,elementId};this.selectElement(slideId,elementId);this.schedule();return true;
  }
  async finishElementText(target:PptxTextTarget):Promise<boolean>{
    if(!await this.flush(target))return false;
    if(this.elementEditing&&pptxPendingKey(this.elementEditing)===pptxPendingKey(target))this.elementEditing=null;
    this.schedule();this.notify();return true;
  }
  async finishInput():Promise<boolean>{
    if(!await this.flush())return false;
    this.elementEditing=null;this.schedule();this.notify();return true;
  }
  cancelElementText():boolean{
    if(!this.elementEditing||this.composing)return false;
    this.inputs.delete(pptxPendingKey(this.elementEditing));this.elementEditing=null;this.bufferVersion++;this.schedule();this.notify();return true;
  }
  setComposing(value:boolean){this.composing=value;if(!value)this.schedule();this.notify();}
  private schedule(){
    clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer);if(this.closed||this.autosavePaused)return;
    this.checkpointTimer=setTimeout(()=>{void this.checkpoint().catch(()=>undefined);},500);
    if(this.dirty&&!this.host.sourceUnavailable&&!this.host.conflict&&!this.autoSaveStopped&&!this.composing&&!this.elementEditing)this.saveTimer=setTimeout(()=>{void this.save(true);},500);
  }
  private async flushInternal(target?:PptxTextTarget):Promise<boolean>{
    if(this.composing||!this.editable)return false;
    const entries=[...this.inputs.values()].filter(input=>!target||pptxPendingKey(target)===pptxPendingKey(input));
    this.flushingInput=entries.length>0;this.notify();
    try{
      if(entries.length)await this.checkpointInternal();
      for(const input of entries){
        if(this.composing||!this.editable)return false;
        const key=pptxPendingKey(input);if(this.inputs.get(key)!==input)continue;
        const version=this.result!.state.version,before=this.view();
        const action:PptxAction=input.chartValues&&input.elementId?{type:'chart-values',slideId:input.slideId,elementId:input.elementId,values:parsePptxChartValues(input.text)}:input.cell&&input.elementId?{type:'table-cell',slideId:input.slideId,elementId:input.elementId,...input.cell,text:input.text}:input.elementId?{type:'element-text',slideId:input.slideId,elementId:input.elementId,text:input.text}:{type:'notes',slideId:input.slideId,text:input.text};
        this.accept(await rpc.files.editPptx({id:this.id!,version,action}));this.rememberView(version,before);
        if(this.inputs.get(key)===input)this.inputs.delete(key);this.bufferVersion++;this.schedule();
      }
      return target?!this.inputs.has(pptxPendingKey(target)):!this.inputs.size;
    }finally{this.flushingInput=false;this.notify();}
  }
  async flush(target?:PptxTextTarget):Promise<boolean>{
    try{return await this.serialize(()=>this.flushInternal(target));}
    catch(error){this.autoSaveStopped=true;this.host.saveError=message(error);this.schedule();this.notify();return false;}
  }
  async action(action:PptxAction,expected?:{id:string;version:number}):Promise<boolean>{
    if(!this.editable||this.closed)return false;
    try{return await this.serialize(async()=>{
      if(!this.editable)return false;
      if(expected&&(this.id!==expected.id||this.result!.state.version!==expected.version))throw new Error('选图期间文档已改变，请重新选择图片');
      if(!await this.flushInternal()||!this.editable)return false;
      const version=this.result!.state.version,before=this.view(),ids=new Set(this.result!.state.info.slides.map(slide=>slide.id));if(!this.autoSaveStopped)this.host.saveError='';
      this.accept(await rpc.files.editPptx({id:this.id!,version,action}));
      if(action.type==='add'){const added=this.result!.state.info.slides.find(slide=>!ids.has(slide.id));if(added)this.selectView({...before,slideId:added.id,elementId:undefined});}
      if(action.type==='insert-element'||action.type==='image-insert'||action.type==='image-placeholder'||action.type==='chart-insert'){
        const added=this.result!.state.info.slides.find(slide=>slide.id===action.slideId)?.elements?.at(-1);
        if(added)this.selectView({...before,slideId:action.slideId,elementId:added.id,cell:undefined});
      }
      this.elementEditing=null;
      this.rememberView(version,before);this.bufferVersion++;this.schedule();return true;
    });}catch(error){this.host.saveError=message(error);this.notify();return false;}
  }
  async history(direction:'undo'|'redo'):Promise<void>{
    if(!this.editable||this.closed)return;
    try{await this.serialize(async()=>{
      if(!await this.flushInternal()||!this.editable)return;
      const version=this.result!.state.version;this.elementEditing=null;this.accept(await rpc.files.pptxHistory({id:this.id!,version,direction}));
      if(this.result!.state.version!==version){
        const from=direction==='undo'?this.undoViews:this.redoViews,to=direction==='undo'?this.redoViews:this.undoViews,entry=from.pop();
        if(entry){to.push(entry);this.selectView(direction==='undo'?entry.before:entry.after);}
      }
      if(!this.result!.state.canUndo)this.undoViews=[];if(!this.result!.state.canRedo)this.redoViews=[];
      this.bufferVersion++;this.schedule();
    });}catch(error){this.host.saveError=message(error);this.notify();}
  }
  private async checkpointInternal():Promise<FileCheckpointReceipt|null>{
    if(!this.dirty){await this.discardInternal();return null;}
    if(this.durableVersion===this.bufferVersion){await this.host.ensureRecoveryRoute();this.host.draftError='';return this.durable??null;}
    const version=this.bufferVersion,inputs=[...this.inputs.values()].map(input=>({...input})),receipt=await rpc.files.checkpointPptx({id:this.id!,version:this.result!.state.version,draftId:this.host.draftId,bufferVersion:version,...(inputs.length?{pending:inputs.length===1?inputs[0]:inputs}:{})});
    this.assert();this.durable=receipt;this.durableVersion=version;await this.host.ensureRecoveryRoute();this.host.draftError='';return receipt;
  }
  async checkpoint():Promise<FileCheckpointReceipt|null>{
    try{return await this.serialize(()=>this.checkpointInternal());}
    catch(error){if(!this.closed){this.host.draftError=message(error);this.notify();}throw error;}
  }
  get canCopyLossy():boolean{return Boolean(!this.closed&&this.fidelity&&this.fidelity.version===this.result?.state.version&&!this.pending&&!this.busy&&!this.saving&&!this.copyingLossy&&!this.host.conflict);}
  async saveLossyCopy():Promise<void>{
    const id=this.id,failure=this.fidelity;if(!id||!failure||!this.canCopyLossy)return;
    this.copyingLossy=true;this.copyNotice='';this.notify();
    try{const receipt=await rpc.files.saveOfficeLossyCopy({kind:'pptx',id,token:failure.token});this.assert();
      this.copyNotice=receipt.state==='saved'?'已另存有损副本；原件未保存，草稿仍保留。':'已取消另存；原件与草稿仍保留。';
    }catch(error){if(!this.closed)this.host.saveError=`有损副本未保存：${message(error)}`;}
    finally{this.copyingLossy=false;this.notify();}
  }
  async save(automatic=false):Promise<boolean>{
    if(this.closed)return false;if(!this.dirty)return true;if(!this.editable||this.host.conflict)return false;
    if(automatic&&(this.autoSaveStopped||this.elementEditing))return false;
    clearTimeout(this.saveTimer);clearTimeout(this.checkpointTimer);if(!automatic)this.autoSaveStopped=false;
    try{return await this.serialize(async()=>{
      if(!this.editable)return false;
      if(automatic&&(this.autoSaveStopped||this.elementEditing))return false;
      if(this.pending)await this.checkpointInternal();
      if(!await this.flushInternal())return false;
      if(!this.dirty){await this.discardInternal();return true;}
      this.saving=true;this.host.saveError='';this.notify();await this.checkpointInternal();
      if(this.pending||this.host.conflict||!this.editable)return false;
      const version=this.bufferVersion,result=await rpc.files.savePptx({id:this.id!,version:this.result!.state.version,draftId:this.host.draftId,bufferVersion:version,opId:crypto.randomUUID()});
      this.accept(result.state);if(result.checkpoint){this.durable=result.checkpoint;this.durableVersion=version;}this.fidelity=result.fidelity;this.copyNotice='';this.host.saveReceipt=result.receipt;this.host.draftError=result.draftError??'';
      if(result.receipt.state!=='saved'||!result.receipt.revision){
        this.autoSaveStopped=true;this.host.saveError=result.receipt.message??'演示文稿保存失败，修改仍保留';
        if(result.receipt.state==='conflict')await this.refreshDisk();return false;
      }
      const revision=result.receipt.revision;this.host.file={...this.host.file,revision,documentKey:`local:${revision.device}:${revision.inode}`};this.host.baseHash=revision.hash;this.writeRequired=false;
      if(!result.draftError){this.durable=undefined;this.durableVersion=-1;}
      return !this.dirty;
    });}catch(error){if(!this.closed){this.autoSaveStopped=true;this.host.saveError=message(error);}return false;}
    finally{this.saving=false;if(this.dirty)this.schedule();this.notify();}
  }
  private async refreshDisk(){try{this.disk=await rpc.files.refresh(this.host.file.ref);}catch(error){this.host.loadError=message(error);}}
  private async drain():Promise<void>{
    let queued:Promise<unknown>;
    do{queued=this.queue;await queued.catch(()=>undefined);}while(!this.closed&&queued!==this.queue);
  }
  refresh():Promise<void>{
    if(this.closed)return Promise.resolve();this.refreshRequested=true;if(this.refreshing)return this.refreshing;
    const run=async()=>{
      while(this.refreshRequested&&!this.closed){
        this.refreshRequested=false;const id=this.id,version=this.bufferVersion,baseHash=this.host.baseHash;
        try{
          // A watch may be the only notification of a permission/content change.
          // Drain the accepted queue instead of dropping it while a draft saves.
          await this.drain();if(this.closed)return;
          if(id!==this.id||baseHash!==this.host.baseHash){this.refreshRequested=true;continue;}
          const file=await rpc.files.refresh(this.host.file.ref);await this.drain();if(this.closed)return;
          if(id!==this.id||baseHash!==this.host.baseHash){this.refreshRequested=true;continue;}
          if(file.revision.hash===baseHash){this.host.file=file;this.host.loadError=this.openError;this.notify();continue;}
          if(this.dirty||this.disk||this.host.recoveryBlocked||version!==this.bufferVersion){this.disk=file;this.host.saveError='磁盘内容已改变，本地修改仍保留';clearTimeout(this.saveTimer);this.notify();}
          else{this.host.file=file;this.host.baseHash=file.revision.hash;await this.reload();}
        }catch(error){if(!this.closed){if(id!==this.id||baseHash!==this.host.baseHash){this.refreshRequested=true;continue;}this.host.loadError=message(error);this.notify();}}
      }
    };
    this.refreshing=run().finally(()=>{this.refreshing=null;if(this.refreshRequested&&!this.closed)return this.refresh();});return this.refreshing;
  }
  async keepLocal():Promise<boolean>{
    if(this.host.recoveryBlocked||this.closed||this.busy)return false;
    try{
      const file=await this.serialize(()=>rpc.files.rebasePptx({id:this.id!,version:this.result!.state.version}));
      this.host.file=file;this.host.baseHash=file.revision.hash;this.disk=null;this.host.saveReceipt=null;this.writeRequired=true;this.bufferVersion++;return await this.save();
    }catch(error){this.host.saveError=message(error);this.notify();return false;}
  }
  async useDisk():Promise<boolean>{
    if(this.closed||this.busy||this.host.sourceUnavailable)return false;
    const version=this.bufferVersion,id=this.id;
    const current=()=>!this.closed&&!this.host.sourceUnavailable&&version===this.bufferVersion&&id===this.id;
    try{
      const file=await rpc.files.refresh(this.host.file.ref);if(!current())return false;
      await this.discardDraft();if(!current())return false;
      this.host.file=file;this.host.baseHash=file.revision.hash;this.host.saveReceipt=null;this.host.saveError='';this.inputs.clear();this.elementEditing=null;this.selection=null;this.writeRequired=false;this.disk=null;this.result=null;await this.reload();return this.host.loadState==='ready';
    }catch(error){this.host.loadError=message(error);this.notify();return false;}
  }
  async restoreDraft(draftId:string):Promise<void>{
    await this.serialize(async()=>{
      const version=this.result!.state.version,before=this.view();
      const result=await rpc.files.restorePptx({id:this.id!,version,draftId});this.accept(result.state);
      this.host.draftId=draftId;this.inputs=new Map(pptxPendingInputs(result.pending).map(input=>[pptxPendingKey(input),input]));this.bufferVersion=Math.max(this.bufferVersion,result.bufferVersion)+1;
      this.durable={draftId,bufferVersion:result.bufferVersion,hash:result.hash};this.durableVersion=result.bufferVersion;this.host.draftOptions=[];
      if(result.baseHash!==this.host.file.revision.hash){await this.refreshDisk();this.host.saveError='草稿基线与当前磁盘不同，请选择保留的版本';}
      this.host.baseHash=result.baseHash;this.editing=true;
      if(this.pending){const {slideId,elementId,cell,chartValues}=this.pending,target={slideId,elementId,...(cell?{cell}:{}),...(chartValues?{chartValues}:{})};this.selectView({...before,...target,cell});if(elementId)this.elementEditing=target;}
      this.rememberView(version,before);
      this.schedule();this.notify();
    });
  }
  private async discardInternal():Promise<void>{
    if(!this.durable)return;const result=await rpc.files.resolveDraft({ref:this.host.file.ref,...this.durable,action:'discard'});
    if(!result.resolved)throw new Error('草稿已有更新，未放弃新版本');this.durable=undefined;this.durableVersion=-1;
  }
  discardDraft(){clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer);return this.serialize(()=>this.discardInternal());}
  async prepareClose(action:'save'|'discard'):Promise<boolean>{
    try{if(action==='discard'){await this.discardDraft();return true;}return await this.save()&&!this.dirty&&!this.host.recoveryBlocked;}
    finally{clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer);}
  }
  async reload():Promise<void>{
    if(this.dirty)return;const id=this.id;this.id=null;if(id)void rpc.files.closePptx(id).catch(()=>undefined);
    this.result=null;this.loading=null;this.autoSaveStopped=false;this.undoViews=[];this.redoViews=[];this.selection=null;this.elementEditing=null;await this.load();
  }
  invalidateSource(){clearTimeout(this.saveTimer);}
  pauseAutosave(){this.autosavePaused=true;clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer);}
  resumeAutosave(){if(!this.closed){this.autosavePaused=false;this.schedule();}}
  close(){this.closed=true;clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer);if(this.id)void rpc.files.closePptx(this.id).catch(()=>undefined);}
}
