import type { PptxAction,PptxEditState } from '@shared/file-pptx';
import type { PptxTableLayout } from '@shared/file-pptx-table';
import { OfficeWorkerClient } from './worker-client';
import type { OfficeFidelityReport } from '@shared/file-office-fidelity';
import type { PptxImageReceipt } from './pptx-image';
export class PptxParser extends OfficeWorkerClient {
  open(bytes:Uint8Array,hash:string,signal:AbortSignal):Promise<PptxEditState>{return this.request({method:'open',bytes,hash},signal);}
  state(signal:AbortSignal):Promise<PptxEditState>{return this.request({method:'state'},signal);}
  edit(version:number,action:PptxAction,signal:AbortSignal,image?:PptxImageReceipt):Promise<PptxEditState>{return this.request({method:'edit',version,action,...(image?{image}:{})},signal);}
  history(version:number,direction:'undo'|'redo',signal:AbortSignal):Promise<PptxEditState>{return this.request({method:'history',version,direction},signal);}
  verify(version:number,bytes:Uint8Array,hash:string,signal:AbortSignal):Promise<OfficeFidelityReport>{return this.request({method:'verify',version,bytes,hash},signal);}
  materialize(version:number,signal:AbortSignal):Promise<{bytes:Uint8Array;hash:string;version:number}>{return this.request({method:'materialize',version},signal);}
  previewSource(version:number,signal:AbortSignal):Promise<{bytes:Uint8Array;hash:string;version:number}>{return this.request({method:'preview-source',version},signal);}
  acknowledge(version:number,hash:string,signal:AbortSignal):Promise<PptxEditState>{return this.request({method:'acknowledge',version,hash},signal);}
  restore(version:number,bytes:Uint8Array,signal:AbortSignal):Promise<PptxEditState>{return this.request({method:'restore',version,bytes},signal);}
  tableLayoutSource(version:number,signal:AbortSignal):Promise<{bytes:Uint8Array;hash:string;version:number}|null>{return this.request({method:'table-layout-source',version},signal);}
  tableLayout(version:number,bytes:Uint8Array,signal:AbortSignal):Promise<PptxTableLayout[]>{return this.request({method:'table-layout',version,bytes},signal);}
}
