// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import type { FileScope, PathRequest, FileRef } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
import { WorkspaceTree } from './workspace-tree';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: vi.fn(async () => ({ id: 'fixture', apps: [], preferredUnavailable: false })) } }, events: { on: () => () => undefined } }));
const evidence: unknown[] = [], fixtures: { dispose(): Promise<void> }[] = [];
const names=['10.txt','2.txt','a.txt','A-upper.txt','a2.txt','a10.txt','ä.txt','z.txt','中.txt','中文.txt','prefix.txt','tie.txt','ti\u200be.txt'], dirs=['prefix','z','ä','中'];
async function fixture() {
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-tree-policy-i-')), rootPath=join(base,'root'); mkdirSync(rootPath);mkdirSync(join(base,'userdata'));
 for(const d of dirs){mkdirSync(join(rootPath,d));writeFileSync(join(rootPath,d,'child.txt'),'Child '+d)} for(const name of names)writeFileSync(join(rootPath,name),'Source '+name);
 const broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!), raw: {name:string;kind:string}[][]=[], operations:string[]=[], original=broker.request.bind(broker);
 broker.request=async(input,options)=>{operations.push(String(input.operation));const result=await original<any>(input,options);if(input.operation==='list'&&input.relativePath==='')raw.push(result.entries.map((e: {name:string;kind:string})=>({name:e.name,kind:e.kind})));return result};
 const resolver={sources:()=>[{kind:'project-directory' as const,id:'root',path:rootPath,label:'Tree policy',projectId:'policy'}]}, service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));
 const api={roots:(scope:FileScope)=>service.openScope('policy',scope),list:(input:PathRequest)=>service.list('policy',input),open:(input:PathRequest)=>service.open('policy',input),read:(ref:FileRef)=>service.read('policy',ref),refresh:(ref:FileRef)=>service.refresh('policy',ref),drafts:(ref:FileRef)=>service.drafts('policy',ref),closeDocument:async(ref:FileRef)=>service.closeDocument('policy',ref),closeScope:async(scope:FileScope)=>service.closeScope('policy',scope)};
 const store=new FileWorkspaceStore({kind:'project',projectId:'policy'},api as unknown as FileClient,null,null);await store.initialize();vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(700);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}});
 function View(){useSyncExternalStore(store.subscribe,store.snapshot);return <WorkspaceTree store={store} run={f=>{void f()}}/>};render(<View/>);
 const fingerprints=()=>Object.fromEntries([...names,...dirs.map(x=>x+'/child.txt')].map(path=>{const file=join(rootPath,path),s=statSync(file,{bigint:true});return[path,{hash:createHash('sha256').update(readFileSync(file)).digest('hex'),inode:String(s.ino),mtimeNs:String(s.mtimeNs)}]}));
 const f={base,rootPath,store,service,raw,operations,fingerprints,dispose:async()=>{cleanup();store.dispose();service.closeOwner('policy');await service.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true})}};fixtures.push(f);return f;
}
afterEach(async()=>{for(const f of fixtures.splice(0))await f.dispose();vi.restoreAllMocks();vi.unstubAllGlobals()});
afterAll(()=>{if(process.env.SMARTDD_TREE_POLICY_EVIDENCE)writeFileSync(process.env.SMARTDD_TREE_POLICY_EVIDENCE,JSON.stringify({at:new Date().toISOString(),locale:Intl.Collator().resolvedOptions().locale,native:process.env.SMARTDD_M9_FILE_BROKER,boundary:'I: real native list/read, FileService/store and actual tree/context components. Only jsdom geometry/ResizeObserver and application discovery isolated; no actual OS drag/native App claim.',evidence},null,2)+'\n')});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('B03/B21 ordinary tree policy with actual native IO',()=>{
 it('B03 follows the actual process locale and preserves real native tie input order on refresh',async()=>{
  const f=await fixture(),root=f.store.treeRoot!,collator=new Intl.Collator(),snapshots:string[][]=[],before=f.fingerprints();expect(collator.compare('tie.txt','ti\u200be.txt')).toBe(0);
  for(let turn=0;turn<3;turn++){
   if(turn)await act(async()=>{await f.store.list(root,'',true)});const state=f.store.directories.get(f.store.directoryKey(root,''))!;expect(state.state).toBe('ready');if(state.state!=='ready')throw Error('Not ready');
   const entries=state.entries, boundary=entries.findIndex(e=>e.kind!=='directory');expect(entries.slice(0,boundary).map(e=>e.name)).toHaveLength(dirs.length);expect(entries.slice(boundary)).toHaveLength(names.length);
   for(const group of [entries.slice(0,boundary),entries.slice(boundary)])for(let i=1;i<group.length;i++)expect(collator.compare(group[i-1].name,group[i].name)).toBeLessThanOrEqual(0);
   const tie=(values:{name:string}[])=>values.filter(e=>['tie.txt','ti\u200be.txt'].includes(e.name)).map(e=>e.name);expect(tie(entries)).toEqual(tie(f.raw.at(-1)!));
   const dom=screen.getAllByRole('treeitem').map(e=>e.textContent!);expect(dom).toEqual(entries.map(e=>e.name));snapshots.push(dom);
  }
  expect(snapshots[1]).toEqual(snapshots[0]);expect(snapshots[2]).toEqual(snapshots[0]);expect(f.fingerprints()).toEqual(before);evidence.push({caseId:'M9-T-B03',locale:collator.resolvedOptions().locale,nativeInputs:f.raw,snapshots,tieEquality:0,sourceUnchanged:true});
 });
 it('B21 F2, file-to-folder drop and the real file context menu cannot rename or move sources',async()=>{
  const f=await fixture(),before=f.fingerprints(),user=userEvent.setup();const file=screen.getByRole('treeitem',{name:'2.txt'}),folder=screen.getByRole('treeitem',{name:'prefix'});await user.click(file);await waitFor(()=>expect(f.store.active?.buffer?.raw).toBe('Source 2.txt'));
  fireEvent.keyDown(file,{key:'F2',code:'F2'});expect(document.querySelector('.fw-tree-region input,.fw-tree-region [contenteditable=true]')).toBeNull();
  const transfer={setData:vi.fn(),getData:vi.fn(()=>''),types:[]};fireEvent.dragStart(file,{dataTransfer:transfer});fireEvent.dragOver(folder,{dataTransfer:transfer});fireEvent.drop(folder,{dataTransfer:transfer});fireEvent.dragEnd(file,{dataTransfer:transfer});
  fireEvent.contextMenu(file,{clientX:20,clientY:30});await screen.findByRole('menu');const menu=screen.getAllByRole('menuitem').map(e=>e.textContent);expect(menu.some(x=>/新建|新增|删除|重命名|移动/.test(x!))).toBe(false);expect(f.fingerprints()).toEqual(before);expect(f.operations.some(x=>['write','save','rename','remove','move','delete','mkdir'].includes(x))).toBe(false);
  evidence.push({caseId:'M9-T-B21',menu,nativeOperations:f.operations,transferIssued:transfer.setData.mock.calls,sourceUnchanged:true,boundary:'Component input and API audit only; physical pointer drag is separately exercised in packaged App.'});
 });
});
