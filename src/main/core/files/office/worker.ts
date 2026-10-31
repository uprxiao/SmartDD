import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FileError } from '@shared/files';
import { OFFICE_LIMITS, officeWindowSchema, officeCellEditSchema, officeSheetActionSchema,officeRangeActionSchema,officeRangeSchema,officeDrawingImageSchema } from '@shared/file-office';
import { OfficePackage } from './package';
import { OfficeDocument } from './document';
import { readOfficeRange } from './range';
import { officeMeasureResultSchema } from '@shared/office-measure';
import {pptxImageReceiptSchema} from './pptx-image';

const index = z.number().int().nonnegative(), sheetId = z.string().min(1).max(64);
const requestSchema = z.discriminatedUnion('method', [
  z.object({ id: index, method: z.literal('open'), bytes: z.instanceof(Uint8Array), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  officeWindowSchema.extend({ id: index, method: z.literal('window') }),
  officeDrawingImageSchema.extend({id:index,method:z.literal('drawingImage')}),
  z.object({ id: index, method: z.literal('cell'), sheetId, row: index.max(1048575), column: index.max(16383), start: index, length: index.min(1).max(OFFICE_LIMITS.cellCharacters) }).strict(),
  z.object({ id: index, method: z.literal('prepareCalculation') }).strict(),
  z.object({ id: index, method: z.literal('applyCalculation'), bytes: z.instanceof(Uint8Array), inputHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ id: index, method: z.literal('state') }).strict(),
  z.object({ id: index, method: z.literal('edit'), version: index, edit: officeCellEditSchema }).strict(),
  z.object({id:index,method:z.literal('sheetAction'),version:index,action:officeSheetActionSchema}).strict(),
  z.object({id:index,method:z.literal('range'),sheetId,range:officeRangeSchema,text:z.boolean()}).strict(),
  z.object({id:index,method:z.literal('fontMetric'),metric:z.object({digitWidth:z.number().int().min(1).max(1024),measured:z.boolean(),message:z.string().max(500).optional()}).strict()}).strict(),
  z.object({id:index,method:z.literal('prepareFit'),version:index,action:officeRangeActionSchema}).strict(),
  z.object({id:index,method:z.literal('prepareRange'),version:index,action:officeRangeActionSchema,measured:officeMeasureResultSchema.optional(),imageReceipt:pptxImageReceiptSchema.optional()}).strict(),
  z.object({id:index,method:z.literal('commitRange'),version:index,token:z.string().uuid()}).strict(),
  z.object({id:index,method:z.literal('cancelRange'),token:z.string().uuid()}).strict(),
  z.object({ id: index, method: z.literal('history'), version: index, direction: z.enum(['undo', 'redo']) }).strict(),
  z.object({ id: index, method: z.literal('materialize'), version: index }).strict(),
  z.object({ id:index,method:z.literal('verify'),version:index,bytes:z.instanceof(Uint8Array),hash:z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ id: index, method: z.literal('validationFormulas'), version: index }).strict(),
  z.object({ id: index, method: z.literal('acknowledge'), version: index, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ id: index, method: z.literal('restore'), version: index, bytes: z.instanceof(Uint8Array) }).strict(),
]);
let document: OfficeDocument | undefined, opening = false, queue = Promise.resolve();
parentPort!.on('message', (input: unknown) => {
  queue = queue.then(async () => {
    const rawId = input && typeof input === 'object' && 'id' in input ? input.id : undefined;
    let id = Number.isSafeInteger(rawId) ? rawId as number : -1;
    try {
      const message = requestSchema.parse(input); id = message.id;
      let result: unknown;
      if (message.method === 'open') {
        if (opening) throw new FileError('IDEMPOTENCY', 'Office 解析实例已打开过文件');
        opening = true;
        if (message.bytes.byteLength > OFFICE_LIMITS.inputBytes) throw new FileError('TOO_LARGE', 'Office 文件超过 40 MiB');
        if (createHash('sha256').update(message.bytes).digest('hex') !== message.hash) throw new FileError('CHANGED', 'Office 输入内容与基线不一致');
        document = new OfficeDocument(await OfficePackage.read(message.bytes)); result = document.workbook.info;
      } else {
        if (!document) throw new FileError('UNTRUSTED', 'Office 文档尚未打开');
        const workbook = document.workbook;
        if (message.method === 'window') result = workbook.window(message.sheetId, message.row, message.column, message.rows, message.columns, message.rowIndices, message.columnIndices);
        else if(message.method==='drawingImage')result=workbook.drawingImage(message.sheetId,message.objectId,message.mediaHash);
        else if (message.method === 'cell') result = workbook.cellText(message.sheetId, message.row, message.column, message.start, message.length);
        else if (message.method === 'prepareCalculation') result = await document.prepareCalculation();
        else if (message.method === 'applyCalculation') result = (await document.applyCalculation(message.bytes, message.inputHash)).workbook;
        else if (message.method === 'state') result = document.state();
        else if (message.method === 'edit') result = document.edit(message.version, message.edit);
        else if (message.method === 'sheetAction') result=document.sheetAction(message.version,message.action);
        else if (message.method === 'range') result=readOfficeRange(workbook,message.sheetId,message.range,message.text);
        else if (message.method === 'fontMetric') result=document.setFontMetric(message.metric);
        else if (message.method === 'prepareFit') result=document.prepareFit(message.version,message.action);
        else if (message.method === 'prepareRange') result=await document.prepareRange(message.version,message.action,message.measured,message.imageReceipt);
        else if (message.method === 'commitRange') result=document.commitRange(message.version,message.token);
        else if (message.method === 'cancelRange') result=document.cancelRange(message.token);
        else if (message.method === 'history') result = document.undo(message.version, message.direction);
        else if (message.method === 'materialize') result = await document.materialize(message.version);
        else if(message.method === 'verify')result=await document.verify(message.version,message.bytes,message.hash);
        else if (message.method === 'validationFormulas') result = document.validationFormulas(message.version);
        else if (message.method === 'acknowledge') result = document.acknowledge(message.version, message.hash);
        else result = document.restore(message.version, await OfficePackage.read(message.bytes));
      }
      parentPort!.postMessage({ id, result });
    } catch (error) { parentPort!.postMessage({ id, error: { code: error instanceof FileError ? error.code : 'INVALID_INPUT', message: error instanceof Error ? error.message.slice(0, 4096) : 'Office 解析失败' } }); }
  });
});
