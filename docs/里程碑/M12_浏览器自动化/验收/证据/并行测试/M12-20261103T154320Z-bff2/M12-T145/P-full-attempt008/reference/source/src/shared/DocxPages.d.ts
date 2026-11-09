import type { ReactElement } from 'react';
export interface DocxPagesProps {
 bytes:Uint8Array;hasRevisions?:boolean;redlinesEnabled?:boolean;commentDraft?:string;
 onRequestEdits?:()=>void;onDownload?:()=>void;onSelectionChange?:(value:{text:string;page:number}|null)=>void;
 onReady?:(value:{pages:number;hasRevisions:boolean})=>void;onError?:(error:unknown)=>void;
 onPageChange?:(page:number)=>void;
 position?:{page:number;zoom:number};
}
export function DocxPages(props:DocxPagesProps):ReactElement;
