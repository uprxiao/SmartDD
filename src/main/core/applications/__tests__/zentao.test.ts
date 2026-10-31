import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZentaoClient, parseWorkPage } from '../providers/zentao';
import { requestJson } from '../providers/json-http';
let server: Server, base: string, handle: (req: IncomingMessage, res: ServerResponse) => void, sockets: Set<Socket>, paths: string[];
const source = (mode = 'bug', page = 1, total = 1, recordId: string | number = 7): { mode: string; type: string; pager: { recTotal: number; pageID: number; recPerPage: number; pageTotal: number }; bugs?: { id: string | number; assignedTo: { account: string }; status: string; title: string }[]; stories?: { id: string | number; assignedTo: { account: string }; status: string; title: string }[] } => ({ mode, type: 'assignedTo', pager: { recTotal: total, pageID: page, recPerPage: 1, pageTotal: total }, [mode === 'bug' ? 'bugs' : 'stories']: [{ id: recordId, assignedTo: { account: 'tester' }, status: 'active', title: 'fixture' }] });
const json = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
beforeEach(async () => {
  paths = []; sockets = new Set(); handle = (_req, res) => json(res, {});
  server = createServer((req, res) => { paths.push(req.url!); if (req.url === '/biz/api.php/v1/user') json(res, { profile: { id: '9007199254740997', account: 'tester' } }); else handle(req, res); });
  server.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('fixture address'); base = 'http://127.0.0.1:' + addr.port + '/biz/';
});
afterEach(async () => { for (const s of sockets) s.destroy(); await new Promise<void>(r => server.close(() => r())); });
const client = (authMode: 'token' | 'password' = 'token') => new ZentaoClient({ kind: 'zentao', baseUrl: base, username: 'tester', authMode }, 'fixture-private-secret');

describe('promoted ZenTao contract over a real local HTTP server', () => {
  it('reads current instance labels with modules and the same verified identity',async()=>{
    handle=(req,res)=>{expect(req.headers.token).toBe('fixture-private-secret');if(req.url==='/biz/api.php/v1/langs?modules=bug')json(res,{bug:{pri:'优先级',priList:['','P0','P1','P2'],severityList:{3:'较大'}}});else json(res,{},404);};
    const value=await client().presentation('bug',new AbortController().signal);
    expect(value.choices.pri['3']).toBe('P2');expect(value.choices.severity['3']).toBe('较大');expect(paths).toEqual(['/biz/api.php/v1/user','/biz/api.php/v1/langs?modules=bug']);
  });
  it('preserves the deployment base path, sends password only in login body and verifies current account', async () => {
    let loginBody = '';
    handle = (req, res) => { expect(req.url).toBe('/biz/api.php/v1/tokens'); expect(req.headers.token).toBeUndefined(); req.setEncoding('utf8'); req.on('data', part => { loginBody += part; }); req.on('end', () => json(res, { token: 'fixture-token' })); };
    const c = client('password'); expect(await c.verify(new AbortController().signal)).toMatchObject({ accountId: 'uid:9007199254740997', serviceId: base });
    expect(JSON.parse(loginBody)).toEqual({ account: 'tester', password: 'fixture-private-secret' }); expect(paths.every(p => !p.includes('secret'))).toBe(true); c.close();
  });
  it('collects exact sparse-map IDs across pages and verifies assigned scope and pagination parameters', async () => {
    handle = (req, res) => { const u = new URL(req.url!, base); expect(u.pathname).toBe('/biz/api.php/v2/my/work'); expect(u.searchParams.get('type')).toBe('assignedTo'); expect(u.searchParams.get('orderBy')).toBe('id_desc'); expect(req.headers.token).toBe('fixture-private-secret'); const page = Number(u.searchParams.get('pageID')); const payload = source('bug', page, 2, page === 1 ? '9007199254740997' : '9007199254740998'); json(res, { ...payload, bugs: Object.fromEntries(payload.bugs!.map((r: { id: string | number }) => [String(r.id), r])) }); };
    const result = await client().collect('bug', new AbortController().signal, { pageSize: 1 }); expect(result.complete).toBe(true); expect(result.records.map(r => r.id)).toEqual(['9007199254740997', '9007199254740998']); expect(result.pages).toBe(2);
  });
  it('accepts a confirmed empty Story list but never turns a missing collection into an empty success', () => {
    const empty = { mode: 'story', type: 'assignedTo', pager: { recTotal: 0, pageID: 1, recPerPage: 1, pageTotal: 0 }, stories: [] };
    expect(parseWorkPage(empty, 'story', 'tester', 1, 1).records).toEqual([]);
    const { stories: _, ...missing } = empty; expect(() => parseWorkPage(missing, 'story', 'tester', 1, 1)).toThrow(/集合/);
  });
  it('rejects outside assignees and closed Bugs without returning their records', async () => {
    handle = (_req, res) => json(res, { ...source(), bugs: [{ id: 7, assignedTo: 'other', title: 'outside-owned-scope' }] });
    const denied = await client().collect('bug', new AbortController().signal, { pageSize: 1 }); expect(denied.complete).toBe(false); expect(denied.errorCode).toBe('SCOPE_DENIED'); expect(denied.records).toEqual([]);
    expect(() => parseWorkPage({ ...source(), bugs: [{ id: 7, assignedTo: 'tester', status: 'closed' }] }, 'bug', 'tester', 1, 1)).toThrow(/范围/);
  });
  it('preserves valid earlier pages with explicit incomplete status when a later request fails', async () => {
    handle = (req, res) => { const p = Number(new URL(req.url!, base).searchParams.get('pageID')); if (p === 2) json(res, {}, 503); else json(res, source('bug', 1, 2)); };
    const result = await client().collect('bug', new AbortController().signal, { pageSize: 1 }); expect(result).toMatchObject({ complete: false, pages: 1, errorCode: 'TRANSIENT_FAILURE' }); expect(result.records.map(r => r.id)).toEqual([7]); expect(paths).toHaveLength(3);
  });
  it('does not declare a complete list after duplicate pages, changing totals or exhausted budgets', async () => {
    handle = (req, res) => json(res, source('bug', Number(new URL(req.url!, base).searchParams.get('pageID')), 2, 7));
    const repeated = await client().collect('bug', new AbortController().signal, { pageSize: 1 }); expect(repeated).toMatchObject({ complete: false, errorCode: 'INCOMPLETE_RESULT' }); expect(repeated.records).toHaveLength(1);
    const limited = await client().collect('bug', new AbortController().signal, { pageSize: 1, maxPages: 1 }); expect(limited.complete).toBe(false); expect(limited.pages).toBe(1);
  });
  it('reads Bug v1 and Story v2 details and enforces the current account at direct lookup', async () => {
    handle = (req, res) => {
      if (req.url === '/biz/api.php/v1/bugs/7') json(res, { bug: { id: 7, assignedTo: 'tester', status: 'active', steps: '<p>fixture</p>', files: {} }, actions: [] });
      else if (req.url === '/biz/api.php/v2/stories/8') json(res, { story: { id: 8, assignedTo: 'tester', spec: 'fixture', verify: 'criteria', files: [] }, actions: [] });
      else json(res, { bug: { id: 9, assignedTo: 'other', steps: 'outside' } });
    };
    expect(await client().detail('bug', '7', new AbortController().signal)).toMatchObject({ id: '7', complete: true });
    expect((await client().detail('story', '8', new AbortController().signal)).fields.verify).toBe('criteria');
    await expect(client().detail('bug', '9', new AbortController().signal)).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });
  it('blocks redirects and rejects unsafe numeric JSON instead of rounding identity', async () => {
    let outside = 0; handle = (req, res) => { if (req.url === '/outside') { outside++; json(res, {}); } else if (req.url === '/unsafe') { res.end('{"id":9007199254740997}'); } else { res.writeHead(302, { location: '/outside' }); res.end(); } };
    await expect(requestJson(new URL('/redirect', base), { signal: new AbortController().signal, token: 'fixture-token' })).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' }); expect(outside).toBe(0);
    await expect(requestJson(new URL('/unsafe', base), { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('bounds incomplete responses, timeouts and cancellation', async () => {
    handle = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write(' '); };
    await expect(requestJson(new URL('/slow', base), { signal: new AbortController().signal, timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    const controller = new AbortController(); controller.abort(); await expect(requestJson(new URL('/never', base), { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELED' });
    handle = (_req, res) => res.end('{"long":"' + 'x'.repeat(100) + '"}');
    await expect(requestJson(new URL('/large', base), { signal: new AbortController().signal, maxBytes: 10 })).rejects.toMatchObject({ code: 'INCOMPLETE_RESULT' });
  });
});
