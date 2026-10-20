// Promoted from the reviewed M10 my_work_client.py contract; no ZenTao PHP is copied.
import type { ConnectionConfig, VerifiedConnectionIdentity } from '@shared/application-connections';
import { ApplicationError } from '@shared/applications';
import { canonicalJson, digest } from '../manifest';
import { requestBytes, requestJson, type HttpBytes } from './json-http';

type ZentaoConfig = Extract<ConnectionConfig, { kind: 'zentao' }>;
export type ZentaoKind = 'bug' | 'story';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function zentaoId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^\d{1,64}$/.test(value) && !/^0+$/.test(value)) return value;
  throw new ApplicationError('INVALID_RESPONSE', '禅道对象标识无效或无法保真');
}
const integer = (v: unknown, min: number): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) throw new ApplicationError('INVALID_RESPONSE', '禅道分页信息无效'); return v;
};
function assignee(v: unknown): string | null { return typeof v === 'string' ? v : record(v) && typeof v.account === 'string' ? v.account : null; }
function mappings(value: unknown): Record<string, unknown>[] { return record(value) ? [value, ...(record(value.data) ? [value.data] : [])] : []; }
export interface ZentaoPage { records: Record<string, unknown>[]; total: number; page: number; pageSize: number; pageTotal: number }
export function parseWorkPage(value: unknown, kind: ZentaoKind, account: string, requestedPage: number, requestedSize: number): ZentaoPage {
  const source = mappings(value).find(p => p.mode === kind && p.type === 'assignedTo');
  if (!source || !record(source.pager)) throw new ApplicationError('INVALID_RESPONSE', '禅道未返回本人指派范围或完整分页信息');
  const total = integer(source.pager.recTotal, 0), page = integer(source.pager.pageID, 1), pageSize = integer(source.pager.recPerPage, 1), pageTotal = integer(source.pager.pageTotal, 0);
  if (page !== requestedPage || pageSize !== requestedSize || pageTotal !== Math.ceil(total / pageSize)) throw new ApplicationError('INVALID_RESPONSE', '禅道未遵循请求分页或总数不一致');
  const raw = source[kind === 'bug' ? 'bugs' : 'stories'];
  const records = Array.isArray(raw) ? raw : record(raw) ? Object.values(raw) : null;
  if (!records || records.length > pageSize || records.length > total) throw new ApplicationError('INVALID_RESPONSE', '禅道对象集合缺失或返回格式不支持');
  const ids = new Set<string>();
  for (const item of records) {
    if (!record(item)) throw new ApplicationError('INVALID_RESPONSE', '禅道对象结构无效');
    const id = zentaoId(item.id);
    if (ids.has(id)) throw new ApplicationError('INCOMPLETE_RESULT', '禅道当前页出现重复对象');
    if (assignee(item.assignedTo) !== account || (kind === 'bug' && item.status === 'closed')) throw new ApplicationError('SCOPE_DENIED', '服务响应含非当前本人工作范围对象');
    ids.add(id);
  }
  return { records: records as Record<string, unknown>[], total, page, pageSize, pageTotal };
}
export interface ZentaoCollection { kind: ZentaoKind; records: Record<string, unknown>[]; total: number | null; complete: boolean; pages: number; errorCode: string | null; message: string | null }
export interface ZentaoDetail { kind: ZentaoKind; id: string; fields: Record<string, unknown>; actions: unknown; files: unknown; contentRevision: string; complete: boolean; missing: string[] }

/** Parser completeness is derived metadata; it is not part of the immutable source payload hash. */
export function zentaoDetailRevision(kind:ZentaoKind,id:string,fields:Record<string,unknown>,actions:unknown,files:unknown):ZentaoDetail{
  const missing:string[]=[];
  if(!['steps','spec','description'].some(key=>typeof fields[key]==='string')&&!(record(fields.spec)&&typeof fields.spec.spec==='string'))missing.push('description');
  if(!Array.isArray(actions)&&!record(actions))missing.push('history');if(!Array.isArray(files)&&!record(files))missing.push('attachments');
  const payload={kind,id,fields,actions,files};return{...payload,contentRevision:digest(canonicalJson(payload)),complete:missing.length===0,missing};
}

export class ZentaoClient {
  private token: string | null;
  private account: string | null = null;
  private base: URL;
  constructor(private readonly config: ZentaoConfig, private secret: string | null, private readonly expectedIdentity?: VerifiedConnectionIdentity) {
    this.base = new URL(config.baseUrl); this.base.pathname = this.base.pathname.replace(/\/+$/, '') + '/';
    this.token = config.authMode === 'token' ? secret : null;
  }
  private api(version: 'v1' | 'v2', path: string, signal: AbortSignal, query?: Record<string, string | number>, body?: unknown): Promise<unknown> {
    const url = new URL('api.php/' + version + '/' + path, this.base);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    return requestJson(url, { signal, method: body === undefined ? 'GET' : 'POST', body, token: body === undefined ? this.token ?? undefined : undefined });
  }
  async verify(signal: AbortSignal): Promise<VerifiedConnectionIdentity> {
    if (!this.secret) throw new ApplicationError('AUTH_REQUIRED', '禅道认证凭据未配置');
    if (!this.token && this.config.authMode === 'password') {
      const login = await this.api('v1', 'tokens', signal, undefined, { account: this.config.username, password: this.secret });
      const token = mappings(login).flatMap(p => [p.token, typeof p.data === 'string' ? p.data : undefined]).find(t => typeof t === 'string' && t.length > 0 && t.length <= 8192);
      if (typeof token !== 'string') throw new ApplicationError('AUTH_FAILED', '禅道未返回有效认证Token'); this.token = token;
    }
    const value = await this.api('v1', 'user', signal);
    let user: Record<string, unknown> | null = null;
    for (const candidate of mappings(value)) {
      if (record(candidate.profile)) { user = candidate.profile; break; }
      if (record(candidate.user)) { user = candidate.user; break; }
      if (typeof candidate.account === 'string') { user = candidate; break; }
    }
    if (!user || user.account !== this.config.username) throw new ApplicationError('IDENTITY_CHANGE_REQUIRES_SELECTION', '禅道Token识别的账号与配置不同');
    const id = typeof user.id === 'string' || typeof user.id === 'number' ? zentaoId(user.id) : null;
    const identity: VerifiedConnectionIdentity = { providerId: 'zentao', serviceId: this.base.toString(), accountId: id ? 'uid:' + id : 'account:' + this.config.username, contractMajor: 1 };
    if (this.expectedIdentity && canonicalJson(identity) !== canonicalJson(this.expectedIdentity)) throw new ApplicationError('IDENTITY_CHANGE_REQUIRES_SELECTION', '禅道当前身份已变化，需重新明确来源');
    this.account = this.config.username; return identity;
  }
  async page(kind: ZentaoKind, page: number, pageSize: number, signal: AbortSignal): Promise<ZentaoPage> {
    if (!['bug', 'story'].includes(kind) || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new ApplicationError('INVALID_INPUT', '禅道类型或分页参数无效');
    if (!this.account) await this.verify(signal);
    const value = await this.api('v2', 'my/work', signal, { mode: kind, type: 'assignedTo', param: 0, orderBy: 'id_desc', recTotal: 0, recPerPage: pageSize, pageID: page });
    return parseWorkPage(value, kind, this.account!, page, pageSize);
  }
  async collect(kind: ZentaoKind, signal: AbortSignal, options: { pageSize?: number; maxPages?: number; maxRecords?: number } = {}): Promise<ZentaoCollection> {
    const size = options.pageSize ?? 100, maxPages = options.maxPages ?? 20, maxRecords = options.maxRecords ?? 2000;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100 || !Number.isSafeInteger(maxRecords) || maxRecords < 0 || maxRecords > 10000) throw new ApplicationError('INVALID_INPUT', '禅道读取预算无效');
    const result: ZentaoCollection = { kind, records: [], total: null, complete: false, pages: 0, errorCode: null, message: null }, seen = new Set<string>();
    try {
      for (let n = 1; n <= maxPages; n++) {
        const page = await this.page(kind, n, size, signal);
        if (result.total !== null && result.total !== page.total) throw new ApplicationError('INCOMPLETE_RESULT', '分页期间列表总数变化，请重新查询');
        result.total = page.total;
        if (page.total > maxRecords) throw new ApplicationError('INCOMPLETE_RESULT', '本人列表超出本次读取预算，未声称完整');
        for (const item of page.records) if (seen.has(zentaoId(item.id))) throw new ApplicationError('INCOMPLETE_RESULT', '分页返回重复对象，未声称完整');
        for (const item of page.records) { seen.add(zentaoId(item.id)); result.records.push(item); }
        result.pages++;
        if (n >= Math.max(1, page.pageTotal)) {
          if (result.records.length !== page.total) throw new ApplicationError('INCOMPLETE_RESULT', '分页对象数量与总数不符'); result.complete = true; return result;
        }
        if (!page.records.length) throw new ApplicationError('INCOMPLETE_RESULT', '列表结束前返回空页');
      }
      throw new ApplicationError('INCOMPLETE_RESULT', '分页次数预算耗尽');
    } catch (error) {
      const safe = error instanceof ApplicationError ? error : new ApplicationError('CONNECTION_UNAVAILABLE', '禅道读取未完成');
      result.errorCode = safe.code; result.message = safe.message; return result;
    }
  }
  async detail(kind: ZentaoKind, inputId: string, signal: AbortSignal): Promise<ZentaoDetail> {
    if (!['bug', 'story'].includes(kind)) throw new ApplicationError('INVALID_INPUT', '禅道对象类型不支持');
    const id = zentaoId(inputId); if (!this.account) await this.verify(signal);
    const value = await this.api(kind === 'bug' ? 'v1' : 'v2', (kind === 'bug' ? 'bugs/' : 'stories/') + id, signal);
    let item: Record<string, unknown> | null = null, container: Record<string, unknown> = {};
    for (const candidate of mappings(value)) {
      if (record(candidate[kind])) { item = candidate[kind] as Record<string, unknown>; container = candidate; break; }
      if (candidate.id !== undefined) { item = candidate; container = candidate; break; }
    }
    if (!item || zentaoId(item.id) !== id) throw new ApplicationError('INVALID_RESPONSE', '禅道详情身份缺失或与请求不符');
    if (assignee(item.assignedTo) !== this.account || (kind === 'bug' && item.status === 'closed')) throw new ApplicationError('SCOPE_DENIED', '该对象当前不在本人工作范围');
    return zentaoDetailRevision(kind,id,item,container.actions??item.actions??null,item.files??container.files??null);
  }
  async file(inputId:string,signal:AbortSignal,maxBytes=25*1024*1024):Promise<HttpBytes>{
    const id=zentaoId(inputId);if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>25*1024*1024)throw new ApplicationError('INVALID_INPUT','禅道附件读取预算无效');if(!this.account)await this.verify(signal);
    return requestBytes(new URL('api.php/v1/files/'+id,this.base),{signal,token:this.token??undefined,maxBytes});
  }
  close(): void { this.secret = null; this.token = null; this.account = null; }
}
