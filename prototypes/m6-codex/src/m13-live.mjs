// M13 原型 P0.12：SMG 供应商真实接入（用户 2026-11-11 要求）。只有目录中 live 的供应商走这里，其余仍为合成数据。
// 请求经开发服务器代理 /__m13-live/smg 转发到 SMG 网关（见 vite.config.mjs）；Key 只保存在本页内存（刷新即丢失），
// 只随请求头发送，不写入文件、不打印。正式 App 中由主进程发起请求，Key 走钥匙串，与原型无关。
import { SMG_CONFIGURED } from './m13-model.mjs';
const BASE = { smg: '/__m13-live/smg' };
const secrets = new Map();
export const setLiveKey = (providerId, key) => secrets.set(providerId, key);
export const getLiveKey = providerId => secrets.get(providerId);
export const isLive = p => !!BASE[p?.catalog];

const headers = key => ({ 'content-type': 'application/json', authorization: 'Bearer ' + key, 'x-api-key': key, 'anthropic-version': '2023-06-01' });
async function call(catalog, path, key, init = {}, timeout = 30000, extraHeaders = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  try { return await fetch(BASE[catalog] + path, { ...init, headers: { ...headers(key), ...extraHeaders }, signal: ac.signal }); }
  finally { clearTimeout(t); }
}
const errText = async r => { try { const j = await r.clone().json(); return j?.error?.message || j?.message || JSON.stringify(j).slice(0, 160); } catch { return (await r.text()).slice(0, 160); } };

/** 获取模型列表：GET /v1/models。 */
export async function liveModels(catalog, key) {
  if (catalog === 'smg' && !SMG_CONFIGURED) return { ok: false, error: '原型没有配置 SMG 地址：启动开发服务器时用环境变量 M13_SMG_URL 指定（内网地址不写进仓库）。' };
  let r;
  try { r = await call(catalog, '/v1/models', key, { method: 'GET' }, 15000); } catch (e) { return { ok: false, error: e.name === 'AbortError' ? '服务不可达：连接超时（15 秒）。请检查网络或是否在公司内网。' : '服务不可达：' + e.message }; }
  if (r.status === 401 || r.status === 403) return { ok: false, error: `模型列表返回 ${r.status}，Key 可能无效：${await errText(r)}` };
  if (!r.ok) return { ok: false, error: `模型列表返回 ${r.status}：${await errText(r)}` };
  const j = await r.json(); const list = Array.isArray(j?.data) ? j.data : [];
  return { ok: true, models: list.map(m => ({ id: m.id, name: m.display_name || m.id, ctx: m.context_length ? Math.round(m.context_length / 1000) + 'K' : '—' })) };
}

/** 接口探测：空请求看路径是否存在（404 不支持；401/400/422 视为存在）。只作候选，Anthropic 以工具调用测试为准。 */
export async function liveProbe(catalog, key) {
  const out = {};
  for (const [proto, path] of [['responses', '/v1/responses'], ['anthropic', '/v1/messages'], ['openai', '/v1/chat/completions']]) {
    try { const r = await call(catalog, path, key, { method: 'POST', body: '{}' }, 10000); out[proto] = r.status !== 404 && r.status !== 405; } catch { out[proto] = false; }
  }
  return out;
}

/** Claude Code 可用性测试（补验 D R5，用户 2026-11-11 决定）：失败时自动重试一次，两次都失败才判“不可用”；协议缺失（404）不重试。 */
export async function liveClaudeTest(catalog, key, model) {
  const first = await liveClaudeTestOnce(catalog, key, model);
  if (first.result === 'ok' || first.protocolMissing) return first;
  const second = await liveClaudeTestOnce(catalog, key, model);
  return second.result === 'ok' ? { ...second, detail: second.detail + '（首次失败后重试成功）' } : { ...second, detail: `两次都失败：${second.detail}` };
}
/** 单次测试：Anthropic Messages 流式请求，带上与 Claude Code 2.1.322 相同的 beta 头与 thinking 参数，要求调用一个工具；收到 tool_use 才算可用。 */
const CLI_BETAS = 'claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27,mid-conversation-tool-changes-2026-07-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,dangerous-tool-use-2026-09-03,thinking-display-updates-2026-08-18,afk-mode-2026-01-31';
async function liveClaudeTestOnce(catalog, key, model) {
  const body = { model, max_tokens: 1024, stream: true, thinking: { type: 'enabled', budget_tokens: 512 }, messages: [{ role: 'user', content: 'Call the wy_ping tool.' }],
    tools: [{ name: 'wy_ping', description: 'Connectivity check. Returns pong.', input_schema: { type: 'object', properties: {} } }], tool_choice: { type: 'auto' } }; // 开启 thinking 时接口不允许强制指定工具，与 Claude Code 一样用 auto
  const t0 = performance.now();
  let r;
  try { r = await call(catalog, '/v1/messages', key, { method: 'POST', body: JSON.stringify(body) }, 30000, { 'anthropic-beta': CLI_BETAS }); } catch (e) { return { result: 'bad', protocolMissing: false, detail: e.name === 'AbortError' ? '超时（30 秒）' : '连接失败：' + e.message }; }
  if (r.status === 404 || r.status === 405) return { result: 'bad', protocolMissing: true, detail: '网关不支持 Anthropic 接口' };
  if (!r.ok) return { result: 'bad', protocolMissing: false, detail: `${r.status}：${await errText(r)}` };
  const text = await r.text();
  const ms = Math.round(performance.now() - t0);
  const streamed = /event:\s*message_start|"type"\s*:\s*"message_start"/.test(text);
  const tool = /"type"\s*:\s*"tool_use"/.test(text) && /wy_ping/.test(text);
  if (streamed && tool) return { result: 'ok', detail: `流式与工具调用正常 · ${ms} ms` };
  return { result: 'bad', protocolMissing: false, detail: !streamed ? '没有返回流式响应' : '没有发起工具调用' };
}
