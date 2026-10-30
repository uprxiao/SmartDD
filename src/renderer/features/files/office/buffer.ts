import { FileError,type FileCheckpointReceipt,type FileDocument,type FileRef } from '@shared/files';
import { OFFICE_LIMITS,type OfficeCellEdit, type OfficeOpenResult, type OfficeMutationResult, type OfficeSheetAction } from '@shared/file-office';
import type { OfficeRangeAction } from '@shared/file-office';
import { rpc } from '@renderer/lib/ipc';
import type { OfficeFidelityFailure } from '@shared/file-office-fidelity';
import type { FileBuffer } from '../file-buffer';
import { OfficeClient } from './client';
import { workbookHost, workbookSourceKey, workbookEditRequested, type WorkbookHostOptions, type WorkbookSourcePhase } from './workbook-host';
import type {WorkbookTextEdit} from '@shared/file-workbook-drawing';

const errorMessage = (error:unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/,'');
const errorText = (error:unknown) => errorMessage(error).replace(/^\[[A-Z_]+\]\s*/,'');
export interface OfficeView {sheetId:string;row:number;column:number;zoom:number;endRow?:number;endColumn?:number}
interface ViewHistory {before:OfficeView;after:OfficeView}
/** Owned by FileBuffer, never by the mounted grid. A pending formula is part of
 * dirty state and the durable recovery envelope, even if it is not valid yet. */
export class OfficeBuffer {
  fidelity:OfficeFidelityFailure|undefined;
  copyingLossy=false;
  copyNotice='';
  client:OfficeClient|null=null;
  result:OfficeOpenResult|null=null;
  pending:OfficeCellEdit|null=null;
  pendingDrawing:WorkbookTextEdit|null=null;
  disk:FileDocument|null=null;
  tick=0;
  busy=false;
  saving=false;
  composing=false;
  view:OfficeView={sheetId:'',row:0,column:0,zoom:100};
  viewRevision=0;
  private undoViews:ViewHistory[]=[];
  private redoViews:ViewHistory[]=[];
  private closed=false;
  private autosavePaused=false;
  private loading:Promise<void>|null=null;
  private reloading:object|null=null;
  private openError='';
  private queue:Promise<unknown>=Promise.resolve();
  private operations=0;
  private refreshing:Promise<void>|null=null;
  private refreshRequested=false;
  private checkpointTimer?:ReturnType<typeof setTimeout>;
  private saveTimer?:ReturnType<typeof setTimeout>;
  private durable?:FileCheckpointReceipt;
  private durableVersion=-1;
  private bufferVersion=0;
  private writeRequired=false;
  private autoSaveStopped=false;
  private hostOptions=workbookHost();
  private hostEpoch=0;
  private hostTransition=0;
  private hostChanging=false;
  private fileSource=false;
  private modelBaseHash='';
  private retained:{client:OfficeClient;result:OfficeOpenResult;baseHash:string;view:OfficeView}|null=null;
  private retiring=new Set<OfficeClient>();
  private failedHash='';
  private fallbackMessage='';
  private reconnectRefs=new Map<string,FileRef>();
  constructor(private readonly host:FileBuffer, options:WorkbookHostOptions = {}) { this.hostOptions=workbookHost(options); }
  /** Only a genuine FileBuffer calls this producer. Common hosts still default
   * to static/readonly and cannot obtain authority by omitting capabilities. */
  static forFile(host:FileBuffer):OfficeBuffer {
    const office=new OfficeBuffer(host);office.fileSource=true;office.filePhase('starting');return office;
  }
  private filePhase(phase:WorkbookSourcePhase,message=''):void {
    if(!this.fileSource)return;
    // Older writable:true metadata already proves !record.readOnly under the
    // main invariant. Ambiguous old readonly metadata grants no live writer.
    const file=this.host.file, local=file.sourceReadOnly===false || file.sourceReadOnly===undefined && file.writable;
    this.hostOptions=workbookHost({source:local?{kind:'artifactDocument',key:`${this.host.instance}:${file.ref.id}:${file.ref.lease}:${file.ref.generation}`,phase,...(phase==='live'&&this.client?{controller:this.client}:{}),message}:{kind:'static'},manualEditUiEnabled:true});
  }
  get sourceKind(){return this.hostOptions.source.kind;}
  private reloadPhase(phase:WorkbookSourcePhase,message=''):void {
    if(this.fileSource)this.filePhase(phase,message);
    else if(this.hostOptions.source.kind==='artifactDocument')this.hostOptions={...this.hostOptions,source:{...this.hostOptions.source,phase,controller:phase==='live'?this.client??undefined:undefined,message}};
  }
  get dirty() { return Boolean(this.pending || this.pendingDrawing || this.result?.state.dirty || this.writeRequired); }
  get hostRevision() { return this.hostEpoch; }
  get sourceChanging() { return this.hostChanging; }
  get sourceState() {
    if(this.host.sourceUnavailable)return 'blocked';
    if(this.fallbackMessage && !this.reloading)return 'fallback';
    const source=this.hostOptions.source;
    if(source.kind==='artifactDocument')return source.phase==='live' && (!this.result || source.controller!==this.client) ? 'starting' : source.phase;
    if(source.kind==='local' && this.reloading)return 'refreshing';
    return this.result ? source.kind==='local' ? 'live' : 'static' : 'starting';
  }
  get sourceMessage() { const source=this.hostOptions.source;return this.host.sourceUnavailable || this.fallbackMessage || (source.kind==='artifactDocument' ? source.message ?? '' : ''); }
  get editable() {
    const source=this.hostOptions.source;
    const requested=workbookEditRequested(this.hostOptions,source.kind==='artifactDocument' && source.controller===this.client);
    return Boolean(!this.closed && !this.host.sourceUnavailable && !this.hostChanging && !this.reloading && !this.fallbackMessage && requested && this.client && this.host.file.writable && this.result?.workbook.kind==='xlsx' && !this.result.workbook.signed);
  }
  get editingControls() { return this.editable && this.hostOptions.manualEditUiEnabled; }
  get artifactSearchEnabled() { return this.hostOptions.artifactSearchEnabled; }
  get canSearchArtifact() { return this.artifactSearchEnabled && !!this.hostOptions.onArtifactSearch && !!this.result && !this.hostChanging && this.sourceState!=='blocked' && this.sourceState!=='refreshing'; }
  /** Bind callbacks to a source generation. A retained editor/menu callback
   * cannot regain authority when another source later becomes live. */
  get writer() {
    const epoch=this.hostEpoch,current=()=>epoch===this.hostEpoch && this.editable;
    return {
      setPending:(...args:Parameters<OfficeBuffer['setPending']>)=>{if(current())this.setPending(...args);},
      cancelPending:()=>{if(current())this.cancelPending();},
      setDrawingText:(...args:Parameters<OfficeBuffer['setDrawingText']>)=>current()?this.setDrawingText(...args):false,
      cancelDrawingText:()=>{if(current())this.cancelDrawingText();},
      flush:()=>epoch===this.hostEpoch?this.flush():Promise.resolve(false),
      editCell:(edit:OfficeCellEdit)=>current()?this.editCell(edit):Promise.resolve(false),
      rangeAction:(action:OfficeRangeAction)=>current()?this.rangeAction(action):Promise.resolve(false),
      sheetAction:(action:OfficeSheetAction)=>current()?this.sheetAction(action):Promise.resolve(false),
      history:(direction:'undo'|'redo')=>current()?this.history(direction):Promise.resolve(),
      save:()=>current()?this.save():Promise.resolve(false),
      search:()=>{if(epoch===this.hostEpoch && this.canSearchArtifact)this.hostOptions.onArtifactSearch!();},
    };
  }
  async setWorkbookHost(options:WorkbookHostOptions = {}):Promise<boolean> {
    if(this.closed)return false;
    const next=workbookHost(options),source=next.source;
    const controllerOwned=()=>source.kind!=='artifactDocument' || !source.controller || source.controller instanceof OfficeClient && source.controller.owns(this.host.file.ref,source.controller===this.client?undefined:this.host.baseHash);
    if(!controllerOwned()) {
      this.host.saveError='工作簿控制器与当前文件或修订不匹配';this.notify();return false;
    }
    const transition=++this.hostTransition;this.hostEpoch++;this.hostChanging=true;
    clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer);this.notify();
    // Already-running work settles against its old owner before adoption. No
    // queued/retained writer can start after revocation. Loading is separately
    // invalidated by client identity so a held old ready never blocks replacement.
    await this.drain();
    if(this.closed || transition!==this.hostTransition)return false;
    if(!controllerOwned()) {this.hostChanging=false;this.host.saveError='工作簿来源已变化，未接入旧修订控制器';this.schedule();this.notify();return false;}
    const controller=source.kind==='artifactDocument' ? source.controller : undefined;
    // Existing local callers can adjust controls on the same ready file. The
    // internal producer's new kind must not turn that into a source replacement.
    const localControls=this.fileSource && source.kind==='local' && !!this.result && !this.loading && !this.reloading && !!this.client?.owns(this.host.file.ref);
    const replace=workbookSourceKey(source)!==workbookSourceKey(this.hostOptions.source) && !localControls || !!controller && controller!==this.client;
    if(replace && (this.dirty || this.host.conflict || this.host.recoveryBlocked)) {
      this.hostChanging=false;this.host.saveError='工作簿来源未切换：请先处理当前修改、冲突或恢复草稿';this.schedule();this.notify();return false;
    }
    // A new host key revokes its callbacks, but the same accepted controller
    // still owns the current model. Its initial ready snapshot may be older
    // than a clean undo, saved edit, or current history state.
    const sameReadyController=!!controller && controller===this.client && !!this.result && !this.loading && !this.reloading;
    if(replace && !sameReadyController) {
      this.retained?.client.close();this.retained=null;
      if(this.client!==controller)this.client?.close();
      this.client=controller ?? null;this.result=null;this.loading=null;this.openError='';this.fallbackMessage='';this.fidelity=undefined;this.copyNotice='';
      this.undoViews=[];this.redoViews=[];this.viewRevision++;
    }
    this.fileSource=false;this.hostOptions=next;this.hostChanging=false;this.reloading=null;
    if(!this.result)void this.load();
    if(this.dirty && !this.editable) {
      // A readonly/fallback display does not discard an uncommitted formula.
      // Recovery is allowed even after source write authority is revoked.
      try { await this.checkpoint(); } catch { /* draftError remains visible */ }
    } else this.schedule();
    this.notify();return true;
  }
  private notify() { if (!this.closed) this.host.notify(); }
  private assert() { if (this.closed || !this.client || !this.result) throw new Error('工作簿尚未就绪或已经关闭'); }
  async load():Promise<void> {
    // React may ask to load while a failed candidate is being authorized for
    // fallback. Only reload owns opening candidates during that transition.
    if(this.reloading && !this.loading)return;
    return this.loadCurrent();
  }
  private async loadCurrent():Promise<void> {
    if (this.loading) return this.loading;
    if (this.result) return;
    this.host.loadState='loading'; this.host.loadError=''; this.openError='';
    const client=this.client ??= new OfficeClient(this.host.file.ref,this.host.baseHash); this.notify();
    const operation=async()=>{
      try {
        const result=await client.ready; if (this.closed || this.client !== client) return;
        this.result=result; this.host.loadState='ready'; this.view.sheetId=result.workbook.sheets.find(sheet=>sheet.hidden === 'visible')!.id;
        const drafts=await rpc.files.drafts(this.host.file.ref);
        if(this.closed || this.client!==client)return;
        this.host.draftOptions=drafts;this.modelBaseHash=result.hash;this.filePhase('live');
      } catch(error) { if (!this.closed && this.client === client) { this.host.loadState='error'; this.host.loadError=this.openError=errorText(error);this.filePhase('blocked',this.openError); } }
      finally { if (this.client === client) { this.loading=null; this.notify(); } }
    };
    this.loading=operation(); return this.loading;
  }
  private serialize<T>(operation:()=>Promise<T>,write=false):Promise<T> {
    const epoch=this.hostEpoch;
    this.operations++;
    const run=this.queue.catch(()=>undefined).then(async()=>{ try { this.assert();if(write && (epoch!==this.hostEpoch || !this.editable))throw new FileError('CHANGED','工作簿来源或编辑权限已变化');this.busy=true; this.notify(); return await operation(); } finally { this.busy=false; this.operations--; this.notify(); } });
    this.queue=run; return run;
  }
  private accept(result:OfficeMutationResult) {
    this.assert();if(this.fidelity&&this.fidelity.version!==result.state.version){this.fidelity=undefined;this.copyNotice='';} this.result={...this.result!,workbook:result.state.workbook,state:result.state,calculation:result.calculation};
    if (!result.state.workbook.sheets.some(sheet=>sheet.id === this.view.sheetId && sheet.hidden === 'visible')) this.view={...this.view,sheetId:result.state.workbook.sheets.find(sheet=>sheet.hidden === 'visible')!.id,row:0,column:0,endRow:0,endColumn:0};
    this.tick++; this.notify();
  }
  private rememberView(version:number,before:OfficeView) {
    if(this.result!.state.version === version)return;
    this.undoViews.push({before:{...before},after:{...this.view}});this.redoViews=[];
    if(this.undoViews.length>=OFFICE_LIMITS.historyEntries)this.undoViews.shift();
  }
  setPending(value:OfficeCellEdit, original:string, originalVersion=this.result?.state.version):void {
    if (!this.editable || this.closed) return;
    // A mounted editor can still show an older baseline after an autosave.
    // Typing that old value again is a new edit, not a reason to clear pending.
    this.fidelity=undefined;this.copyNotice='';
    this.pending=value.text === original && originalVersion === this.result?.state.version ? null : value; this.bufferVersion++; if(!this.autoSaveStopped)this.host.saveError=''; this.schedule(); this.notify();
  }
  cancelPending():void { this.pending=null; this.bufferVersion++; this.schedule(); this.notify(); }
  setDrawingText(value:WorkbookTextEdit,original:string,originalVersion=this.result?.state.version):boolean {
    if(!this.editable||!this.editingControls||this.closed)return false;
    if(this.pendingDrawing&&(this.pendingDrawing.objectId!==value.objectId||this.pendingDrawing.sheetId!==value.sheetId)){
      this.host.saveError='请先完成当前文本框输入';this.notify();return false;
    }
    this.pendingDrawing=value.text===original&&originalVersion===this.result?.state.version?null:value;
    this.bufferVersion++;this.fidelity=undefined;this.copyNotice='';if(!this.autoSaveStopped)this.host.saveError='';this.schedule();this.notify();return true;
  }
  cancelDrawingText():void {this.pendingDrawing=null;this.bufferVersion++;this.schedule();this.notify();}
  private schedule() {
    clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer);
    if (this.closed || this.autosavePaused || this.hostChanging) return;
    this.checkpointTimer=setTimeout(()=>{ void this.checkpoint().catch(()=>undefined); },500);
    if (this.editable && this.dirty && !this.host.conflict && !this.autoSaveStopped) this.saveTimer=setTimeout(()=>{ void this.save(true); },3000);
  }
  private async flushInternal():Promise<boolean> {
    if (this.composing || !this.editable) return false;
    const pending=this.pending;
    if(pending){
      const version=this.result!.state.version,before={...this.view};
      const result=await rpc.files.editOffice({id:this.client!.id,version,edit:pending});
      this.assert();this.accept(result);this.rememberView(version,before);
      if(this.pending===pending)this.pending=null;
      this.bufferVersion++;this.schedule();if(this.pending)return false;
    }
    const drawing=this.pendingDrawing;
    if(drawing){
      if(!this.editingControls)return false;
      const version=this.result!.state.version,before={...this.view};
      const result=await rpc.files.editOfficeRange({id:this.client!.id,version,action:{type:'drawing-text',...drawing}});
      this.assert();this.accept(result);this.rememberView(version,before);
      if(this.pendingDrawing===drawing)this.pendingDrawing=null;
      this.bufferVersion++;this.schedule();
    }
    return !this.pending&&!this.pendingDrawing;
  }
  async flush():Promise<boolean> {
    if(!this.pending&&!this.pendingDrawing)return true;
    if(!this.editable)return false;
    try { return await this.serialize(()=>this.flushInternal(),true); }
    catch(error) { this.host.saveError=errorText(error); this.notify(); return false; }
  }
  /** Explicit control edits join the same queue as pending text, undo and save. */
  async editCell(edit:OfficeCellEdit):Promise<boolean> {
    if(!this.editable || this.closed)return false;
    try {return await this.serialize(async()=>{
      if(!await this.flushInternal() || !this.editable)return false;
      const version=this.result!.state.version,before={...this.view};if(!this.autoSaveStopped)this.host.saveError='';
      this.accept(await rpc.files.editOffice({id:this.client!.id,version,edit}));this.rememberView(version,before);
      this.bufferVersion++;this.schedule();return true;
    },true);}catch(error){this.host.saveError=errorText(error);this.notify();return false;}
  }
  private async checkpointInternal():Promise<FileCheckpointReceipt|null> {
    if (!this.dirty) { await this.discardInternal(); return null; }
    if (this.durableVersion === this.bufferVersion) { await this.host.ensureRecoveryRoute(); this.host.draftError=''; return this.durable ?? null; }
    const version=this.bufferVersion;
    const receipt=await rpc.files.checkpointOffice({id:this.client!.id,version:this.result!.state.version,draftId:this.host.draftId,bufferVersion:version,...(this.pending ? {pending:{...this.pending}} : {}),...(this.pendingDrawing?{pendingDrawing:{...this.pendingDrawing}}:{})});
    this.assert(); this.durable=receipt; this.durableVersion=version;
    await this.host.ensureRecoveryRoute(); this.host.draftError=''; return receipt;
  }
  async checkpoint(allowRetry=true):Promise<FileCheckpointReceipt|null> {
    clearTimeout(this.checkpointTimer);
    const version=this.bufferVersion;
    try { return await this.serialize(()=>this.checkpointInternal()); }
    catch(error) {
      if (!this.closed) {
        this.host.draftError=errorText(error); this.notify();
        // Recovery checkpoints are idempotent by draft/version. Retry only a
        // storage IO failure, once, without replaying edits or source writes.
        // New input owns its own timer; closing/discarding cancels this timer.
        if (allowRetry && /^\[IO\]\s/.test(errorMessage(error)) && this.dirty && this.bufferVersion === version) {
          this.checkpointTimer=setTimeout(()=>{ void this.checkpoint(false).catch(()=>undefined); },1000);
        }
      }
      throw error;
    }
  }
  get canCopyLossy():boolean{return Boolean(!this.closed&&this.fidelity&&this.fidelity.version===this.result?.state.version&&!this.pending&&!this.pendingDrawing&&!this.busy&&!this.saving&&!this.copyingLossy&&!this.host.conflict);}
  async saveLossyCopy():Promise<void>{
    const id=this.client?.id,failure=this.fidelity;if(!id||!failure||!this.canCopyLossy)return;
    this.copyingLossy=true;this.copyNotice='';this.notify();
    try{const receipt=await rpc.files.saveOfficeLossyCopy({kind:'xlsx',id,token:failure.token});this.assert();
      this.copyNotice=receipt.state==='saved'?'已另存有损副本；原件未保存，草稿仍保留。':'已取消另存；原件与草稿仍保留。';
    }catch(error){if(!this.closed)this.host.saveError=`有损副本未保存：${errorText(error)}`;}
    finally{this.copyingLossy=false;this.notify();}
  }
  async save(automatic=false):Promise<boolean> {
    if (this.closed || !this.editable || this.host.conflict) return false;
    if (automatic && this.autoSaveStopped) return false;
    clearTimeout(this.saveTimer); clearTimeout(this.checkpointTimer);
    if(!automatic)this.autoSaveStopped=false;
    const startingVersion=this.bufferVersion;
    try { return await this.serialize(async()=>{
      if(automatic && this.autoSaveStopped)return false;
      // Explicit save cancels the debounce timer. Preserve raw pending input
      // before validation, including a half-written or invalid formula.
      if (this.pending||this.pendingDrawing) await this.checkpointInternal();
      if (!await this.flushInternal()) return false;
      if (!this.dirty) { await this.discardInternal(); return true; }
      this.saving=true; this.host.saveError=''; this.notify();
      await this.checkpointInternal();
      if(!this.editable)return false;
      if (this.result!.calculation?.state !== 'ready') {
        const result=await rpc.files.recalculateOffice({id:this.client!.id,version:this.result!.state.version}); this.assert(); this.accept(result); this.bufferVersion++;
      }
      if (this.pending || this.pendingDrawing || this.host.conflict || !this.editable) return false;
      const version=this.bufferVersion, opId=crypto.randomUUID();
      const result=await rpc.files.saveOffice({id:this.client!.id,version:this.result!.state.version,draftId:this.host.draftId,bufferVersion:version,opId});
      this.assert(); this.accept(result); if(result.checkpoint){this.durable=result.checkpoint;this.durableVersion=version;}this.fidelity=result.fidelity;this.copyNotice='';
      this.host.saveReceipt=result.receipt; this.host.draftError=result.draftError ?? '';
      if (result.receipt.state !== 'saved' || !result.receipt.revision) {
        this.autoSaveStopped=true;
        this.host.saveError=result.receipt.message ?? '工作簿保存失败，修改仍保留';
        if (result.receipt.state === 'conflict') await this.refreshDisk();
        return false;
      }
      const revision=result.receipt.revision;
      this.writeRequired=false;
      this.host.file={...this.host.file,revision,documentKey:`local:${revision.device}:${revision.inode}`}; this.host.baseHash=this.modelBaseHash=revision.hash;
      if (!result.draftError) { this.durable=undefined; this.durableVersion=-1; }
      return !this.dirty;
    },true); } catch(error) { if (!this.closed) { this.autoSaveStopped=true; this.host.saveError=errorText(error); } return false; }
    finally { this.saving=false; if (this.autoSaveStopped)clearTimeout(this.saveTimer); if (this.dirty && !this.host.conflict && this.bufferVersion !== startingVersion) this.schedule(); this.notify(); }
  }
  async history(direction:'undo'|'redo'):Promise<void> {
    if(!this.editable)return;
    try { await this.serialize(async()=>{
      if (this.composing || !await this.flushInternal() || !this.editable) return;
      const version=this.result!.state.version,result=await rpc.files.officeHistory({id:this.client!.id,version,direction});
      if(result.state.version !== version) {
        const from=direction === 'undo' ? this.undoViews : this.redoViews,to=direction === 'undo' ? this.redoViews : this.undoViews,entry=from.pop();
        if(entry){to.push(entry);this.view={...(direction === 'undo' ? entry.before : entry.after)};}
        this.viewRevision++;
      }
      this.accept(result);
      // The Worker may trim history earlier due to its retained-byte budget.
      if(!result.state.canUndo)this.undoViews=[];if(!result.state.canRedo)this.redoViews=[];
      this.bufferVersion++; this.schedule();
    },true); } catch(error) { this.host.saveError=errorText(error); this.notify(); }
  }
  async sheetAction(action:OfficeSheetAction):Promise<boolean> {
    if (!this.editable || this.closed) return false;
    try { return await this.serialize(async()=>{
      if (!await this.flushInternal() || !this.editable) return false;
      if(!this.autoSaveStopped)this.host.saveError='';
      const version=this.result!.state.version,before={...this.view};
      const result=await rpc.files.officeSheet({id:this.client!.id,version:this.result!.state.version,action});
      this.assert();
      if (action.type === 'add' || action.type === 'delete' && this.view.sheetId === action.sheetId) {this.view={...this.view,sheetId:result.sheetId,row:0,column:0,endRow:0,endColumn:0};this.viewRevision++;}
      this.accept(result);this.rememberView(version,before);this.bufferVersion++;this.schedule();return true;
    },true); } catch(error) { this.host.saveError=errorText(error); this.notify(); return false; }
  }
  private async refreshDisk() { try { this.disk=await rpc.files.refresh(this.host.file.ref); } catch(error) { this.host.loadError=errorText(error); } }
  async rangeAction(action:OfficeRangeAction):Promise<boolean> {
    const content=action.type==='input' || action.type==='clear' && action.mode==='contents';
    if(!this.editable || this.closed || !content && !this.editingControls)return false;
    const client=this.client;
    try {return await this.serialize(async()=>{
      if(this.client !== client)return false;
      const input=action.type === 'input',pending=this.pending;
      if(input) {
        if(this.composing)return false;
        if(pending && (pending.sheetId !== action.sheetId || pending.text !== action.text || pending.row<action.range.firstRow || pending.row>action.range.lastRow || pending.column<action.range.firstColumn || pending.column>action.range.lastColumn))throw new FileError('CHANGED','单元格输入或选区已变化，请重试当前操作');
      } else if(!await this.flushInternal())return false;
      if(!this.editable || !content && !this.editingControls)return false;
      const version=this.result!.state.version,before={...this.view};if(!this.autoSaveStopped)this.host.saveError='';
      this.accept(await rpc.files.editOfficeRange({id:this.client!.id,version,action}));this.rememberView(version,before);
      if(input && this.pending === pending)this.pending=null;
      this.bufferVersion++;this.schedule();return !input || !this.pending;
    },true);}catch(error){this.host.saveError=errorText(error);this.notify();return false;}
  }
  private async drain():Promise<void> {
    // Edits, checkpoints and saves may append work while an earlier item runs.
    let queued:Promise<unknown>;
    do { queued=this.queue; await queued.catch(()=>undefined); }
    while (!this.closed && queued !== this.queue);
  }
  refresh():Promise<void> {
    if (this.closed) return Promise.resolve();
    this.refreshRequested=true;
    if (this.refreshing) return this.refreshing;
    const run=async()=>{
      while (this.refreshRequested && !this.closed) {
        this.refreshRequested=false;
        const client=this.client,version=this.bufferVersion,baseHash=this.host.baseHash;
        try {
          await this.drain(); if (this.closed) return;
          if (client !== this.client || baseHash !== this.host.baseHash) { this.refreshRequested=true; continue; }
          const file=await rpc.files.refresh(this.host.file.ref);
          await this.drain(); if (this.closed) return;
          // A save or explicit disk adoption invalidates this stat reply. Rescan
          // against the new baseline; never install metadata from an old client.
          if (client !== this.client || baseHash !== this.host.baseHash) { this.refreshRequested=true; continue; }
          // A successful stat does not mean the Office model opened successfully.
          if (file.revision.hash === baseHash && !this.failedHash) { this.host.file=file; this.host.loadError=this.openError; this.notify(); continue; }
          if (this.failedHash && file.revision.hash===this.failedHash) {this.host.file=file;this.notify();continue;}
          // Even an edit reverted to clean changed the observed local version.
          // Existing conflicts require an explicit resolution, including after Esc.
          if (this.dirty || this.disk || this.host.recoveryBlocked || version !== this.bufferVersion) {
            this.disk=file; this.host.saveError='磁盘内容已改变，本地修改仍保留'; clearTimeout(this.saveTimer); this.notify();
          } else { this.host.file=file; this.host.baseHash=file.revision.hash; await this.reload(false); }
        } catch(error) { if (!this.closed) { this.host.loadError=errorText(error); this.notify(); } }
      }
    };
    this.refreshing=run().finally(()=>{ this.refreshing=null; });
    return this.refreshing;
  }
  async keepLocal():Promise<boolean> {
    if (!this.editable || this.host.recoveryBlocked || this.closed || this.busy) return false;
    try {
      const file=await this.serialize(()=>rpc.files.rebaseOffice({id:this.client!.id,version:this.result!.state.version}));
      this.host.file=file; this.host.baseHash=this.modelBaseHash=file.revision.hash; this.disk=null; this.host.saveReceipt=null; this.writeRequired=true; this.bufferVersion++; return await this.save();
    } catch(error) { this.host.saveError=errorText(error); this.notify(); return false; }
  }
  async useDisk():Promise<boolean> {
    if(this.closed || this.host.sourceUnavailable)return false;
    const version=this.bufferVersion,epoch=this.hostEpoch;
    const current=()=>!this.closed && !this.host.sourceUnavailable && version===this.bufferVersion && epoch===this.hostEpoch;
    try {
      const file=await rpc.files.refresh(this.host.file.ref); if(!current())return false;
      await this.discardDraft(); if(!current())return false;
      this.host.file=file; this.host.baseHash=file.revision.hash; this.host.saveReceipt=null; this.host.saveError=''; this.pending=null;this.pendingDrawing=null; this.writeRequired=false; this.disk=null; this.result=null; await this.reload(false); return this.host.loadState === 'ready';
    } catch(error) { this.host.loadError=errorText(error); this.notify(); return false; }
  }
  async restoreDraft(id:string):Promise<void> {
    await this.serialize(async()=>{
      const version=this.result!.state.version,before={...this.view};
      const result=await rpc.files.restoreOffice({id:this.client!.id,version:this.result!.state.version,draftId:id}); this.assert();
      this.accept(result); this.host.draftId=id; this.pending=result.pending ?? null;this.pendingDrawing=result.pendingDrawing??null; this.bufferVersion=Math.max(this.bufferVersion,result.bufferVersion)+1;
      this.durable={draftId:id,bufferVersion:result.bufferVersion,hash:result.hash}; this.durableVersion=result.bufferVersion; this.host.draftOptions=[];
      if (result.baseHash !== this.host.file.revision.hash) { await this.refreshDisk(); this.host.saveError='草稿基线与当前磁盘不同，请选择保留的版本'; }
      this.host.baseHash=this.modelBaseHash=result.baseHash;
      if (this.pending) this.view={...this.view,sheetId:this.pending.sheetId,row:this.pending.row,column:this.pending.column,endRow:this.pending.row,endColumn:this.pending.column};
      else if(this.pendingDrawing)this.view={...this.view,sheetId:this.pendingDrawing.sheetId};
      this.rememberView(version,before);this.viewRevision++;
      this.schedule(); this.notify();
    });
  }
  private async discardInternal():Promise<void> {
    if (!this.durable) return;
    const result=await rpc.files.resolveDraft({ref:this.host.file.ref,...this.durable,action:'discard'});
    if (!result.resolved) throw new Error('草稿已有更新，未放弃新版本');
    this.durable=undefined; this.durableVersion=-1;
  }
  discardDraft():Promise<void> { clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer); return this.serialize(()=>this.discardInternal()); }
  async prepareClose(action:'save'|'discard'):Promise<boolean> {
    try {
      if (action === 'discard') { await this.discardDraft(); return true; }
      // A control edit can still be queued while the accepted model is clean.
      // Keep its client alive, and surface a rejected operation before disposing.
      try { while (this.operations) await this.queue; }
      catch(error) { this.host.saveError=errorText(error); this.notify(); return false; }
      if (!this.dirty && !this.host.conflict && !this.host.recoveryBlocked) return true;
      return await this.save() && !this.dirty && !this.host.recoveryBlocked;
    }
    finally { clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer); }
  }
  async reload(refreshRevision=true):Promise<void> {
    if (this.closed || this.dirty || this.host.sourceUnavailable) return;
    const reloading=this.reloading={};
    this.fallbackMessage='';
    this.hostEpoch++;
    this.reloadPhase('refreshing');
    if(this.hostOptions.source.kind==='artifactDocument')this.hostOptions={...this.hostOptions,source:{...this.hostOptions.source,phase:'refreshing',controller:undefined}};
    this.autoSaveStopped=false;
    clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer);
    try {
      await this.drain();
      if(this.closed || this.reloading!==reloading || this.dirty || this.host.sourceUnavailable)return;
      // An explicit retry can beat the next watch event. Resolve the current
      // native revision before opening, rather than retrying stale bad bytes.
      if(refreshRevision) {
        const file=await rpc.files.refresh(this.host.file.ref);
        if(this.closed || this.reloading!==reloading || this.dirty || this.host.sourceUnavailable)return;
        this.host.file=file;
      }
      if(!this.retained && this.client && this.result && !this.loading)this.retained={client:this.client,result:this.result,baseHash:this.modelBaseHash||this.host.baseHash,view:{...this.view}};
      if(this.client!==this.retained?.client)this.client?.close();
      this.client=null;this.result=null;this.loading=null;this.tick++;
      // Retry always uses the last observed native revision, never the old
      // model hash that a readonly fallback deliberately retains.
      this.host.baseHash=this.host.file.revision.hash;
      await this.loadCurrent();
      if(this.closed || this.reloading!==reloading)return;
      if(!this.openError && this.result && !this.host.sourceUnavailable) {
        const old=this.retained;this.retained=null;this.failedHash='';
        this.undoViews=[];this.redoViews=[];this.reloadPhase('live');
        if(old && old.client!==this.client){this.retiring.add(old.client);void old.client.retire().finally(()=>this.retiring.delete(old.client));}
      } else if(this.retained && !this.host.sourceUnavailable) {
        const old=this.retained,failed=this.host.file.revision.hash,reason=this.openError;
        (this.client as OfficeClient|null)?.close();this.client=null;
        // A cached parser alone is not permission to expose fallback contents.
        // Validate the current native ref/lease and its retained reader first.
        const file=await rpc.files.refresh(this.host.file.ref);
        if(this.closed || this.reloading!==reloading || this.host.sourceUnavailable)return;
        if(failed===old.baseHash && file.revision.hash===old.baseHash) {
          // An explicit retry of identical bytes did not supersede the model.
          // Keep the original error/retry surface (e.g. session quota), rather
          // than claim that a different disk revision is being shown as fallback.
          this.client=old.client;this.result=old.result;this.view=old.view;this.retained=null;
          this.host.file=file;this.host.baseHash=this.modelBaseHash=old.baseHash;this.failedHash='';
          this.openError=this.host.loadError=reason;this.host.loadState='error';this.reloadPhase('blocked',reason);return;
        }
        await old.client.cell(old.view.sheetId,old.view.row,old.view.column);
        if(this.closed || this.reloading!==reloading || this.host.sourceUnavailable)return;
        this.host.file=file;this.host.baseHash=this.modelBaseHash=old.baseHash;
        this.client=old.client;this.result=old.result;this.view=old.view;this.retained=null;
        this.failedHash=failed;this.openError='';this.host.loadError='';this.host.loadState='ready';
        this.fallbackMessage=`新内容读取失败，当前显示上次成功读取的只读内容：${reason}`;
        this.reloadPhase('fallback',this.fallbackMessage);this.tick++;
      }
    } catch(error) {
      if(!this.closed && this.reloading===reloading){this.host.loadError=errorText(error);this.reloadPhase('blocked',this.host.loadError);}
    } finally {
      // An older reload cannot release a newer reload's input guard.
      if(this.reloading===reloading){this.reloading=null;this.notify();}
    }
  }
  /** Keep the retained parser, pending input and undo history while main
   * verifies a fresh issued ref for the original physical root and file. */
  async reconnectSource(file:FileDocument,newDraft=false):Promise<void> {
    let requested=false,adopted=false;
    const transition=++this.hostTransition;this.hostEpoch++;const epoch=this.hostEpoch;
    const current=()=>!this.closed && transition===this.hostTransition && epoch===this.hostEpoch;
    this.hostChanging=true;clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer);this.notify();
    try {
      await this.drain();
      if(!current() || this.composing || this.host.recoveryBlocked || !this.host.inputSettled)throw new Error('工作簿仍有输入或恢复状态待处理；原修改保持独立');
      const previous=this.host.file;
      if(file.relativePath!==previous.relativePath || file.revision.device!==previous.revision.device || file.revision.inode!==previous.revision.inode || previous.sourceReadOnly===true && file.sourceReadOnly!==true)throw new Error('重新关联的物理文件或来源已改变；原工作簿仍保留');
      if(!this.client || !this.result) {
        if(this.dirty)throw new Error('原工作簿仍有修改待恢复');
        this.client?.close();this.retained?.client.close();this.retained=null;
        this.client=null;this.result=null;this.loading=null;
        this.host.file=file;this.host.baseHash=file.revision.hash;this.host.sourceUnavailable='';this.host.loadError='';this.failedHash='';adopted=true;
        await rpc.files.closeDocument(previous.ref).catch(()=>undefined);
        this.hostChanging=false;this.filePhase('starting');await this.load();return;
      }
      const client=this.client;
      await this.serialize(async()=>{
        if(!current() || this.client!==client)throw new Error('重新关联期间工作簿已改变，请重试');
        if(this.dirty)await this.checkpointInternal();
        if(!current())throw new Error('重新关联期间来源已改变，请重试');
        // A lost delivery cannot prove that main did not commit the transfer.
        // Retain its ref lifetime until a later successful transfer or close.
        this.reconnectRefs.set(file.ref.id,{...file.ref});requested=true;
        const result=await client.reconnect(file.ref,this.result!.state.version);
        if(this.closed || this.client!==client)throw new Error('工作簿已经关闭');
        this.host.file=result.document;this.host.baseHash=this.modelBaseHash=result.baseHash;adopted=true;
        this.accept(result);this.failedHash='';
        if(newDraft){this.host.draftId=crypto.randomUUID();this.durable=undefined;this.durableVersion=-1;this.bufferVersion++;}
        const retained=this.retained;this.retained=null;
        if(retained && retained.client!==client){this.retiring.add(retained.client);await retained.client.retire();this.retiring.delete(retained.client);}
        await rpc.files.closeDocument(previous.ref).catch(()=>undefined);
        for(const [id,ref] of this.reconnectRefs)if(id!==result.document.ref.id){await rpc.files.closeDocument(ref).catch(()=>undefined);this.reconnectRefs.delete(id);}
        this.reconnectRefs.delete(result.document.ref.id);
        // Even after commit, a withdrawn new lease stays blocked. Do not close
        // its document: it now owns the retained dirty model's lifetime.
        const refreshed=await rpc.files.refresh(result.document.ref);
        if(!current())throw new Error('新的工作簿来源已失效；原修改仍保留');
        this.host.file=refreshed;this.host.sourceUnavailable='';this.host.loadError='';this.openError='';
        this.disk=refreshed.revision.hash!==this.host.baseHash?refreshed:null;
        if(!this.disk)this.fallbackMessage='';
        this.host.saveError=this.disk?'磁盘内容已改变，本地修改仍保留':'';
        this.filePhase('live');
        if(this.dirty)await this.checkpointInternal();
      });
    } catch(error) {
      if(!this.closed){this.host.sourceUnavailable ||= errorText(error);this.host.saveError=errorText(error);this.filePhase('blocked',this.host.sourceUnavailable);}
      throw error;
    } finally {
      if(!adopted && !requested)await rpc.files.closeDocument(file.ref).catch(()=>undefined);
      if(transition===this.hostTransition){this.hostChanging=false;this.schedule();this.notify();}
    }
  }
  invalidateSource():void {
    if(this.closed)return;
    // Revoke retained view callbacks without discarding the recovery model.
    this.hostEpoch++;this.hostTransition++;this.hostChanging=false;
    this.filePhase('blocked',this.host.sourceUnavailable);
    clearTimeout(this.saveTimer);
  }
  pauseAutosave():void { this.autosavePaused=true;clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer); }
  resumeAutosave():void { if(!this.closed){this.autosavePaused=false;this.schedule();} }
  close():void { this.closed=true;this.reloading=null; clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer); this.client?.close();this.retained?.client.close();this.retained=null;for(const client of this.retiring)client.close();this.retiring.clear();for(const ref of this.reconnectRefs.values())void rpc.files.closeDocument(ref).catch(()=>undefined);this.reconnectRefs.clear(); }
}
