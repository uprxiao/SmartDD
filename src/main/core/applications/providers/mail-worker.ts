import { parentPort } from 'node:worker_threads';
import { z } from 'zod';
import { foxmailConfigSchema, verifiedConnectionIdentitySchema } from '@shared/application-connections';
import { mailSearchSchema } from '@shared/application-mail';
import { ApplicationError } from '@shared/applications';
import { FoxmailSource } from './foxmail-source';
const port = parentPort!;
const base = { id: z.number().int().positive(), config: foxmailConfigSchema };
const requestSchema = z.discriminatedUnion('method',[
  z.object({ ...base, method: z.literal('verify') }).strict(),
  z.object({ ...base, method: z.literal('query'), search: mailSearchSchema, expected: verifiedConnectionIdentitySchema, now: z.iso.datetime() }).strict(),
  z.object({ ...base, method: z.literal('read'), mailId: z.string(), expected: verifiedConnectionIdentitySchema, now: z.iso.datetime() }).strict(),
  z.object({ ...base, method: z.literal('attachment'), mailId: z.string(), attachmentId: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), expected: verifiedConnectionIdentitySchema, now: z.iso.datetime() }).strict(),
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
      const result = message.method === 'verify' ? await source.verify(message.config) : message.method === 'query' ? await source.query(message.config,message.search,message.expected,new Date(message.now)) : message.method === 'read' ? await source.read(message.config,message.mailId,message.expected,new Date(message.now)) : await source.attachment(message.config,message.mailId,message.attachmentId,message.hash,message.expected,new Date(message.now));
      port.postMessage({ type: 'result', id, result });
    } catch (error) { port.postMessage({ type: 'result', id, error: { code: error instanceof ApplicationError ? error.code : 'SOURCE_UNAVAILABLE', message: error instanceof ApplicationError ? error.message : '邮件读取或解析未完成' } }); }
    finally { active = 0; }
  });
});
