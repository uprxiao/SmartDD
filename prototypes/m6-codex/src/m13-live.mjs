// M13 原型 P0.12：SMG 供应商真实接入（用户 2026-11-11 要求）。只有目录中 live 的供应商走这里，其余仍为合成数据。
// 请求经开发服务器代理 /__m13-live/smg 转发到 SMG 网关（见 vite.config.mjs）；Key 只保存在本页内存（刷新即丢失），
// 只随请求头发送，不写入文件、不打印。正式 App 中由主进程发起请求，Key 走钥匙串，与原型无关。
// P0.16（审核 review-20261111-1500 N08）：按 SSE 事件判定、超时覆盖整个正文读取、正文大小上限、删除供应商时清除 Key。
import { SMG_CONFIGURED } from './m13-model.mjs';
const BASE = { smg: '/__m13-live/smg' };
const secrets = new Map();
export const setLiveKey = (providerId, key) => secrets.set(providerId, key);
export const getLiveKey = providerId => secrets.get(providerId);
export const clearLiveKey = providerId => secrets.delete(providerId);
export const isLive = p => !!BASE[p?.catalog];
const MAX_BODY = 2 * 1024 * 1024;

const headers = key => ({ 'content-type': 'application/json', authorization: 'Bearer ' + key, 'x-api-key': key, 'anthropic-version': '2023-06-01' });
/** 读取正文：在截止时间前读完，超过大小上限即停止；超时抛出“读取响应超时”。 */
export async function readBody(response, ms, maxBytes = MAX_BODY) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const dec = new TextDecoder(); let out = '', size = 0, timer;
  const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`读取响应超时（${Math.round(ms / 1000)} 秒）`)), ms); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength; if (size > maxBytes) throw new Error('响应过大，已停止读取');
      out += dec.decode(value, { stream: true });
    }
    return out + dec.decode();
  } catch (e) { try { await reader.cancel(); } catch {} throw e; }
  finally { clearTimeout(timer); }
}
/** 一次请求：同一个截止时间覆盖连接、响应头和正文读取。返回状态与正文。 */
async function request(catalog, path, key, init = {}, ms = 30000, extraHeaders = {}) {
  const ac = new AbortController(); const start = Date.now(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(BASE[catalog] + path, { ...init, headers: { ...headers(key), ...extraHeaders }, signal: ac.signal });
    const text = await readBody(r, Math.max(1, ms - (Date.now() - start)));
    return { status: r.status, ok: r.ok, text };
  } catch (e) { if (e.name === 'AbortError') throw new Error(`超时（${Math.round(ms / 1000)} 秒）`); throw e; }
  finally { clearTimeout(t); ac.abort(); }
}
const errOf = text => { try { const j = JSON.parse(text); return j?.error?.message || j?.message || JSON.stringify(j).slice(0, 160); } catch { return (text || '').slice(0, 160); } };

/** 获取模型列表：GET /v1/models。 */
export async function liveModels(catalog, key) {
  if (catalog === 'smg' && !SMG_CONFIGURED) return { ok: false, error: '原型没有配置 SMG 地址：启动开发服务器时用环境变量 M13_SMG_URL 指定（内网地址不写进仓库）。' };
  let r;
  try { r = await request(catalog, '/v1/models', key, { method: 'GET' }, 15000); } catch (e) { return { ok: false, error: '服务不可达：' + e.message + '。请检查网络或是否在公司内网。' }; }
  if (r.status === 401 || r.status === 403) return { ok: false, error: `模型列表返回 ${r.status}，Key 可能无效：${errOf(r.text)}` };
  if (!r.ok) return { ok: false, error: `模型列表返回 ${r.status}：${errOf(r.text)}` };
  let j; try { j = JSON.parse(r.text); } catch { return { ok: false, error: '模型列表不是有效的 JSON' }; }
  const list = Array.isArray(j?.data) ? j.data : [];
  return { ok: true, models: list.map(m => ({ id: m.id, name: m.display_name || m.id, ctx: m.context_length ? Math.round(m.context_length / 1000) + 'K' : '—' })) };
}

/** 接口探测：空请求看路径是否存在（404 不支持；401/400/422 视为存在）。只作候选，Anthropic 以工具调用测试为准。 */
export async function liveProbe(catalog, key) {
  const out = {};
  for (const [proto, path] of [['responses', '/v1/responses'], ['anthropic', '/v1/messages'], ['openai', '/v1/chat/completions']]) {
    try { const r = await request(catalog, path, key, { method: 'POST', body: '{}' }, 10000); out[proto] = r.status !== 404 && r.status !== 405; } catch { out[proto] = false; }
  }
  return out;
}

/** 按 SSE 事件判定一次测试（审核 N08）：必须有 message_start、wy_ping 工具块开始并结束、message_stop；出现 error 事件或流被截断都不算可用。 */
export function judgeSse(text) {
  const events = [];
  for (const block of (text || '').split(/\r?\n\r?\n/)) {
    const ev = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim(); const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!ev && !data) continue; let j = null; try { j = data ? JSON.parse(data) : null; } catch {}
    events.push({ type: ev || j?.type, data: j });
  }
  const err = events.find(e => e.type === 'error');
  if (err) return { result: 'bad', detail: `流中返回错误：${err.data?.error?.type || ''} ${err.data?.error?.message || ''}`.trim() };
  if (!events.some(e => e.type === 'message_start')) return { result: 'bad', detail: '没有返回流式响应' };
  const toolIdx = events.find(e => e.type === 'content_block_start' && e.data?.content_block?.type === 'tool_use' && e.data.content_block.name === 'wy_ping')?.data?.index;
  if (toolIdx === undefined) return { result: 'bad', detail: '没有发起工具调用' };
  if (!events.some(e => e.type === 'content_block_stop' && e.data?.index === toolIdx)) return { result: 'bad', detail: '工具调用没有结束（流被截断）' };
  if (!events.some(e => e.type === 'message_stop')) return { result: 'bad', detail: '没有收到 message_stop（流被截断）' };
  return { result: 'ok', detail: '流式与工具调用正常' };
}

/** Claude Code 可用性测试（补验 D R5，用户 2026-11-11 决定）：失败时自动重试一次，两次都失败才判“不可用”；协议缺失（404）不重试。 */
export async function liveClaudeTest(catalog, key, model) {
  const first = await liveClaudeTestOnce(catalog, key, model);
  if (first.result === 'ok' || first.protocolMissing) return first;
  const second = await liveClaudeTestOnce(catalog, key, model);
  return second.result === 'ok' ? { ...second, detail: second.detail + '（首次失败后重试成功）' } : { ...second, detail: `两次都失败：${second.detail}` };
}
/** 单次测试：Anthropic Messages 流式请求，带上与 Claude Code 2.1.322 相同的 beta 头与 thinking 参数，要求调用一个工具。 */
const CLI_BETAS = 'claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27,mid-conversation-tool-changes-2026-07-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,dangerous-tool-use-2026-09-03,thinking-display-updates-2026-08-18,afk-mode-2026-01-31';
async function liveClaudeTestOnce(catalog, key, model) {
  const body = { model, max_tokens: 1024, stream: true, thinking: { type: 'enabled', budget_tokens: 512 }, messages: [{ role: 'user', content: 'Call the wy_ping tool.' }],
    tools: [{ name: 'wy_ping', description: 'Connectivity check. Returns pong.', input_schema: { type: 'object', properties: {} } }], tool_choice: { type: 'auto' } }; // 开启 thinking 时接口不允许强制指定工具，与 Claude Code 一样用 auto
  const t0 = performance.now();
  let r;
  try { r = await request(catalog, '/v1/messages', key, { method: 'POST', body: JSON.stringify(body) }, 30000, { 'anthropic-beta': CLI_BETAS }); } catch (e) { return { result: 'bad', protocolMissing: false, detail: e.message.startsWith('超时') || e.message.startsWith('读取响应超时') ? e.message : '连接失败：' + e.message }; }
  if (r.status === 404 || r.status === 405) return { result: 'bad', protocolMissing: true, detail: '网关不支持 Anthropic 接口' };
  if (!r.ok) return { result: 'bad', protocolMissing: false, detail: `${r.status}：${errOf(r.text)}` };
  const j = judgeSse(r.text); const ms = Math.round(performance.now() - t0);
  return { ...j, protocolMissing: false, detail: j.result === 'ok' ? `${j.detail} · ${ms} ms` : j.detail };
}
