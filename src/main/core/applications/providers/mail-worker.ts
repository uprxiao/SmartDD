import { parentPort } from 'node:worker_threads';
import { z } from 'zod';
import { foxmailConfigSchema, verifiedConnectionIdentitySchema } from '@shared/application-connections';
import { mailSearchSchema } from '@shared/application-mail';
import { ApplicationError } from '@shared/applications';
import { FoxmailSource } from './foxmail-source';
const port = parentPort!;
const base = { id: z.number().int().positive(), config: foxmailConfigSchema };
const summarySchema=z.object({id:z.string().regex(/^\d{1,20}$/),subject:z.string().max(8192),from:z.string().max(2000),to:z.string().max(8192),date:z.iso.datetime(),messageId:z.string().max(2000).nullable(),sourceRevision:z.string().regex(/^[a-f0-9]{64}$/),hasAttachments:z.boolean()}).strict();
const indexSchema=z.object({id:z.string().regex(/^\d{1,20}$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),summary:summarySchema,searchText:z.string().max(16*1024*1024).nullable()}).strict();
const requestSchema = z.discriminatedUnion('method',[
  z.object({ ...base, method: z.literal('verify') }).strict(),
  z.object({...base,method:z.literal('scan.begin'),expected:verifiedConnectionIdentitySchema,now:z.iso.datetime()}).strict(),
  z.object({...base,method:z.literal('scan.entries'),scanId:z.uuid(),offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(100)}).strict(),
  z.object({...base,method:z.literal('scan.batch'),scanId:z.uuid(),offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(100),text:z.string().max(1000),reuse:z.array(indexSchema).max(100).default([])}).strict(),
  z.object({...base,method:z.literal('scan.summaries'),scanId:z.uuid(),items:z.array(z.object({id:z.string().regex(/^\d{1,20}$/),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(200)}).strict(),
  z.object({...base,method:z.literal('scan.finish'),scanId:z.uuid()}).strict(),
  z.object({ ...base, method: z.literal('query'), search: mailSearchSchema, expected: verifiedConnectionIdentitySchema, now: z.iso.datetime() }).strict(),
  z.object({ ...base, method: z.literal('read'), mailId: z.string(), expected: verifiedConnectionIdentitySchema, now: z.iso.datetime() }).strict(),
  z.object({ ...base, method: z.literal('attachment'), mailId: z.string(), attachmentId: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), expectedMailRevision:z.string().regex(/^[a-f0-9]{64}$/).optional(), expected: verifiedConnectionIdentitySchema, now: z.iso.datetime() }).strict(),
]);
let sequence = 0, active = 0, queue = Promise.resolve();
const metadata = new Map<number,{ resolve(value: string): void; reject(error: Error): void }>();
const source = new FoxmailSource(path => new Promise<string>((resolve,reject) => { const metadataId = ++sequence; metadata.set(metadataId,{ resolve,reject }); port.postMessage({ type: 'metadata', id: active, metadataId, path }); }));
port.on('message',(input: unknown) => {
  if (input && typeof input === 'object' && 'type' in input && input.type === 'metadata-result') {
    const v = z.object({ type: z.literal('metadata-result'), metadataId: z.number().int().positive(), output: z.string().optional(), failed: z.boolean().optional() }).parse(input), pending = metadata.get(v.metadataId); if (!pending) return; metadata.delete(v.metadataId);
    if (v.failed) pending.reject(new ApplicationError('SOURCE_UNAVAILABLE','Foxmail原生读取未完成')); else pending.resolve(v.output!); return;
  }
  queue = queue.then(async () => {
    const rawId = input && typeof input === 'object' && 'id' in input ? input.id : -1;
    let id = typeof rawId === 'number' && Number.isSafeInteger(rawId) ? rawId : -1;
    try {
      const message = requestSchema.parse(input); active = id = message.id;
      const result = message.method==='scan.begin'?await source.beginScan(message.config,message.expected,new Date(message.now)):message.method==='scan.entries'?source.scanEntries(message.config,message.scanId,message.offset,message.limit):message.method==='scan.batch'?await source.scanBatch(message.config,message.scanId,message.offset,message.limit,message.text,message.reuse):message.method==='scan.summaries'?await source.scanSummaries(message.config,message.scanId,message.items):message.method==='scan.finish'?await source.finishScan(message.config,message.scanId):message.method === 'verify' ? await source.verify(message.config) : message.method === 'query' ? await source.query(message.config,message.search,message.expected,new Date(message.now)) : message.method === 'read' ? await source.read(message.config,message.mailId,message.expected,new Date(message.now)) : await source.attachment(message.config,message.mailId,message.attachmentId,message.hash,message.expected,new Date(message.now),message.expectedMailRevision);
      port.postMessage({ type: 'result', id, result });
    } catch (error) { port.postMessage({ type: 'result', id, error: { code: error instanceof ApplicationError ? error.code : 'SOURCE_UNAVAILABLE', message: error instanceof ApplicationError ? error.message : '邮件读取或解析未完成' } }); }
    finally { active = 0; }
  });
});
