import {useEffect,useRef,useState} from 'react';
import type {FileApplications} from '@shared/files';
import {rpcErrorMessage} from '@shared/ipc/rpc';
import {rpc} from '@renderer/lib/ipc';
import {unwrap} from './api';
import {AttachmentOpenDialog} from './attachment-open-ui';

export function SavedAttachmentOpenButton({projectId,operationId,autoOpen=0,disabled=false,onBusyChange}:{projectId:string;operationId:string;autoOpen?:number;disabled?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const [open,setOpen]=useState(false),[apps,setApps]=useState<(FileApplications&{filename:string})|null>(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const generation=useRef(0),live=useRef(true),automatic=useRef(0),active=useRef(false),returnFocus=useRef(false),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{live.current=true;return()=>{live.current=false;generation.current++;};},[projectId,operationId]);
 useEffect(()=>{if(!open&&returnFocus.current){returnFocus.current=false;trigger.current?.focus();}},[open]);
 const choose=async()=>{
  if(active.current)return;active.current=true;const attempt=++generation.current;
  setOpen(true);setApps(null);setSelected('');setError('');setNotice('');setBusy(true);onBusyChange?.(true);
  try{const value=unwrap(await rpc.applications.savedAttachmentApplications(projectId,{operationId}));if(!live.current||generation.current!==attempt)return;setApps(value);setSelected(value.preferredId??'');}
  catch(e){if(live.current&&generation.current===attempt)setError(rpcErrorMessage(e));}
  finally{active.current=false;if(live.current&&generation.current===attempt)setBusy(false);onBusyChange?.(false);}
 };
 useEffect(()=>{if(autoOpen>0&&automatic.current!==autoOpen){automatic.current=autoOpen;void choose();}},[autoOpen]);
 const launch=async()=>{
  if(active.current||!apps?.apps.some(app=>app.id===selected))return;active.current=true;const attempt=++generation.current;
  setBusy(true);setError('');onBusyChange?.(true);
  try{const value=unwrap(await rpc.applications.openSavedAttachment(projectId,{operationId,listId:apps.id,appId:selected}));if(live.current&&generation.current===attempt){setNotice('系统已接受使用'+value.name+'打开副本的请求');setOpen(false);setApps(null);}}
  catch(e){if(live.current&&generation.current===attempt){setError(rpcErrorMessage(e));setSelected('');setApps(null);}}
  finally{active.current=false;if(live.current&&generation.current===attempt)setBusy(false);onBusyChange?.(false);}
 };
 return <><button ref={trigger} className="m10-button secondary" disabled={disabled||busy} onClick={()=>void choose()}>打开已保存附件</button>{notice&&<p role="status">{notice}</p>}{open&&<AttachmentOpenDialog filename={apps?.filename??'已保存附件'} applications={apps} selected={selected} onSelect={setSelected} busy={busy} error={error} onOpen={()=>void launch()} onClose={()=>{if(!active.current){generation.current++;returnFocus.current=true;setOpen(false);setApps(null);}}}/>}</>;
}
