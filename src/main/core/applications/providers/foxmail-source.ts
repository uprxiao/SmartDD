import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import PostalMime, { type PostalMimeOptions, type Address, type Email } from 'postal-mime';
import { z } from 'zod';
import { foxmailConfigSchema, type ConnectionConfig, type VerifiedConnectionIdentity } from '@shared/application-connections';
import { ApplicationError } from '@shared/applications';
import { mailSearchSchema, type LocalMailContent, type LocalMailQuery, type LocalMailSummary, type MailDateRange, type MailSearch } from '@shared/application-mail';
import { canonicalJson, digest } from '../manifest';
type Config = Extract<ConnectionConfig, { kind: 'foxmail' }>;
const field = z.string().max(65536).nullable();
const metadataSchema = z.object({ schema: z.array(z.object({ name: z.string(), sql: z.string() })), databaseIdentity: z.string(), rows: z.array(z.object({ id: z.string().regex(/^\d{1,20}$/), subject: field, sender: field, recipients: field, messageid: field, sourceDate: field, receivedDate: field, fileexist: field, attachmentCount: field })).max(100000) }).strict();
type Metadata = z.infer<typeof metadataSchema>;
const statStamp = (s: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }) => [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
const day = (d: Date) => [d.getFullYear(),String(d.getMonth() + 1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
export function localMailRange(days: number, now = new Date()): MailDateRange {
  if (!Number.isInteger(days) || days < 1 || days > 100 || !Number.isFinite(now.getTime())) throw new ApplicationError('INVALID_INPUT', '邮件查询天数必须为1至100的整数');
  const end = new Date(now); end.setHours(0,0,0,0); end.setDate(end.getDate() + 1); const start = new Date(end); start.setDate(start.getDate() - days);
  return { days, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, startDate: day(start), endDate: day(now), start: start.toISOString(), endExclusive: end.toISOString() };
}
const mimeOptions: PostalMimeOptions = { maxNestingDepth: 32, maxHeadersSize: 256 * 1024, maxPartCount: 256, maxRfc822NestingDepth: 4, maxForwardedAddresses: 500, attachmentEncoding: 'arraybuffer' };
const addresses = (list: Address[] = []): string[] => list.flatMap(a => a.group ? addresses(a.group) : [a.address]);
async function readRegular(path: string, maxBytes: number, prefix = false): Promise<{ bytes: Buffer; stamp: string }> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat({ bigint: true });
    if (!before.isFile() || (!prefix && before.size > BigInt(maxBytes))) throw new ApplicationError('INCOMPLETE_RESULT', '邮件不是普通文件或超过读取预算');
    const size = Number(before.size > BigInt(maxBytes) ? BigInt(maxBytes) : before.size), bytes = Buffer.alloc(size); let done = 0;
    while (done < size) { const { bytesRead } = await fd.read(bytes,done,size - done,done); if (!bytesRead) throw new ApplicationError('RESOURCE_STATE_CHANGED', '邮件在读取时变化'); done += bytesRead; }
    const after = await fd.stat({ bigint: true });
    if (statStamp(before) !== statStamp(after)) throw new ApplicationError('RESOURCE_STATE_CHANGED', '邮件在读取时变化');
    return { bytes, stamp: statStamp(after) };
  } finally { await fd.close(); }
}
async function sourceRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new ApplicationError('INVALID_INPUT', '请选择单个Foxmail账号目录或其中的messages.db');
  const root = basename(path) === 'messages.db' ? dirname(path) : path, canonical = await realpath(root);
  if (canonical !== root.replace(new RegExp(sep + '+$'), '') || !(await lstat(root)).isDirectory()) throw new ApplicationError('SOURCE_UNAVAILABLE', '邮件来源目录不可读或包含链接，请重新选择实际账号目录');
  if (!(await lstat(join(root,'messages.db'))).isFile() || (await lstat(join(root,'messages.db'))).isSymbolicLink()) throw new ApplicationError('SOURCE_UNAVAILABLE', '请选择含messages.db的单个账号来源');
  return canonical;
}
async function metadata(native: string | ((path: string) => Promise<string>), path: string): Promise<Metadata> {
  const text = typeof native === 'function' ? await native(path) : await new Promise<string>((resolve,reject) => execFile(native,[path],{ timeout: 10000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true },(error,out) => error ? reject(new ApplicationError(error.killed ? 'TIMEOUT' : 'SOURCE_UNAVAILABLE','Foxmail元数据读取未完成')) : resolve(out)));
  let value: unknown; try { value = JSON.parse(text); } catch { throw new ApplicationError('INVALID_RESPONSE','Foxmail读取器未返回有效结果'); }
  if (value && typeof value === 'object' && 'error' in value) {
    const code = (value as { error?: { code?: string } }).error?.code;
    throw new ApplicationError(code === 'RESOURCE_STATE_CHANGED' || code === 'RESOURCE_BUSY' || code === 'UNSUPPORTED_FORMAT' || code === 'INCOMPLETE_RESULT' ? code : 'SOURCE_UNAVAILABLE','Foxmail来源忙碌、不可读或格式不支持');
  }
  const parsed = metadataSchema.safeParse(value); if (!parsed.success) throw new ApplicationError('INVALID_RESPONSE','Foxmail元数据格式不支持'); return parsed.data;
}
async function inventory(root: string): Promise<Map<string,string>> {
  const files = new Map<string,string>(); let count = 0;
  async function visit(folder: string,depth: number): Promise<void> {
    if (depth > 12) throw new ApplicationError('INCOMPLETE_RESULT','邮件目录深度超出扫描预算');
    const entries = await readdir(folder,{ withFileTypes: true });
    for (const entry of entries) {
      if (++count > 50000) throw new ApplicationError('INCOMPLETE_RESULT','邮件目录扫描超出预算');
      if (entry.isSymbolicLink()) throw new ApplicationError('INCOMPLETE_RESULT','邮件目录含未允许的链接，未声明完整');
      const path = join(folder,entry.name);
      if (entry.isDirectory()) await visit(path,depth + 1);
      else if (entry.isFile() && /^\d{1,20}\.mail$/.test(entry.name)) {
        const id = BigInt(entry.name.slice(0,-5)).toString(); if (files.has(id)) throw new ApplicationError('INCOMPLETE_RESULT','邮件来源含重复原生ID'); files.set(id,path);
      }
    }
  }
  await visit(join(root,'Mail'),0); return files;
}
function summary(id: string, email: Email, revision: string): LocalMailSummary {
  const date = email.date ? new Date(email.date) : new Date(NaN);
  if (!Number.isFinite(date.getTime()) || !email.headers.some(h => h.key === 'date')) throw new ApplicationError('INCOMPLETE_RESULT','邮件日期缺失或无效，无法确认查询范围');
  return { id, subject: email.subject ?? '', from: addresses(email.from ? [email.from] : []).join(', '), to: addresses(email.to).join(', '), date: date.toISOString(), messageId: email.messageId ?? null, sourceRevision: revision, hasAttachments: email.attachments.length > 0 };
}
/** Runs only inside the supervised mail Worker; neither source SQL nor MIME blocks the main thread. */
export class FoxmailSource {
  private readonly headers = new Map<string,{ stamp: string; value: LocalMailSummary }>();
  constructor(private readonly native: string | ((path: string) => Promise<string>)) {}
  private async context(input: Config, expected?: VerifiedConnectionIdentity) {
    const config = foxmailConfigSchema.parse(input), root = await sourceRoot(config.sourcePath), meta = await metadata(this.native,join(root,'messages.db'));
    const identity: VerifiedConnectionIdentity = { providerId: 'foxmail', serviceId: 'foxmail:' + digest(canonicalJson({ root, database: meta.databaseIdentity, schema: meta.schema })), accountId: config.account, contractMajor: 1 };
    if (expected && canonicalJson(identity) !== canonicalJson(expected)) throw new ApplicationError('IDENTITY_CHANGE_REQUIRES_SELECTION','邮件来源身份变化，请重新选择');
    return { config, root, meta, identity };
  }
  async verify(config: Config): Promise<VerifiedConnectionIdentity> { return (await this.context(config)).identity; }
  private async path(root: string, path: string): Promise<void> {
    const actual = await realpath(path), rel = relative(root,actual);
    if (actual !== path || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw new ApplicationError('SOURCE_UNAVAILABLE','邮件路径不在选定来源内');
  }
  private async header(root: string, path: string, id: string): Promise<{ value: LocalMailSummary; reused: boolean }> {
    await this.path(root,path); const current = await lstat(path,{ bigint: true }), stamp = statStamp(current), cached = this.headers.get(path);
    if (cached?.stamp === stamp) return { value: cached.value, reused: true };
    const read = await readRegular(path,65536,true), end = read.bytes.indexOf('\r\n\r\n'), lfEnd = read.bytes.indexOf('\n\n'), boundary = end >= 0 ? end : lfEnd;
    if (boundary < 0) throw new ApplicationError('INCOMPLETE_RESULT','邮件头不完整或超过预算');
    const email = await PostalMime.parse(Buffer.concat([read.bytes.subarray(0,boundary),Buffer.from('\r\n\r\n')]),mimeOptions), value = summary(id,email,read.stamp);
    if (this.headers.size >= 2000) this.headers.delete(this.headers.keys().next().value!); this.headers.set(path,{ stamp: read.stamp, value }); return { value, reused: false };
  }
  async query(config: Config, input: MailSearch, expected?: VerifiedConnectionIdentity, now = new Date()): Promise<LocalMailQuery> {
    const search = mailSearchSchema.parse(input), ctx = await this.context(config,expected), range = localMailRange(ctx.config.queryDays,now), files = await inventory(ctx.root);
    const result: LocalMailQuery = { sourceIdentity: ctx.identity.serviceId, range, checkedAt: new Date().toISOString(), complete: true, records: [], matched: 0, truncated: false, problems: [], metadataCount: ctx.meta.rows.length, reusedHeaders: 0, readHeaders: 0 };
    const needle = search.text.toLocaleLowerCase(), beforeFiles = await this.fileStamps(files);
    for (const row of ctx.meta.rows) {
      const path = files.get(row.id);
      try {
        if (!path) throw new ApplicationError('INCOMPLETE_RESULT','邮件尚未下载到本机');
        const { value, reused } = await this.header(ctx.root,path,row.id); if (reused) result.reusedHeaders++; else result.readHeaders++;
        if (value.date < range.start || value.date >= range.endExclusive) continue;
        value.hasAttachments = Number(row.attachmentCount) > 0;
        let matched = !needle || [value.subject,value.from,value.to].some(s => s.toLocaleLowerCase().includes(needle));
        if (!matched) { const content = await this.content(ctx.root,path,row.id); if (!content.complete) throw new ApplicationError('INCOMPLETE_RESULT','邮件正文尚不完整，未声明全文匹配完成'); matched = content.text.toLocaleLowerCase().includes(needle) || (content.html ?? '').toLocaleLowerCase().includes(needle); }
        if (matched) { result.matched++; result.records.push({ ...value }); result.records.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)); if (result.records.length > search.limit) result.records.pop(); result.truncated = result.matched > search.limit; }
      } catch (error) { result.complete = false; if (result.problems.length < 200) result.problems.push({ id: row.id, code: error instanceof ApplicationError ? error.code : 'SOURCE_UNAVAILABLE' }); }
    }
    const after = await this.context(config,ctx.identity);
    if (canonicalJson(after.meta) !== canonicalJson(ctx.meta) || canonicalJson(await this.fileStamps(await inventory(ctx.root))) !== canonicalJson(beforeFiles)) { result.complete = false; result.problems.push({ id: null, code: 'RESOURCE_STATE_CHANGED' }); }
    return result;
  }
  private async fileStamps(files: Map<string,string>): Promise<Record<string,string>> {
    const result: Record<string,string> = {}; for (const [id,path] of files) { const s = await lstat(path,{ bigint: true }); result[id] = path + ':' + statStamp(s); } return result;
  }
  private async content(root: string, path: string, id: string): Promise<LocalMailContent & { bytes: Buffer[]; observedStamp: string }> {
    await this.path(root,path); const read = await readRegular(path,8 * 1024 * 1024), email = await PostalMime.parse(read.bytes,mimeOptions);
    const bytes = email.attachments.map(a => typeof a.content === 'string' ? Buffer.from(a.content,a.encoding === 'base64' ? 'base64' : 'utf8') : a.content instanceof ArrayBuffer ? Buffer.from(a.content) : Buffer.from(a.content));
    if (bytes.reduce((n,b) => n + b.length,Buffer.byteLength(email.text ?? '') + Buffer.byteLength(email.html ?? '')) > 16 * 1024 * 1024) throw new ApplicationError('INCOMPLETE_RESULT','解码后邮件超过读取预算');
    const missing = email.attachments.some(a => a.rfc822DepthExceeded) ? ['nested-message-depth'] : [];
    if (!email.text && !email.html) missing.push('body');
    return { ...summary(id,email,digest(read.bytes)), text: email.text ?? '', html: email.html ?? null, replyTo: addresses(email.replyTo), references: email.references?.match(/<[^<>]+>/g) ?? [], inReplyTo: email.inReplyTo ?? null,
      complete: !missing.length, missing, attachments: email.attachments.map((a,i) => ({ id: String(i), filename: a.filename ?? 'attachment-' + (i + 1), contentType: a.mimeType, size: bytes[i].length, contentHash: digest(bytes[i]), contentId: a.contentId ?? null })), bytes, observedStamp: read.stamp };
  }
  async read(config: Config, id: string, expected: VerifiedConnectionIdentity, now = new Date()): Promise<LocalMailContent> {
    const { value } = await this.readOwned(config,id,expected,now); const { bytes: _, observedStamp: _stamp, ...content } = value; return content;
  }
  private async readOwned(config: Config,id: string,expected: VerifiedConnectionIdentity,now: Date) {
    if (!/^\d{1,20}$/.test(id)) throw new ApplicationError('INVALID_INPUT','邮件ID无效');
    const ctx = await this.context(config,expected); if (!ctx.meta.rows.some(r => r.id === id)) throw new ApplicationError('NOT_FOUND','来源邮件已删除或不再可用');
    const files = await inventory(ctx.root), path = files.get(id); if (!path) throw new ApplicationError('SOURCE_UNAVAILABLE','邮件正文尚未下载到本机');
    const value = await this.content(ctx.root,path,id), range = localMailRange(ctx.config.queryDays,now);
    if (value.date < range.start || value.date >= range.endExclusive) throw new ApplicationError('SCOPE_DENIED','邮件不在本次查询时间范围内');
    const selected = ctx.meta.rows.find(r => r.id === id)!;
    if (selected.attachmentCount !== null && Number(selected.attachmentCount) > value.attachments.length) { value.complete = false; value.missing.push('attachments-not-downloaded'); }
    const after = await this.context(config,expected); if (canonicalJson(after.meta) !== canonicalJson(ctx.meta) || statStamp(await lstat(path,{ bigint: true })) !== value.observedStamp) throw new ApplicationError('RESOURCE_STATE_CHANGED','读取期间邮件来源变化，请重新查询');
    return { value, ctx };
  }
  async attachment(config: Config,id: string,attachmentId: string,hash: string,expected: VerifiedConnectionIdentity,now = new Date()): Promise<Uint8Array> {
    const { value } = await this.readOwned(config,id,expected,now), at = Number(attachmentId);
    if (!/^(0|[1-9]\d{0,2})$/.test(attachmentId) || !value.attachments[at] || value.attachments[at].contentHash !== hash) throw new ApplicationError('RESOURCE_STATE_CHANGED','附件不存在或已发生变化');
    return value.bytes[at];
  }
}
