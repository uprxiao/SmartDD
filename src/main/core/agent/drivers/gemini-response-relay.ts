import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP, type AddressInfo } from 'node:net';
import type { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { createBrotliDecompress, createGunzip, createInflate, createZstdDecompress } from 'node:zlib';
import { DriverError } from '../driver';

const host = '127.0.0.1';
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
const decoders = new Map<string, () => Transform>([
  ['gzip', createGunzip], ['deflate', createInflate], ['br', createBrotliDecompress], ['zstd', createZstdDecompress],
]);

function forwardedHeaders(incoming: http.IncomingHttpHeaders) {
  const headers = { ...incoming };
  for (const name of headers.connection?.toLowerCase().split(',') ?? []) delete headers[name.trim()];
  for (const name of hopHeaders) delete headers[name];
  return headers;
}

function normalizeDataLine(line: string): string {
  if (!line.startsWith('data:')) return line;
  const payload = line.slice('data:'.length);
  let event;
  try { event = JSON.parse(payload); } catch { return line; }
  const headers = event?.sdkHttpResponse?.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return line;
  const names = Object.keys(headers).filter(name => typeof headers[name] === 'string');
  if (!names.length) return line;
  // The Go SDK decodes this metadata as http.Header before yielding the SSE chunk.
  for (const name of names) headers[name] = [headers[name]];
  return `data: ${JSON.stringify(event)}${line.endsWith('\r') ? '\r' : ''}`;
}

async function* normalizeStream(source: AsyncIterable<Buffer>) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of source) {
    const lines = (pending + decoder.write(chunk)).split('\n');
    pending = lines.pop()!;
    for (const line of lines) yield `${normalizeDataLine(line)}\n`;
  }
  pending += decoder.end();
  if (pending) yield normalizeDataLine(pending);
}

async function forwardResponse(upstream: http.IncomingMessage, downstream: http.ServerResponse,
  target: URL, prefix: string, route: string) {
  const status = upstream.statusCode ?? 502;
  const headers = forwardedHeaders(upstream.headers);
  if (headers.location && status >= 300 && status < 400) {
    const location = new URL(headers.location, target);
    // Redirects on the configured API stay inside the relay so the key stays on that origin.
    delete headers.location;
    if (location.origin === target.origin && location.pathname.startsWith(`${prefix}/`)) {
      headers.location = route + location.pathname.slice(prefix.length + 1) + location.search;
    }
  }
  const media = headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  const encoding = headers['content-encoding']?.trim().toLowerCase();
  const decode = decoders.get(encoding ?? '');
  if (status >= 200 && status < 300 && media === 'text/event-stream' && (!encoding || encoding === 'identity' || decode)) {
    delete headers['content-length'];
    delete headers['content-encoding'];
    downstream.writeHead(status, headers).flushHeaders();
    if (decode) await pipeline(upstream, decode(), normalizeStream, downstream);
    else await pipeline(upstream, normalizeStream, downstream);
  } else {
    downstream.writeHead(status, headers);
    await pipeline(upstream, downstream);
  }
}

export async function startGeminiResponseRelay(endpoint: string, env: NodeJS.ProcessEnv) {
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.hash) {
    throw new DriverError('REJECTED', 'Gemini 服务地址无效');
  }
  const prefix = base.pathname.replace(/\/$/, '');
  const route = `/${randomUUID()}/`;
  const transport = base.protocol === 'https:' ? https : http;
  const local = base.hostname === 'localhost' || base.hostname === '[::1]' ||
    (isIP(base.hostname) === 4 && base.hostname.startsWith('127.'));
  const proxyEnv = local ? {} : {
    HTTP_PROXY: env.HTTP_PROXY || env.http_proxy,
    HTTPS_PROXY: env.HTTPS_PROXY || env.https_proxy,
    NO_PROXY: env.NO_PROXY || env.no_proxy,
  };
  const agentOptions = { keepAlive: true, proxyEnv };
  const agent = new transport.Agent(agentOptions);
  const server = http.createServer((req, res) => {
    if (!req.url?.startsWith(route)) {
      res.writeHead(404).end();
      return;
    }
    const incoming = new URL(req.url, `http://${host}`);
    if (!incoming.pathname.startsWith(route)) {
      res.writeHead(404).end();
      return;
    }
    const target = new URL(base);
    target.pathname = prefix + incoming.pathname.slice(route.length - 1);
    for (const name of incoming.searchParams.keys()) target.searchParams.delete(name);
    for (const [name, value] of incoming.searchParams) target.searchParams.append(name, value);
    const headers = forwardedHeaders(req.headers);
    delete headers.host;
    const request = transport.request(target, { method: req.method, headers, agent }, upstream => {
      void forwardResponse(upstream, res, target, prefix, route).catch(() => {
        upstream.destroy();
        res.destroy();
      });
    });
    request.once('error', () => {
      if (!res.headersSent) res.writeHead(502).end('Gemini service connection failed');
      else res.destroy();
    });
    req.once('error', () => request.destroy());
    res.once('close', () => { if (!res.writableFinished) request.destroy(); });
    req.pipe(request);
  });
  const close = () => {
    server.close();
    server.closeAllConnections();
    agent.destroy();
  };
  try {
    server.listen(0, host);
    await once(server, 'listening');
    server.unref();
    const { port } = server.address() as AddressInfo;
    return { endpoint: `http://${host}:${port}${route}`, close };
  } catch (error) {
    close();
    throw error;
  }
}
