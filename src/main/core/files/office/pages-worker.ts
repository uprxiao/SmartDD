import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FileError } from '@shared/files';
import { OFFICE_LIMITS } from '@shared/file-office';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { pptxChartPreviewSource } from './pptx-chartex-preview';
import { assertOfficePreviewSupported } from './preview-capabilities';
const schema=z.object({id:z.number().int().nonnegative(),method:z.enum(['inspect','prepare']),bytes:z.instanceof(Uint8Array),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
let opened=false;
parentPort!.on('message',async(raw:unknown)=>{
  const id=raw&&typeof raw==='object'&&'id' in raw&&Number.isSafeInteger(raw.id)?raw.id:-1;
  try {
    const input=schema.parse(raw);if(opened)throw new FileError('IDEMPOTENCY','文档解析实例已使用');opened=true;
    if(input.bytes.length>OFFICE_LIMITS.inputBytes)throw new FileError('TOO_LARGE','Office 文档超过 40 MiB');
    if(createHash('sha256').update(input.bytes).digest('hex')!==input.hash)throw new FileError('CHANGED','Office 文档与读取基线不一致');
    const model=new OfficePagesModel(await OfficePackage.read(input.bytes));
    if(input.method==='inspect')parentPort!.postMessage({id,result:model.info});
    else{
      let previewBytes:Uint8Array|undefined;
      if(model.info.kind==='pptx'){const projected=await pptxChartPreviewSource(model);if(projected!==model.packageData)previewBytes=await projected.bytes();}
      else assertOfficePreviewSupported(model.info);
      parentPort!.postMessage({id,result:{info:model.info,...(previewBytes?{previewBytes}:{})}});
    }
  } catch(error){parentPort!.postMessage({id,error:{code:error instanceof FileError?error.code:'INVALID_INPUT',message:error instanceof Error?error.message.slice(0,4096):'Office 文档解析失败'}});}
});
