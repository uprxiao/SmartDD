import type { FileCheckpointReceipt, FileDocument } from '@shared/files';
import { OFFICE_LIMITS,type OfficeCellEdit, type OfficeOpenResult, type OfficeMutationResult, type OfficeSheetAction } from '@shared/file-office';
import type { OfficeRangeAction } from '@shared/file-office';
import { rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from '../file-buffer';
import { OfficeClient } from './client';

const errorMessage = (error:unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/,'');
const errorText = (error:unknown) => errorMessage(error).replace(/^\[[A-Z_]+\]\s*/,'');
export interface OfficeView {sheetId:string;row:number;column:number;zoom:number;endRow?:number;endColumn?:number}
interface ViewHistory {before:OfficeView;after:OfficeView}
/** Owned by FileBuffer, never by the mounted grid. A pending formula is part of
 * dirty state and the durable recovery envelope, even if it is not valid yet. */
export class OfficeBuffer {
  client:OfficeClient|null=null;
  result:OfficeOpenResult|null=null;
  pending:OfficeCellEdit|null=null;
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
  private openError='';
  private queue:Promise<unknown>=Promise.resolve();
  private checkpointTimer?:ReturnType<typeof setTimeout>;
  private saveTimer?:ReturnType<typeof setTimeout>;
  private durable?:FileCheckpointReceipt;
  private durableVersion=-1;
  private bufferVersion=0;
  private writeRequired=false;
  private autoSaveStopped=false;
  constructor(private readonly host:FileBuffer) {}
  get dirty() { return Boolean(this.pending || this.result?.state.dirty || this.writeRequired); }
  get editable() { return Boolean(this.host.file.writable && this.result?.workbook.kind === 'xlsx' && !this.result.workbook.signed); }
  private notify() { if (!this.closed) this.host.notify(); }
  private assert() { if (this.closed || !this.client || !this.result) throw new Error('工作簿尚未就绪或已经关闭'); }
  async load():Promise<void> {
    if (this.loading) return this.loading;
    if (this.result) return;
    this.host.loadState='loading'; this.host.loadError=''; this.openError='';
    const client=this.client=new OfficeClient(this.host.file.ref,this.host.baseHash); this.notify();
    const operation=async()=>{
      try {
        const result=await client.ready; if (this.closed || this.client !== client) return;
        this.result=result; this.host.loadState='ready'; this.view.sheetId=result.workbook.sheets.find(sheet=>sheet.hidden === 'visible')!.id;
        this.host.draftOptions=await rpc.files.drafts(this.host.file.ref);
      } catch(error) { if (!this.closed && this.client === client) { this.host.loadState='error'; this.host.loadError=this.openError=errorText(error); } }
      finally { if (this.client === client) { this.loading=null; this.notify(); } }
    };
    this.loading=operation(); return this.loading;
  }
  private serialize<T>(operation:()=>Promise<T>):Promise<T> {
    const run=this.queue.catch(()=>undefined).then(async()=>{ this.assert(); this.busy=true; this.notify(); try { return await operation(); } finally { this.busy=false; this.notify(); } });
    this.queue=run; return run;
  }
  private accept(result:OfficeMutationResult) {
    this.assert(); this.result={...this.result!,workbook:result.state.workbook,state:result.state,calculation:result.calculation};
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
    this.pending=value.text === original && originalVersion === this.result?.state.version ? null : value; this.bufferVersion++; if(!this.autoSaveStopped)this.host.saveError=''; this.schedule(); this.notify();
  }
  cancelPending():void { this.pending=null; this.bufferVersion++; this.schedule(); this.notify(); }
  private schedule() {
    clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer);
    if (this.closed || this.autosavePaused) return;
    this.checkpointTimer=setTimeout(()=>{ void this.checkpoint().catch(()=>undefined); },500);
    if (this.dirty && !this.host.conflict && !this.autoSaveStopped) this.saveTimer=setTimeout(()=>{ void this.save(true); },3000);
  }
  private async flushInternal():Promise<boolean> {
    if (this.composing) return false;
    const pending=this.pending; if (!pending) return true;
    const version=this.result!.state.version,before={...this.view};
    const result=await rpc.files.editOffice({id:this.client!.id,version:this.result!.state.version,edit:pending});
    this.assert(); this.accept(result);
    this.rememberView(version,before);
    if (this.pending === pending) this.pending=null;
    this.bufferVersion++; this.schedule(); return !this.pending;
  }
  async flush():Promise<boolean> {
    try { return await this.serialize(()=>this.flushInternal()); }
    catch(error) { this.host.saveError=errorText(error); this.notify(); return false; }
  }
  /** Explicit control edits join the same queue as pending text, undo and save. */
  async editCell(edit:OfficeCellEdit):Promise<boolean> {
    if(!this.editable || this.closed)return false;
    try {return await this.serialize(async()=>{
      if(!await this.flushInternal())return false;
      const version=this.result!.state.version,before={...this.view};if(!this.autoSaveStopped)this.host.saveError='';
      this.accept(await rpc.files.editOffice({id:this.client!.id,version,edit}));this.rememberView(version,before);
      this.bufferVersion++;this.schedule();return true;
    });}catch(error){this.host.saveError=errorText(error);this.notify();return false;}
  }
  private async checkpointInternal():Promise<FileCheckpointReceipt|null> {
    if (!this.dirty) { await this.discardInternal(); return null; }
    if (this.durableVersion === this.bufferVersion) { await this.host.ensureRecoveryRoute(); this.host.draftError=''; return this.durable ?? null; }
    const version=this.bufferVersion;
    const receipt=await rpc.files.checkpointOffice({id:this.client!.id,version:this.result!.state.version,draftId:this.host.draftId,bufferVersion:version,...(this.pending ? {pending:{...this.pending}} : {})});
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
      if (this.pending) await this.checkpointInternal();
      if (!await this.flushInternal()) return false;
      if (!this.dirty) { await this.discardInternal(); return true; }
      this.saving=true; this.host.saveError=''; this.notify();
      await this.checkpointInternal();
      if (this.result!.calculation?.state !== 'ready') {
        const result=await rpc.files.recalculateOffice({id:this.client!.id,version:this.result!.state.version}); this.assert(); this.accept(result); this.bufferVersion++;
      }
      if (this.pending || this.host.conflict) return false;
      const version=this.bufferVersion, opId=crypto.randomUUID();
      const result=await rpc.files.saveOffice({id:this.client!.id,version:this.result!.state.version,draftId:this.host.draftId,bufferVersion:version,opId});
      this.assert(); this.accept(result); this.durable=result.checkpoint; this.durableVersion=version;
      this.host.saveReceipt=result.receipt; this.host.draftError=result.draftError ?? '';
      if (result.receipt.state !== 'saved' || !result.receipt.revision) {
        this.autoSaveStopped=true;
        this.host.saveError=result.receipt.message ?? '工作簿保存失败，修改仍保留';
        if (result.receipt.state === 'conflict') await this.refreshDisk();
        return false;
      }
      const revision=result.receipt.revision;
      this.writeRequired=false;
      this.host.file={...this.host.file,revision,documentKey:`local:${revision.device}:${revision.inode}`}; this.host.baseHash=revision.hash;
      if (!result.draftError) { this.durable=undefined; this.durableVersion=-1; }
      return !this.dirty;
    }); } catch(error) { if (!this.closed) { this.autoSaveStopped=true; this.host.saveError=errorText(error); } return false; }
    finally { this.saving=false; if (this.autoSaveStopped)clearTimeout(this.saveTimer); if (this.dirty && !this.host.conflict && this.bufferVersion !== startingVersion) this.schedule(); this.notify(); }
  }
  async history(direction:'undo'|'redo'):Promise<void> {
    try { await this.serialize(async()=>{
      if (this.composing || !await this.flushInternal()) return;
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
    }); } catch(error) { this.host.saveError=errorText(error); this.notify(); }
  }
  async sheetAction(action:OfficeSheetAction):Promise<boolean> {
    if (!this.editable || this.closed) return false;
    try { return await this.serialize(async()=>{
      if (!await this.flushInternal()) return false;
      if(!this.autoSaveStopped)this.host.saveError='';
      const version=this.result!.state.version,before={...this.view};
      const result=await rpc.files.officeSheet({id:this.client!.id,version:this.result!.state.version,action});
      this.assert();
      if (action.type === 'add' || action.type === 'delete' && this.view.sheetId === action.sheetId) {this.view={...this.view,sheetId:result.sheetId,row:0,column:0,endRow:0,endColumn:0};this.viewRevision++;}
      this.accept(result);this.rememberView(version,before);this.bufferVersion++;this.schedule();return true;
    }); } catch(error) { this.host.saveError=errorText(error); this.notify(); return false; }
  }
  private async refreshDisk() { try { this.disk=await rpc.files.refresh(this.host.file.ref); } catch(error) { this.host.loadError=errorText(error); } }
  async rangeAction(action:OfficeRangeAction):Promise<boolean> {
    if(!this.editable || this.closed)return false;
    try {return await this.serialize(async()=>{
      if(!await this.flushInternal())return false;
      const version=this.result!.state.version,before={...this.view};if(!this.autoSaveStopped)this.host.saveError='';
      this.accept(await rpc.files.editOfficeRange({id:this.client!.id,version,action}));this.rememberView(version,before);
      this.bufferVersion++;this.schedule();return true;
    });}catch(error){this.host.saveError=errorText(error);this.notify();return false;}
  }
  async refresh():Promise<void> {
    if (this.closed || this.saving || this.busy) return;
    try {
      const file=await rpc.files.refresh(this.host.file.ref); if (this.closed) return;
      // A successful stat does not mean the Office model opened successfully.
      // Focus/watch refresh must not turn a parse/quota failure into a spinner.
      if (file.revision.hash === this.host.baseHash) { this.host.file=file; this.host.loadError=this.openError; this.notify(); return; }
      if (this.dirty || this.host.recoveryBlocked) { this.disk=file; this.host.saveError='磁盘内容已改变，本地修改仍保留'; clearTimeout(this.saveTimer); this.notify(); }
      else { this.host.file=file; this.host.baseHash=file.revision.hash; await this.reload(); }
    } catch(error) { if (!this.closed) { this.host.loadError=errorText(error); this.notify(); } }
  }
  async keepLocal():Promise<boolean> {
    if (this.host.recoveryBlocked || this.closed || this.busy) return false;
    try {
      const file=await this.serialize(()=>rpc.files.rebaseOffice({id:this.client!.id,version:this.result!.state.version}));
      this.host.file=file; this.host.baseHash=file.revision.hash; this.disk=null; this.host.saveReceipt=null; this.writeRequired=true; this.bufferVersion++; return await this.save();
    } catch(error) { this.host.saveError=errorText(error); this.notify(); return false; }
  }
  async useDisk():Promise<boolean> {
    try {
      const file=await rpc.files.refresh(this.host.file.ref); await this.discardDraft(); if (this.closed) return false;
      this.host.file=file; this.host.baseHash=file.revision.hash; this.host.saveReceipt=null; this.host.saveError=''; this.pending=null; this.writeRequired=false; this.disk=null; this.result=null; await this.reload(); return this.host.loadState === 'ready';
    } catch(error) { this.host.loadError=errorText(error); this.notify(); return false; }
  }
  async restoreDraft(id:string):Promise<void> {
    await this.serialize(async()=>{
      const version=this.result!.state.version,before={...this.view};
      const result=await rpc.files.restoreOffice({id:this.client!.id,version:this.result!.state.version,draftId:id}); this.assert();
      this.accept(result); this.host.draftId=id; this.pending=result.pending ?? null; this.bufferVersion=Math.max(this.bufferVersion,result.bufferVersion)+1;
      this.durable={draftId:id,bufferVersion:result.bufferVersion,hash:result.hash}; this.durableVersion=result.bufferVersion; this.host.draftOptions=[];
      if (result.baseHash !== this.host.file.revision.hash) { await this.refreshDisk(); this.host.saveError='草稿基线与当前磁盘不同，请选择保留的版本'; }
      this.host.baseHash=result.baseHash;
      if (this.pending) this.view={...this.view,sheetId:this.pending.sheetId,row:this.pending.row,column:this.pending.column,endRow:this.pending.row,endColumn:this.pending.column};
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
    try { if (action === 'discard') { await this.discardDraft(); return true; } return await this.save() && !this.dirty && !this.host.recoveryBlocked; }
    finally { clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer); }
  }
  async reload():Promise<void> {
    if (this.dirty) return;
    this.autoSaveStopped=false;
    this.client?.close(); this.client=null; this.result=null; this.loading=null; this.undoViews=[];this.redoViews=[];this.tick++; await this.load();
  }
  pauseAutosave():void { this.autosavePaused=true;clearTimeout(this.checkpointTimer);clearTimeout(this.saveTimer); }
  resumeAutosave():void { if(!this.closed){this.autosavePaused=false;this.schedule();} }
  close():void { this.closed=true; clearTimeout(this.checkpointTimer); clearTimeout(this.saveTimer); this.client?.close(); }
}
