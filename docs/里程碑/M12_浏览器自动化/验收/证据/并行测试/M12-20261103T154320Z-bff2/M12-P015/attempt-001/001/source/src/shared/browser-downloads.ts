// Filename/collision approach adapted from Orca bd9455b6165 (MIT).
// R01.7 explicitly removes control characters rather than replacing them.
export interface BrowserDownload {id:string;taskId:string;pageId:string;name:string;path:string|null;url:string;state:'progress'|'done'|'failed'|'cancelled';receivedBytes:number;totalBytes:number;updatedAt:number;error:string|null}
export function browserDownloadFilename(raw:string):string{
  return(raw.replaceAll('\\','/').split('/').at(-1)??'').replace(/\p{Cc}/gu,'').replace(/[<>:"|?*]/g,'_').replace(/[. ]+$/g,'')||'download';
}
export function browserDownloadCandidate(name:string,attempt:number):string{
  if(attempt===0)return name;const dot=name.lastIndexOf('.'),extension=dot>0?name.slice(dot):'',stem=extension?name.slice(0,-extension.length):name;return`${stem} (${attempt})${extension}`;
}
