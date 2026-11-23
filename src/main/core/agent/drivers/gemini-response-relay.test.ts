import { once } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { startGeminiResponseRelay } from './gemini-response-relay';

async function listen(handler: RequestListener) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close() { server.close(); server.closeAllConnections(); },
  };
}

const payload = {
  candidates: [{ content: { parts: [{ text: '流式回复' }, { thoughtSignature: 'fixture-signature' }] } }],
  sdkHttpResponse: { headers: { 'Alt-Svc': 'h3=":443", h3-29=":443"', Vary: ['Accept-Encoding', 'Origin'] } },
};
const adapted = {
  ...payload, sdkHttpResponse: { headers: { 'Alt-Svc': [payload.sdkHttpResponse.headers['Alt-Svc']], Vary: payload.sdkHttpResponse.headers.Vary } },
};

test('forwards partial SSE before the upstream closes and preserves native request and response fields', async () => {
  let request: { url?: string; key?: string | string[]; body: string } | undefined;
  let finishStream: (() => void) | undefined;
  const upstream = await listen(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    request = { url: req.url, key: req.headers['x-goog-api-key'], body };
    const event = Buffer.from(`: keepalive\r\ndata: ${JSON.stringify(payload)}\r\n\r\n`);
    const split = event.indexOf(Buffer.from('流')) + 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    res.write(event.subarray(0, split), () => res.write(event.subarray(split)));
    finishStream = () => res.end('data: {"usageMetadata":{"totalTokenCount":2}}\n\n');
  });
  const relay = await startGeminiResponseRelay(`${upstream.url}/gemini?tenant=fixture`, { HTTP_PROXY: 'http://127.0.0.1:1' });
  const path = 'v1beta/models/custom-model:streamGenerateContent?alt=sse';
  try {
    const rejected = await fetch(new URL('/' + path, relay.endpoint), { signal: AbortSignal.timeout(2000) });
    expect(rejected.status).toBe(404);
    expect(request).toBeUndefined();

    const response = await fetch(relay.endpoint + path, {
      method: 'POST', body: '{"contents":[]}', headers: { 'x-goog-api-key': 'fixture-key' }, signal: AbortSignal.timeout(2500),
    });
    expect(response.ok).toBe(true);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let read = '';
    while (!read.includes('\r\n\r\n')) {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      read += decoder.decode(chunk.value, { stream: true });
    }
    const firstEvent = `: keepalive\r\ndata: ${JSON.stringify(adapted)}\r\n\r\n`;
    expect(read).toBe(firstEvent);
    expect(request).toEqual({ url: '/gemini/v1beta/models/custom-model:streamGenerateContent?tenant=fixture&alt=sse', key: 'fixture-key', body: '{"contents":[]}' });
    finishStream!();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      read += decoder.decode(chunk.value, { stream: true });
    }
    expect(read + decoder.decode()).toBe(firstEvent + 'data: {"usageMetadata":{"totalTokenCount":2}}\n\n');
  } finally {
    relay.close();
    upstream.close();
  }
});

test('uses the configured HTTP proxy, adapts compressed SSE, and preserves an upstream HTTP error', async () => {
  const urls: string[] = [];
  const proxy = await listen((req, res) => {
    urls.push(req.url!);
    if (req.url!.includes('bad-model')) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":{"code":401,"message":"fixture"}}');
      return;
    }
    const body = gzipSync(`data: ${JSON.stringify(payload)}\n\n`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Content-Encoding': 'gzip', 'Content-Length': body.length }).end(body);
  });
  const origin = 'http://gemini.example.invalid/gateway';
  const relay = await startGeminiResponseRelay(origin, { http_proxy: proxy.url });
  try {
    const paths = ['/v1beta/models/new-model:streamGenerateContent', '/v1beta/models/bad-model:streamGenerateContent'];
    const [stream, failure] = await Promise.all(paths.map(path => fetch(relay.endpoint + path.slice(1), { signal: AbortSignal.timeout(2000) })));
    expect(stream.headers.get('content-encoding')).toBeNull();
    expect(await stream.text()).toBe(`data: ${JSON.stringify(adapted)}\n\n`);
    expect(failure.status).toBe(401);
    expect(await failure.json()).toEqual({ error: { code: 401, message: 'fixture' } });
    expect(urls.sort()).toEqual(paths.map(path => origin + path).sort());
  } finally {
    relay.close();
    proxy.close();
  }
});
