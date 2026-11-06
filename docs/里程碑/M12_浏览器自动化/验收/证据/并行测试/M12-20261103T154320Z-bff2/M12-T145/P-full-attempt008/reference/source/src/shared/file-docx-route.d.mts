export interface DocxHostCapabilities { importKind?:string; isAttachmentPreview?:boolean; documentHostFlag?:boolean; renderFlag?:boolean; hostId?:string }
export function docxRoute(host?:DocxHostCapabilities):'legacy'|'popcorn'|null;
