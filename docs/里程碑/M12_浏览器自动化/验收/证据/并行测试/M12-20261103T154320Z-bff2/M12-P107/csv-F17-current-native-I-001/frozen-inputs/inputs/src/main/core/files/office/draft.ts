import { z } from 'zod';
import { FILE_LIMITS, FileError } from '@shared/files';
import { OFFICE_LIMITS, officeCellEditSchema, type OfficeCellEdit } from '@shared/file-office';
import {workbookTextEditSchema,type WorkbookTextEdit} from '@shared/file-workbook-drawing';

const magic = Buffer.from('WYOFFICE1\n');
const metadata = z.object({ schema: z.literal(1), bytes: z.number().int().positive().max(OFFICE_LIMITS.outputBytes), pending: officeCellEditSchema.optional(),pendingDrawing:workbookTextEditSchema.optional() }).strict();
/** Binary recovery envelope: exact OOXML bytes plus uncommitted formula input.
 * It is private recovery data and can never be used directly as a save candidate. */
export function encodeOfficeDraft(bytes: Uint8Array, pending?: OfficeCellEdit,pendingDrawing?:WorkbookTextEdit): Buffer {
  const info = metadata.parse({ schema:1, bytes:bytes.length, ...(pending ? { pending } : {}),...(pendingDrawing?{pendingDrawing}:{}) }), header = Buffer.from(JSON.stringify(info));
  if (header.length > 256 * 1024) throw new FileError('TOO_LARGE', 'Office 草稿输入超过预算');
  const length = Buffer.alloc(4); length.writeUInt32LE(header.length);
  return Buffer.concat([magic, length, header, bytes]);
}
export function decodeOfficeDraft(value: Uint8Array): { bytes: Buffer; pending?: OfficeCellEdit;pendingDrawing?:WorkbookTextEdit } {
  const bytes = Buffer.from(value);
  if (bytes.length > FILE_LIMITS.officeDraft || bytes.length < magic.length + 4 || !bytes.subarray(0,magic.length).equals(magic)) throw new FileError('INVALID_INPUT', 'Office 草稿格式无效');
  const length = bytes.readUInt32LE(magic.length), start = magic.length + 4;
  if (length > 256 * 1024 || start + length >= bytes.length) throw new FileError('INVALID_INPUT', 'Office 草稿长度无效');
  let info: z.infer<typeof metadata>;
  try { info = metadata.parse(JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes.subarray(start,start+length)))); }
  catch { throw new FileError('INVALID_INPUT', 'Office 草稿元数据无效'); }
  const document = bytes.subarray(start+length);
  if (document.length !== info.bytes) throw new FileError('INVALID_INPUT', 'Office 草稿内容长度不一致');
  return { bytes:document, ...(info.pending ? { pending:info.pending } : {}),...(info.pendingDrawing?{pendingDrawing:info.pendingDrawing}:{}) };
}
