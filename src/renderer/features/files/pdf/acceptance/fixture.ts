import {randomUUID} from 'node:crypto';
import {vi} from 'vitest';
import type {FileDocument} from '@shared/files';
import {FileTerminalContextStore,registerFileTerminal,textFingerprint} from '@renderer/features/files/terminal-context/store';
export const disposers:Array<()=>void>=[];
export const pdf=(page=2,anchor={x:0.125,y:0.25,width:0.375,height:0.5})=>({page,anchor:{...anchor}});
export const selection=(page=2,anchor?:{x:number;y:number;width:number;height:number},comment='请核对绿色区域')=>({pdf:pdf(page,anchor),text:'选中文字🙂',version:0,instance:'real-pdf-buffer',selectedTextHash:textFingerprint('选中文字🙂'),current:()=>true,comment});
export const payload=(page=2,anchor?:{x:number;y:number;width:number;height:number})=>({sourceId:randomUUID(),kind:'pdf-comment',pdf:pdf(page,anchor),comment:'请核对绿色区域',text:'选中文字🙂'});
export function fixture(){
 const root:any={lease:randomUUID(),generation:1,source:'task-cwd',sourceId:'task',path:'/tmp/g049-project',canonicalPath:'/tmp/g049-project',label:'Own PDF root',identity:{device:'1',inode:'2'},capabilities:{pdfAnnotations:true,pdfAnnotationBatching:false}};
 const file:FileDocument={ref:{id:randomUUID(),lease:root.lease,generation:1},documentKey:'local:1:3',name:'evidence.pdf',relativePath:'evidence.pdf',absolutePath:'/tmp/g049-project/evidence.pdf',writable:false,revision:{device:'1',inode:'3',size:64,hash:'a'.repeat(64),modifiedNs:'1',changedNs:'1'},content:{kind:'pdf',mime:'application/pdf'}as never};
 const opened:FileDocument[]=[];
 const api={open:vi.fn(async(_path:any)=>{const value={...file,ref:{...file.ref,id:randomUUID()}};opened.push(value);return value;}),closeDocument:vi.fn(async(_ref:any)=>undefined),refresh:vi.fn(async()=>file),terminalBind:vi.fn(async()=>({id:randomUUID(),taskId:'task',ptyId:'pty',lease:root.lease,generation:1})),terminalRelease:vi.fn(async()=>undefined),terminalPrepare:vi.fn(async(_input:any)=>({id:randomUUID(),relativePath:file.relativePath,revision:file.revision,identity:{device:'1',inode:'3'}})),terminalInsert:vi.fn(async(input:any)=>({operationId:input.operationId,state:'inserted',characters:40,removed:0,replaced:0,truncated:0,stale:[],bracketed:false}))};
 const store=new FileTerminalContextStore(api as never);store.setRoot(root);disposers.push(store.attach());const target={taskId:'task',ptyId:'pty',focus:vi.fn()};disposers.push(registerFileTerminal(target));
 return{root,file,api,store,target,opened,path:{lease:root.lease,generation:1,relativePath:file.relativePath}};
}
export function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
export function numericTokens(text:string){return(text.match(/\d+(?:\.\d+)?/g)||[]).map(Number);}
