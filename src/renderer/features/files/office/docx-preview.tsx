import { useEffect,useState,useSyncExternalStore } from 'react';
import { DocxPages } from '@shared/DocxPages';
import { docxRoute,type DocxHostCapabilities } from '@shared/file-docx-route.mjs';
import type { DocxSourceResult } from '@shared/file-office-pages';
import { rpc } from '@renderer/lib/ipc';
import { bytesFromBase64,fileErrorMessage,type FileBuffer } from '../file-buffer';
import { FileOfficePagesPreview } from './pages-preview';
import { useFileTerminalContext } from '../terminal-context/context';
import { useDocxRequests } from './docx-context';
import { useQuery } from '@tanstack/react-query';
import type { AppSettingWithMeta } from '@shared/app-settings';

interface DocxHost extends Omit<DocxHostCapabilities,'importKind'|'isAttachmentPreview'> { requestEditsEnabled?:boolean;redlinesEnabled?:boolean }
const subscribeNone=()=>()=>undefined,snapshotNone=()=>0;
/** Ordinary task producer: only an actual live receiver admits context
 * requests. Rendering-route and redlines capabilities remain independent. */
export function TaskDocxPreview({buffer}:{buffer:FileBuffer}) {
  const terminal=useFileTerminalContext();
  const settings=useQuery({queryKey:['appSettings','fileOffice','meta'],queryFn:()=>rpc.appSettings.getWithMeta('fileOffice') as Promise<AppSettingWithMeta<'fileOffice'>>,staleTime:Infinity});
  useSyncExternalStore(terminal?.subscribe??subscribeNone,terminal?.snapshot??snapshotNone);
  const requestEditsEnabled=Boolean(terminal?.target&&terminal.root?.lease===buffer.file.ref.lease&&terminal.root.generation===buffer.file.ref.generation&&!buffer.sourceUnavailable);
  // Wait for the actual application policy before starting a renderer, so a
  // delayed settings read cannot briefly launch the wrong source route.
  if(settings.isError)return <div className="fw-empty" role="alert"><p>DOCX 预览设置读取失败：{fileErrorMessage(settings.error)}</p><button onClick={()=>void settings.refetch()}>重试</button></div>;
  if(!settings.data)return <div className="fw-empty" role="status">正在读取 DOCX 预览设置…</div>;
  return <FileDocxPreview buffer={buffer} host={{...settings.data.value.docx,hostId:'local-file',requestEditsEnabled}}/>;
}
export function FileDocxPreview({buffer,host}: {buffer:FileBuffer;host?:DocxHost}) {
  // FileDocument.attachment is trusted presentation metadata; file identity
  // remains the FileRef, not a route/cache key shared with another source.
  const route=docxRoute({...host,importKind:'docx',isAttachmentPreview:!!buffer.file.attachment});
  return route==='legacy'?<LegacyDocxPreview buffer={buffer} requestEditsEnabled={host?.requestEditsEnabled===true} redlinesEnabled={host?.redlinesEnabled===true}/>:<FileOfficePagesPreview buffer={buffer}/>;
}
function LegacyDocxPreview({buffer,requestEditsEnabled,redlinesEnabled}:{buffer:FileBuffer;requestEditsEnabled:boolean;redlinesEnabled:boolean}) {
  const identity=`${buffer.instance}/${buffer.file.ref.id}/${buffer.baseHash}`;
  const [ready,setReady]=useState<{identity:string;source:DocxSourceResult;bytes:Uint8Array}|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const abort=new AbortController(),id=crypto.randomUUID();setReady(null);setError('');
    (async()=>{
      const source=await rpc.files.openDocxSource({id,ref:buffer.file.ref,baseHash:buffer.baseHash});abort.signal.throwIfAborted();
      if(source.sourceHash!==buffer.baseHash||source.bytes!==buffer.file.revision.size||source.info.kind!=='docx')throw new Error('DOCX 来源与预览不一致');
      const bytes=new Uint8Array(source.bytes);
      for(let offset=0;offset<bytes.length;offset+=1024*1024){
        const size=Math.min(1024*1024,bytes.length-offset),chunk=bytesFromBase64(await rpc.files.officePagesChunk(id,offset,size));abort.signal.throwIfAborted();
        if(chunk.length!==size)throw new Error('DOCX 读取不完整');bytes.set(chunk,offset);
      }
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');abort.signal.throwIfAborted();
      if(digest!==source.sourceHash)throw new Error('DOCX 内容校验失败');
      setReady({identity,source,bytes});
    })().catch(failure=>{if(!abort.signal.aborted){setError(fileErrorMessage(failure));void rpc.files.releaseOfficePages(id).catch(()=>undefined);}});
    return()=>{abort.abort();void rpc.files.releaseOfficePages(id).catch(()=>undefined);};
  },[buffer,identity,attempt]);
  const active=ready?.identity===identity?ready:null;
  const requests=useDocxRequests(buffer,requestEditsEnabled&&!!active);
  if(error)return <div className="fw-empty" role="alert"><p>{error}</p><button onClick={()=>setAttempt(value=>value+1)}>重新预览</button></div>;
  if(!active)return <div className="fw-empty" role="status">正在读取 DOCX…</div>;
  return <div className="fw-docx-with-context"><DocxPages bytes={active.bytes} hasRevisions={active.source.info.hasRevisions} position={buffer.pdfPosition}
    redlinesEnabled={redlinesEnabled} commentDraft={requests.commentDraft} onRequestEdits={requests.onRequestEdits} onSelectionChange={requests.onSelectionChange}/>{requests.panel}</div>;
}
