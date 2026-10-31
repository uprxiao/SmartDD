import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FileError } from '@shared/files';
import { OFFICE_LIMITS } from '@shared/file-office';
import { pptxActionSchema } from '@shared/file-pptx';
import { OfficePackage } from './package';
import { PptxDocument } from './pptx-document';
import { pptxImageReceiptSchema } from './pptx-image';

const id=z.number().int().positive(),version=z.number().int().nonnegative(),bytes=z.instanceof(Uint8Array),hash=z.string().regex(/^[a-f0-9]{64}$/);
const schema=z.discriminatedUnion('method',[
  z.object({id,method:z.literal('open'),bytes,hash}).strict(),
  z.object({id,method:z.literal('state')}).strict(),
  z.object({id,method:z.literal('edit'),version,action:pptxActionSchema,image:pptxImageReceiptSchema.optional()}).strict(),
  z.object({id,method:z.literal('history'),version,direction:z.enum(['undo','redo'])}).strict(),
  z.object({id,method:z.literal('materialize'),version}).strict(),
  z.object({id,method:z.literal('verify'),version,bytes,hash}).strict(),
  z.object({id,method:z.literal('preview-source'),version}).strict(),
  z.object({id,method:z.literal('acknowledge'),version,hash}).strict(),
  z.object({id,method:z.literal('restore'),version,bytes}).strict(),
  z.object({id,method:z.literal('table-layout-source'),version}).strict(),
  z.object({id,method:z.literal('table-layout'),version,bytes}).strict(),
]);
let document:PptxDocument|undefined,opened=false,queue=Promise.resolve();
parentPort!.on('message',(raw:unknown)=>{
  queue=queue.then(async()=>{
    const id=raw&&typeof raw==='object'&&'id' in raw&&Number.isSafeInteger(raw.id)?raw.id:-1;
    try{
      const input=schema.parse(raw);let result:unknown;
      if(input.method==='open'){
        if(opened)throw new FileError('IDEMPOTENCY','演示文稿实例已使用');opened=true;
        if(input.bytes.length>OFFICE_LIMITS.inputBytes)throw new FileError('TOO_LARGE','演示文稿超过 40 MiB');
        if(createHash('sha256').update(input.bytes).digest('hex')!==input.hash)throw new FileError('CHANGED','演示文稿与读取基线不一致');
        document=new PptxDocument(await OfficePackage.read(input.bytes));result=document.state();
      }else{
        if(!document)throw new FileError('UNTRUSTED','演示文稿尚未打开');
        switch(input.method){
          case 'state':result=document.state();break;
          case 'edit':result=input.action.type==='chart-values'||input.action.type==='chart-insert'||input.action.type==='chart-type'?await document.editChartValues(input.version,input.action):document.edit(input.version,input.action,input.image);break;
          case 'history':result=document.history(input.version,input.direction);break;
          case 'materialize':result=await document.materialize(input.version);break;
          case 'verify':result=await document.verify(input.version,input.bytes,input.hash);break;
          case 'preview-source':result=await document.previewSource(input.version);break;
          case 'acknowledge':result=document.acknowledge(input.version,input.hash);break;
          case 'restore':result=document.restore(input.version,await OfficePackage.read(input.bytes));break;
          case 'table-layout-source':result=await document.tableLayoutSource(input.version);break;
          case 'table-layout':result=document.tableLayout(input.version,input.bytes);break;
        }
      }
      parentPort!.postMessage({id,result});
    }catch(error){parentPort!.postMessage({id,error:{code:error instanceof FileError?error.code:'INVALID_INPUT',message:error instanceof Error?error.message.slice(0,4096):'演示文稿处理失败'}});}
  });
});
