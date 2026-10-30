import { createHash } from 'node:crypto';
import { FileError } from '@shared/files';
import { OFFICE_LIMITS } from '@shared/file-office';
import type { PptxAction,PptxEditState } from '@shared/file-pptx';
import { OfficePackage } from './package';
import { verifyOfficeCandidate } from './fidelity';
import { OfficePagesModel } from './pages-model';
import { editPptx } from './pptx-edit';
import { OfficeXml,children } from './xml';
import { pptxTableLayoutSource,readPptxTableLayout,type PptxTableLayoutSource } from './pptx-table-layout';
import type { PptxTableLayout } from '@shared/file-pptx-table';
import { measuredPptxRows } from './pptx-table-measurement';
import type { PptxImageReceipt } from './pptx-image';
import { editPptxChartValues,editPptxChartType } from './pptx-chart';
import { insertPptxChart } from './pptx-chart-create';
import { pptxChartPreviewSource } from './pptx-chartex-preview';
interface Entry {identity:number;file:OfficePackage}
/** PPTX candidate history retains original parts; PDF layout is never a save. */
export class PptxDocument {
  model:OfficePagesModel;
  private entries:Entry[];private cursor=0;private sequence=0;private version=0;private savedIdentity=0;
  private snapshot?:{bytes:Buffer;hash:string;version:number;identity:number};
  private chartProjection?:{bytes:Buffer;hash:string;version:number};
  private tableProjection?:{version:number;source:PptxTableLayoutSource;bytes:Buffer;hash:string;layout?:PptxTableLayout[]};
  constructor(file:OfficePackage){this.model=new OfficePagesModel(file);if(this.model.info.kind!=='pptx')throw new FileError('UNSUPPORTED','此编辑模型只接受 PPTX');this.entries=[{identity:0,file}];}
  state():PptxEditState{return {version:this.version,dirty:this.entries[this.cursor].identity!==this.savedIdentity,canUndo:this.cursor>0,canRedo:this.cursor+1<this.entries.length,protected:children(new OfficeXml(this.model.packageData.read(this.model.graph.mainPart)).root,'modifyVerifier').length>0,info:this.model.info};}
  private assert(version:number){if(version!==this.version)throw new FileError('CHANGED','演示文稿编辑版本已改变');}
  edit(version:number,action:PptxAction,image?:PptxImageReceipt):PptxEditState{
    this.assert(version);let measuredRows:number[]|undefined;
    if(action.type==='element-transform'&&action.patch.height!==undefined){
      const element=this.model.info.slides.find(slide=>slide.id===action.slideId)?.elements?.find(element=>element.id===action.elementId);
      if(element?.table?.heights.some(height=>height===0)&&this.tableProjection?.version===version){
        const layout=this.tableProjection.layout?.find(layout=>layout.slideId===action.slideId&&layout.elementId===action.elementId);
        if(layout)measuredRows=measuredPptxRows(element,layout);
      }
    }
    const result=editPptx(this.model.packageData,action,measuredRows,image);if(result.packageData===this.model.packageData)return this.state();return this.push(result.packageData);
  }
  private push(file:OfficePackage):PptxEditState{
    const model=new OfficePagesModel(file);if(model.info.kind!=='pptx')throw new FileError('INVALID_INPUT','演示文稿候选类型无效');
    this.entries.splice(this.cursor+1);this.entries.push({identity:++this.sequence,file});this.cursor++;this.model=model;this.version++;this.snapshot=undefined;this.tableProjection=undefined;this.chartProjection=undefined;
    const current=OfficePackage.retainedBytes([file]);
    while(this.entries.length>1&&(this.entries.length>OFFICE_LIMITS.historyEntries||OfficePackage.retainedBytes(this.entries.map(entry=>entry.file))-current>OFFICE_LIMITS.historyBytes)){this.entries.shift();this.cursor--;}
    return this.state();
  }
  async editChartValues(version:number,action:Extract<PptxAction,{type:'chart-values'|'chart-insert'|'chart-type'}>):Promise<PptxEditState>{
    this.assert(version);
    const result=await (action.type==='chart-insert'?insertPptxChart(this.model,action.slideId,action.chartType):action.type==='chart-type'?editPptxChartType(this.model,action.slideId,action.elementId,action.chartType):editPptxChartValues(this.model,action.slideId,action.elementId,action.values));
    this.assert(version);
    return result.packageData===this.model.packageData?this.state():this.push(result.packageData);
  }
  history(version:number,direction:'undo'|'redo'):PptxEditState{
    this.assert(version);const next=this.cursor+(direction==='undo'?-1:1);if(next<0||next>=this.entries.length)return this.state();
    this.model=new OfficePagesModel(this.entries[next].file);this.cursor=next;this.version++;this.snapshot=undefined;this.tableProjection=undefined;this.chartProjection=undefined;return this.state();
  }
  restore(version:number,file:OfficePackage):PptxEditState{this.assert(version);return this.push(file);}
  async materialize(version:number){
    this.assert(version);if(!this.snapshot){
      const entry=this.entries[this.cursor],bytes=await entry.file.bytes();
      // Compression is asynchronous. Never attach an older candidate to a
      // newer edit or undo position, even when called outside the Worker queue.
      this.assert(version);
      this.snapshot={bytes,hash:createHash('sha256').update(bytes).digest('hex'),version,identity:entry.identity};
    }
    return {bytes:this.snapshot.bytes,hash:this.snapshot.hash,version};
  }
  async verify(version:number,bytes:Uint8Array,hash:string){this.assert(version);const expected=this.model.packageData;const report=await verifyOfficeCandidate(expected,bytes,hash);this.assert(version);return report;}
  acknowledge(version:number,hash:string):PptxEditState{
    if(!this.snapshot||this.snapshot.version!==version||this.snapshot.hash!==hash)throw new FileError('CHANGED','演示文稿保存回执与候选不一致');
    this.savedIdentity=this.snapshot.identity;return this.state();
  }
  async previewSource(version:number){
    this.assert(version);
    if(!this.chartProjection){
      const model=this.model,projected=await pptxChartPreviewSource(model);this.assert(version);
      if(projected===model.packageData)return this.materialize(version);
      const bytes=await projected.bytes();this.assert(version);
      this.chartProjection={bytes,hash:createHash('sha256').update(bytes).digest('hex'),version};
    }
    return this.chartProjection;
  }
  async tableLayoutSource(version:number):Promise<{bytes:Buffer;hash:string;version:number}|null>{
    this.assert(version);
    if(!this.tableProjection){
      const source=pptxTableLayoutSource(this.model);if(!source.markers.size)return null;
      source.packageData=await pptxChartPreviewSource(new OfficePagesModel(source.packageData));this.assert(version);
      const bytes=await source.packageData.bytes();this.assert(version);
      this.tableProjection={version,source,bytes,hash:createHash('sha256').update(bytes).digest('hex')};
    }
    return {bytes:this.tableProjection.bytes,hash:this.tableProjection.hash,version};
  }
  tableLayout(version:number,bytes:Uint8Array){
    this.assert(version);if(this.tableProjection?.version!==version)throw new FileError('CHANGED','表格布局副本已过期');
    const layout=readPptxTableLayout(bytes,this.tableProjection.source);this.tableProjection.layout=layout;return layout;
  }
}
