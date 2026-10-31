import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { FileService } from './file-service';
import { FileRootsService } from './roots';
import { FileRecoveryStore } from './recovery-store';
import { NativeFileBroker, type BrokerOptions } from './native-broker';
import { createFileController } from './controller';

const native=vi.hoisted(()=>({choose:vi.fn()}));
vi.mock('electron',()=>({BrowserWindow:{fromWebContents:()=>({isDestroyed:()=>false})},dialog:{showSaveDialog:(...args:unknown[])=>native.choose(...args)},shell:{}}));
const rows:unknown[]=[],sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('E08 controller/real native readonly attachment copy',()=>{
  it('cleans only the suggested filename, makes cancellation write nothing, requires a fresh native selection for overwrite and never overwrites the readonly original',async()=>{
    const base=await mkdtemp('/private/tmp/willyou-copy-selection-I-'),root=join(base,'project'),userdata=join(base,'userdata');await mkdir(root);await mkdir(userdata);
    const sourceName='attachment:中文|?.txt',source=join(root,sourceName),destination=join(root,'attachment_中文__ 副本.txt'),bytes=Buffer.from('E08 original readonly attachment 中文🙂\r\n'.repeat(512));await writeFile(source,bytes);await chmod(source,0o444);
    const operations:string[]=[];
    class ObservedBroker extends NativeFileBroker {override request<T>(input:Record<string,unknown>,options:BrokerOptions={}):Promise<T>{operations.push(String(input.operation));return super.request<T>(input,options);}}
    const broker=new ObservedBroker(process.env.SMARTDD_M9_FILE_BROKER!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'E08',path:root,label:'E08 public fixture'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));
    const sender=Object.assign(new EventEmitter(),{id:4,mainFrame:{processId:13,routingId:9},isDestroyed:()=>false,send:()=>{}}),event={sender,senderFrame:sender.mainFrame}as unknown as IpcMainInvokeEvent,owner='4:13:9',controller=createFileController(files,()=>true);
    const handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();
    registerRPCRouter({files:controller},{handle:(channel:string,handler:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(channel,handler)}as unknown as IpcMain);
    const saveCopy=handlers.get('files.saveCopy')!;
    const disk=async(p:string)=>{const s=await stat(p,{bigint:true});return{hash:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),bytes:String(s.size)}};
    try{
      const scope=(await files.openScope(owner,{kind:'project',projectId:'E08'})).roots[0],file=await files.open(owner,{lease:scope.lease,generation:scope.generation,relativePath:sourceName,readOnly:true,attachment:{mimeType:'text/plain'}});expect(file.writable).toBe(false);const before=await disk(source),request={target:{kind:'document' as const,ref:file.ref}};
      native.choose.mockResolvedValueOnce({canceled:true,filePath:''});expect(await saveCopy(event,request)).toEqual({state:'cancelled'});await expect(stat(destination)).rejects.toMatchObject({code:'ENOENT'});expect(operations.filter(x=>x==='copy')).toHaveLength(0);expect(await disk(source)).toEqual(before);
      native.choose.mockResolvedValueOnce({canceled:false,filePath:destination});const saved=await saveCopy(event,request);expect(saved).toMatchObject({state:'saved',path:destination,hash:sha(bytes)});expect(await readFile(destination)).toEqual(bytes);expect(await disk(source)).toEqual(before);
      await writeFile(destination,'E08 existing destination protected until native selection\n');const old=await disk(destination);native.choose.mockResolvedValueOnce({canceled:true,filePath:destination});expect(await saveCopy(event,request)).toEqual({state:'cancelled'});expect(await disk(destination)).toEqual(old);expect(operations.filter(x=>x==='copy')).toHaveLength(1);
      native.choose.mockResolvedValueOnce({canceled:false,filePath:destination});expect(await saveCopy(event,request)).toMatchObject({state:'saved',hash:sha(bytes)});expect(await readFile(destination)).toEqual(bytes);expect(await disk(source)).toEqual(before);expect(operations.filter(x=>x==='copy')).toHaveLength(2);
      native.choose.mockResolvedValueOnce({canceled:false,filePath:source});await expect(saveCopy(event,request)).rejects.toMatchObject({code:'CONFLICT'});expect(await disk(source)).toEqual(before);
      const options=native.choose.mock.calls.map(x=>x[1]);expect(options.every(x=>x.defaultPath===destination&&x.properties.includes('showOverwriteConfirmation'))).toBe(true);
      await expect(files.save(owner,{ref:file.ref,opId:randomUUID(),baseHash:file.revision.hash,base64:Buffer.from('must not write').toString('base64'),bufferVersion:1})).rejects.toMatchObject({code:'PERMISSION'});expect(await disk(source)).toEqual(before);
      rows.push({base,source:before,destinationBeforeCancellation:old,destinationFinal:await disk(destination),saved,nativeSelections:5,originalNativeCopies:2,sourceOverwriteRejected:true,readonlyWriteRejected:true,options,boundary:'Controller dialog is explicit isolated chooser stub;original native/FileService/auth/atomic copy and exact bytes run. Actual system cancel/replace dialog covered independently by A.'});
    }finally{files.closeOwner(owner);await files.watcher.dispose();broker.dispose();}
  },30000);
});
afterAll(async()=>{if(process.env.SMARTDD_E08_EVIDENCE)await writeFile(process.env.SMARTDD_E08_EVIDENCE,JSON.stringify({at:new Date().toISOString(),rows},null,2)+'\n')});
