import React,{useSyncExternalStore}from'react';
import{createRoot}from'react-dom/client';
import{FileTextEditor}from'../../../src/renderer/features/files/text-editor';
import{FileBuffer}from'../../../src/renderer/features/files/file-buffer';
const text='First needle shadow\nSecond shadow\nThird shadow\n',bytes=new TextEncoder().encode(text),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID();
const file={name:'Shadow.txt',ref:{id,lease:id,generation:1},documentKey:'synthetic:'+id,relativePath:'Shadow.txt',absolutePath:'/synthetic/Shadow.txt',writable:true,revision:{device:'1',inode:id,size:bytes.length,hash,modifiedNs:'1',changedNs:'1'}};
let revision=0;const listeners=new Set();const api={read:async()=>({document:file,base64:btoa(String.fromCharCode(...bytes))}),drafts:async()=>[],closeDocument:async()=>undefined};const buffer=new FileBuffer(file,api,()=>{revision++;listeners.forEach(fn=>fn())});await buffer.load();buffer.pauseAutosave();
const root=document.getElementById('shadow-host').attachShadow({mode:'open'});
function View(){useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision);return <><style>{':host{display:block;width:700px;margin:20px;padding:16px;border:1px solid #777}.fw-editor-host{height:350px;display:flex;flex-direction:column}.fw-codemirror{flex:1;min-height:0}.fw-icon{padding:6px}input{min-width:180px}button{margin:2px}'}</style><FileTextEditor buffer={buffer} wrap={false}/></>}
createRoot(root).render(<View/>);
