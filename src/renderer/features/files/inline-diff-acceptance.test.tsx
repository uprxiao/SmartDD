// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EditorView } from '@codemirror/view';
import { getChunks, getOriginalDoc } from '@codemirror/merge';
import { useSyncExternalStore } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileBuffer } from './file-buffer';
import { FileTextEditor } from './text-editor';
import { FileSourceView } from './source-view';
import { fileConflictOriginal } from './conflict-diff';
import { inlineDiffFixtures, verifyInlineDiffFixture } from '../../../../scripts/files/inline-diff-fixtures.mjs';
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}}}));
vi.mock('./code/editor',()=>({codeHighlight:()=>[]}));
vi.mock('./markdown/editor',()=>({markdownEditor:()=>[]}));
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex'),norm=(value:string)=>value.replace(/\r\n?/g,'\n');
const rows:unknown[]=[],fixtures:(()=>Promise<void>)[]=[];
const until=async(fn:()=>boolean)=>{const end=Date.now()+6000;while(!fn()){if(Date.now()>end)throw new Error('Native diff IO did not settle');await delay(5);}};
async function fixture(data:typeof inlineDiffFixtures[number]){
 const directory=realpathSync(mkdtempSync('/private/tmp/willyou-inline-diff-native-')),project=join(directory,'project'),userdata=join(directory,'userdata');mkdirSync(project);mkdirSync(userdata);const path=join(project,data.id+'.txt');writeFileSync(path,data.base);
 const broker=new NativeFileBroker(join(process.env.SMARTDD_INLINE_DIFF_APP!,'Contents/Resources/native/willyou-files')),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',path:project,label:'H33 private native',projectId:data.id}]};
 const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));
 const root=(await service.openScope('diff',{kind:'project',projectId:data.id})).roots[0],file=await service.open('diff',{lease:root.lease,generation:root.generation,relativePath:data.id+'.txt'});
 const pending=new Set<Promise<unknown>>(),calls:string[]=[];const invoke=async<T,>(method:string,action:()=>Promise<T>)=>{calls.push(method);const p=action();pending.add(p);try{return await p;}finally{pending.delete(p);}};
 const api={read:(ref:typeof file.ref)=>invoke('read',()=>service.read('diff',ref)),refresh:(ref:typeof file.ref)=>invoke('refresh',()=>service.refresh('diff',ref)),save:(input:Parameters<FileService['save']>[1])=>invoke('save',()=>service.save('diff',input)),checkpoint:(input:Parameters<FileService['checkpoint']>[1])=>invoke('checkpoint',()=>service.checkpoint('diff',input)),drafts:async(ref:typeof file.ref)=>service.drafts('diff',ref),readDraft:(ref:typeof file.ref,id:string)=>service.readDraft('diff',ref,id),resolveDraft:(input:Parameters<FileService['resolveDraft']>[1])=>invoke('resolveDraft',()=>service.resolveDraft('diff',input)),closeDocument:async(ref:typeof file.ref)=>service.closeDocument('diff',ref)};
 let revision=0;const listeners=new Set<()=>void>(),buffer=new FileBuffer(file,api,()=>{revision++;listeners.forEach(fn=>fn());});await buffer.load();
 const f={directory,path,broker,service,buffer,calls,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},snapshot:()=>revision,idle:()=>until(()=>pending.size===0&&broker.activeProcesses===0&&!buffer.saving)};
 fixtures.push(async()=>{buffer.dispose();await f.idle();service.closeOwner('diff');await service.watcher.dispose();broker.dispose();rmSync(directory,{recursive:true,force:true});});vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});return f;
}
function Editor({value}:{value:Awaited<ReturnType<typeof fixture>>}){useSyncExternalStore(value.subscribe,value.snapshot);return <FileTextEditor buffer={value.buffer} wrap={false}/>;}
afterEach(async()=>{cleanup();for(const close of fixtures.splice(0))await close();vi.useRealTimers();vi.unstubAllGlobals();});
afterAll(()=>{if(process.env.SMARTDD_INLINE_DIFF_EVIDENCE)writeFileSync(process.env.SMARTDD_INLINE_DIFF_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-H33',nativeApp:process.env.SMARTDD_INLINE_DIFF_APP,rows,boundary:'I actual source/FileBuffer/FileTextEditor/CodeMirror merge and native FileService/broker/recovery. jsdom geometry, fake timers, unrelated syntax/Markdown workers isolated; no actual UI or full highlighting claim. No fabricated native responses.'},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_INLINE_DIFF_APP)('H33 source/native/editor boundary',()=>{
 beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}});});
 it.each(inlineDiffFixtures)('$id gates both sources, retains full selectable source/draft and does not pick a version',async data=>{
  const counts=verifyInlineDiffFixture(data),f=await fixture(data);render(<Editor value={f}/>);let view=EditorView.findFromDOM(document.querySelector('.fw-editor-host .cm-editor')as HTMLElement)!;
  await act(async()=>{view.dispatch({changes:{from:0,to:1,insert:'L'},userEvent:'input.type'});});expect(f.buffer.raw).toBe(data.local);
  writeFileSync(f.path,data.disk);await act(async()=>{await f.buffer.refresh();});const base=f.buffer.baseHash,version=f.buffer.version;
  expect(document.querySelector('.fw-editor-host')?.getAttribute('data-inline-diff-state')).toBe(data.enabled?'enabled':'too-large');expect(f.buffer.raw).toBe(data.local);expect(f.buffer.conflict).toBe(true);expect(base).toBe(sha(data.base));
  if(data.enabled){expect(view.state.field(fileConflictOriginal)).toBe(data.disk);expect(getOriginalDoc(view.state).toString()).toBe(norm(data.disk));expect(getChunks(view.state)?.chunks.length).toBeGreaterThan(0);}else{expect(view.state.field(fileConflictOriginal,false)).toBeUndefined();expect(document.body.textContent).toMatch(/262144|5000/);}
  await act(async()=>{view.dispatch({selection:{anchor:0,head:view.state.doc.length}});});expect(view.state.selection.main.to).toBe(norm(data.local).length);
  render(<FileSourceView text={data.disk} readOnly label="完整磁盘源码"/>);const diskView=EditorView.findFromDOM(document.querySelector('[aria-label="完整磁盘源码"]')as HTMLElement)!;expect(diskView.state.doc.toString()).toBe(norm(data.disk));expect(diskView.state.readOnly).toBe(true);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3500);await f.idle();});expect(f.calls.filter(x=>x==='save'||x==='resolveDraft')).toEqual([]);expect(readFileSync(f.path,'utf8')).toBe(data.disk);expect(f.buffer.baseHash).toBe(base);expect(f.buffer.version).toBe(version);
  const draft=await f.service.readDraft('diff',f.buffer.file.ref,f.buffer.draftId);expect(draft.baseHash).toBe(base);expect(Buffer.from(draft.base64,'base64').toString()).toBe(data.local);
  rows.push({caseId:'M9-T-H33',id:data.id,counts,enabled:data.enabled,baseHash:base,version,localUnits:f.buffer.raw.length,diskUnits:data.disk.length,sourceHash:sha(f.buffer.raw),diskHash:sha(readFileSync(f.path)),draftHash:sha(Buffer.from(draft.base64,'base64')),noVersionDecision:true,calls:f.calls});
 },15000);
 it.each(['keepLocal','useDisk','continueEditing'] as const)('explicit %s after diff never restores a stale editor state',async action=>{
  const data={id:'resolution-'+action,local:'Local\r\n',disk:'Disk\r\n',base:'Base\r\n',enabled:true},f=await fixture(data);render(<Editor value={f}/>);
  await act(async()=>{const tr=f.buffer.editor!.update({changes:{from:0,to:f.buffer.editor!.doc.length,insert:data.local},userEvent:'input.type'});f.buffer.acceptTransactions(tr.state,[tr]);});
  writeFileSync(f.path,data.disk);await act(async()=>{await f.buffer.refresh();});expect(document.querySelector('.fw-editor-host')?.getAttribute('data-inline-diff-state')).toBe('enabled');
  await act(async()=>{expect(await f.buffer[action]()).toBe(true);await f.idle();});const editor=EditorView.findFromDOM(document.querySelector('.fw-editor-host .cm-editor')as HTMLElement)!;
  expect(f.buffer.raw).toBe(action==='useDisk'?data.disk:data.local);expect(editor.state).toBe(f.buffer.editor);expect(editor.state.field(f.buffer.source!.field).raw).toBe(f.buffer.raw);expect(editor.state.field(fileConflictOriginal,false)).toBeUndefined();
  expect(f.buffer.conflict).toBe(false);expect(readFileSync(f.path,'utf8')).toBe(action==='keepLocal'?data.local:data.disk);expect(f.buffer.dirty).toBe(action==='continueEditing');
  rows.push({caseId:'M9-T-H33',scenario:'explicit-resolution-editor-coherence',action,raw:f.buffer.raw,disk:readFileSync(f.path,'utf8'),dirty:f.buffer.dirty,baseHash:f.buffer.baseHash,calls:f.calls});
 });
});
