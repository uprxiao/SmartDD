// 扩展 viewer（MCP 资源）适配的主进程侧策略（纯函数）。M9 GAP-07。
// 原则：已配置的 MCP 服务 ≠ 可用 viewer；资源 URI 必须严格对应会话文件；大小以解码后的真实字节为准；能力缺失就不发请求。
export const VIEWER_LIMITS = { maxResourceBytes: 20 * 1024 * 1024, requestTimeoutMs: 15000, maxNotificationsPerSecond: 200 };

// 服务端声明的能力 → viewer 可用性。声明里没有 resources 就不可用，且不应发出任何 resources/* 请求。
export function viewerAvailability(initializeResult) {
  const caps = initializeResult?.capabilities;
  if (!caps || typeof caps !== 'object') return { available: false, reason: 'no-capabilities' };
  if (!caps.resources) return { available: false, reason: 'resources-not-declared' };
  return { available: true, canSubscribe: !!caps.resources.subscribe, canList: true };
}

const normalizeUri = value => { try { const u = new URL(value); u.hash = ''; return u.href; } catch { return null; } };
// 读/写只允许会话打开的那一个资源 URI（忽略 fragment）；任何其他 URI（含 file:// 根外、../、其它 scheme）一律拒绝。
export function resourceUriAllowed(requestUri, sessionUri) {
  const a = normalizeUri(requestUri), b = normalizeUri(sessionUri);
  if (!a || !b) return { ok: false, error: 'invalid-uri' };
  if (a !== b) return { ok: false, error: 'uri-not-session-resource' };
  return { ok: true };
}

// resources/read 返回的 contents 解码并校验：以解码后的真实字节计大小，不信 size 声明。
export function decodeResourceContents(contents, { maxBytes = VIEWER_LIMITS.maxResourceBytes } = {}) {
  if (!Array.isArray(contents) || contents.length !== 1) return { ok: false, error: 'expected-single-content' };
  const c = contents[0];
  if (typeof c.text === 'string') { const bytes = Buffer.byteLength(c.text, 'utf8'); return bytes > maxBytes ? { ok: false, error: 'too-large', bytes } : { ok: true, kind: 'text', text: c.text, bytes, mimeType: c.mimeType || null }; }
  if (typeof c.blob === 'string') {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(c.blob) || c.blob.length % 4 !== 0) return { ok: false, error: 'invalid-base64' };
    const bytes = Math.floor(c.blob.length / 4) * 3 - (c.blob.endsWith('==') ? 2 : c.blob.endsWith('=') ? 1 : 0);
    return bytes > maxBytes ? { ok: false, error: 'too-large', bytes } : { ok: true, kind: 'blob', data: Buffer.from(c.blob, 'base64'), bytes, mimeType: c.mimeType || null };
  }
  return { ok: false, error: 'no-text-or-blob' };
}

// 写回结果：服务端返回 saved/conflict/too-large；其他任何形态都按失败处理且不更新本地基线。
export function interpretWriteResult(result) {
  if (result?.state === 'saved' && typeof result.etag === 'string') return { ok: true, state: 'saved', etag: result.etag };
  if (result?.state === 'conflict') return { ok: false, state: 'conflict', etag: typeof result.etag === 'string' ? result.etag : null };
  if (result?.state === 'too-large') return { ok: false, state: 'too-large' };
  return { ok: false, state: 'invalid-response' };
}

// 通知洪峰保护：滑动 1 秒窗口内超过上限的通知被丢弃并计数，不让主进程被事件淹没。
export function createNotificationLimiter({ limit = VIEWER_LIMITS.maxNotificationsPerSecond, now = () => Date.now() } = {}) {
  let windowStart = now(), count = 0, dropped = 0;
  return { accept() { const t = now(); if (t - windowStart >= 1000) { windowStart = t; count = 0; } count++; if (count > limit) { dropped++; return false; } return true; }, get dropped() { return dropped; } };
}
