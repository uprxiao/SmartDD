import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ApplicationError } from '@shared/applications';

/** Single attempt only. The execution service owns the total retry budget. */
export function requestJson(url: URL, options: { method?: 'GET' | 'POST'; token?: string; body?: unknown; signal: AbortSignal; timeoutMs?: number; maxBytes?: number }): Promise<unknown> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ApplicationError('INVALID_INPUT', '服务地址无效');
  if (options.token && /[\r\n\x00]/.test(options.token)) throw new ApplicationError('AUTH_REQUIRED', 'Token格式无效');
  if (options.signal.aborted) return Promise.reject(options.signal.reason instanceof ApplicationError ? options.signal.reason : new ApplicationError('CANCELED', '请求已取消'));
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
    const headers: Record<string, string | number> = { Accept: 'application/json', 'User-Agent': 'WillYou/Applications' };
    if (options.token) headers.Token = options.token;
    if (body) { headers['Content-Type'] = 'application/json; charset=utf-8'; headers['Content-Length'] = body.length; }
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: options.method ?? 'GET', headers, agent: false }, response => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.destroy();
        reject(new ApplicationError(status === 401 ? 'AUTH_FAILED' : status === 403 ? 'SCOPE_DENIED' : status === 429 || status >= 500 ? 'TRANSIENT_FAILURE' : 'CONNECTION_UNAVAILABLE', status === 401 ? '服务拒绝当前认证' : status === 403 ? '当前账号无权读取该对象' : '服务暂时不可用或返回非成功状态'));
        return;
      }
      const chunks: Buffer[] = []; let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > (options.maxBytes ?? 8 * 1024 * 1024)) { reject(new ApplicationError('INCOMPLETE_RESULT', '服务响应超过本次资源预算')); response.destroy(); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
          const value: unknown = JSON.parse(text, (_key, item: unknown) => {
            if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) throw new Error('unsafe numeric identity');
            return item;
          }); resolve(value);
        } catch { reject(new ApplicationError('INVALID_RESPONSE', '服务返回的JSON无效或包含无法保真的数字')); }
      });
      response.on('error', () => reject(new ApplicationError('TRANSIENT_FAILURE', '服务响应中断')));
      response.on('aborted', () => reject(new ApplicationError('TRANSIENT_FAILURE', '服务响应未完整接收')));
    });
    const abort = () => request.destroy(options.signal.reason instanceof ApplicationError ? options.signal.reason : new ApplicationError('CANCELED', '请求已取消'));
    const timer = setTimeout(() => request.destroy(new ApplicationError('TIMEOUT', '服务请求超时')), options.timeoutMs ?? 8000);
    options.signal.addEventListener('abort', abort, { once: true });
    request.on('error', error => reject(error instanceof ApplicationError ? error : new ApplicationError('TRANSIENT_FAILURE', '无法完成服务请求')));
    request.on('close', () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort); });
    if (options.signal.aborted) abort();
    if (body) request.write(body);
    request.end();
  });
}
