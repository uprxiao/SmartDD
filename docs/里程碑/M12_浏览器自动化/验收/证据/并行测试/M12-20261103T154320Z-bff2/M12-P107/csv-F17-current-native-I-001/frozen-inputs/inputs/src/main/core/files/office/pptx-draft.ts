import { z } from 'zod';
import { FILE_LIMITS,FileError } from '@shared/files';
import { OFFICE_LIMITS } from '@shared/file-office';
import { pptxLegacyPendingSchema,pptxPendingBatchSchema,pptxPendingInputs,type PptxPendingInput } from '@shared/file-pptx';

const magic=Buffer.from('WYPPTX1\n');
const magic2=Buffer.from('WYPPTX2\n');
const magic3=Buffer.from('WYPPTX3\n');
const magic4=Buffer.from('WYPPTX4\n');
const documentBytes=z.number().int().positive().max(OFFICE_LIMITS.outputBytes);
const metadata=z.object({schema:z.literal(1),bytes:documentBytes,pending:pptxLegacyPendingSchema.omit({elementId:true}).optional()}).strict();
const metadata2=z.object({schema:z.literal(2),bytes:documentBytes,pending:z.array(pptxLegacyPendingSchema).min(1).max(128).pipe(pptxPendingBatchSchema).optional()}).strict();
const metadata3=z.object({schema:z.literal(3),bytes:documentBytes,pending:pptxPendingBatchSchema.refine(inputs=>inputs.every(input=>!input.chartValues)).optional()}).strict();
const metadata4=z.object({schema:z.literal(4),bytes:documentBytes,pending:pptxPendingBatchSchema.optional()}).strict();
/** Recovery is an envelope, never a file candidate. Raw targeted composition is
 * saved separately from the last successfully edited OOXML package. */
export function encodePptxDraft(bytes:Uint8Array,pending?:PptxPendingInput):Buffer {
  const inputs=pptxPendingInputs(pending),header=Buffer.from(JSON.stringify(metadata4.parse({schema:4,bytes:bytes.length,...(inputs.length?{pending:inputs}:{})})));
  if(header.length>1024*1024-12)throw new FileError('TOO_LARGE','演示文稿草稿文字超过预算');
  const size=Buffer.alloc(4);size.writeUInt32LE(header.length);
  return Buffer.concat([magic4,size,header,bytes]);
}
export function decodePptxDraft(value:Uint8Array):{bytes:Buffer;pending?:PptxPendingInput}{
  const bytes=Buffer.from(value),start=magic.length+4;
  const legacy=bytes.subarray(0,magic.length).equals(magic);
  const previous=bytes.subarray(0,magic2.length).equals(magic2);
  const cells=bytes.subarray(0,magic3.length).equals(magic3);
  if(bytes.length>FILE_LIMITS.officeDraft||bytes.length<start||!legacy&&!previous&&!cells&&!bytes.subarray(0,magic4.length).equals(magic4))throw new FileError('INVALID_INPUT','演示文稿草稿格式无效');
  const length=bytes.readUInt32LE(magic.length);
  if(length>(legacy?256*1024:1024*1024-12)||start+length>=bytes.length)throw new FileError('INVALID_INPUT','演示文稿草稿长度无效');
  let info:z.infer<typeof metadata>|z.infer<typeof metadata2>|z.infer<typeof metadata3>|z.infer<typeof metadata4>;
  try{const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(start,start+length)));info=legacy?metadata.parse(json):previous?metadata2.parse(json):cells?metadata3.parse(json):metadata4.parse(json);}
  catch{throw new FileError('INVALID_INPUT','演示文稿草稿元数据无效');}
  const document=bytes.subarray(start+length);
  if(document.length!==info.bytes)throw new FileError('INVALID_INPUT','演示文稿草稿内容长度不一致');
  return {bytes:document,...(info.pending?{pending:info.pending}:{})};
}
