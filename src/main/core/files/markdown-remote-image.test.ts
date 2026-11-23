import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchMarkdownRemoteImage, publicImageAddress } from './markdown-remote-image';

const io = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: io.request }));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));

type Reply = { statusCode?: number; headers?: Record<string, string>; chunks?: Buffer[] };
const signal = () => new AbortController().signal;

function responses(...queue: Reply[]) {
  const addresses: string[] = [];
  io.request.mockImplementation((url, options, reply) => {
    const req = new EventEmitter();
    return Object.assign(req, { end() {
      options.lookup(url.hostname, {}, (error: Error | null, address: string) => {
        if (error) { req.emit('error', error); return; }
        addresses.push(address);
        const value = queue.shift();
        if (!value) { req.emit('error', new Error('Unexpected request')); return; }
        reply(Object.assign(Readable.from(value.chunks ?? []), { statusCode: value.statusCode ?? 200, headers: value.headers ?? {} }));
      });
    } });
  });
  return addresses;
}

beforeEach(() => { vi.resetAllMocks(); io.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); });

it.each(['https://localhost/logo.svg', 'https://127.0.0.1/logo.svg', 'https://[::1]/logo.svg', 'https://internal.local/logo.svg',
  'https://user:secret@example.org/logo.svg', 'http://example.org/logo.svg', 'https://example.org:8080/logo.svg'])(
  'rejects unsupported or local destinations before opening a socket %s', async href => {
    await expect(fetchMarkdownRemoteImage(href, signal())).rejects.toThrow();
    expect(io.request).not.toHaveBeenCalled();
  },
);

it('rejects private DNS results and applies the same check to redirects', async () => {
  const addresses = responses({ statusCode: 302, headers: { location: 'https://second.example.org/logo.svg' } });
  io.lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValueOnce([{ address: '10.10.0.3', family: 4 }]);
  await expect(fetchMarkdownRemoteImage('https://first.example.org/logo.svg', signal())).rejects.toThrow('内网');
  expect(addresses).toEqual(['8.8.8.8']);
});

it('pins the checked public address and sanitizes SVG before returning bytes', async () => {
  io.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }, { address: '2001:4860:4860::8888', family: 6 }]);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20" onload="x()"><script>x()</script><rect width="60" height="20"/></svg>';
  const addresses = responses({ headers: { 'content-type': 'image/svg+xml; charset=utf-8' }, chunks: [Buffer.from(svg)] });
  const image = await fetchMarkdownRemoteImage('https://badge.example.org/a.svg', signal());
  expect(addresses).toEqual(['2001:4860:4860::8888']);
  expect(image.mime).toBe('image/svg+xml');
  const output = Buffer.from(image.base64, 'base64').toString();
  expect(output).toContain('<rect');
  expect(output).not.toMatch(/onload|<script|x\(\)/);
});

it('bounds bytes and rejects a successful HTML response', async () => {
  responses({ headers: { 'content-type': 'image/png' }, chunks: [Buffer.alloc(2 * 1024 * 1024), Buffer.alloc(1)] },
    { headers: { 'content-type': 'text/html' }, chunks: [Buffer.from('<p>not an image</p>')] });
  await expect(fetchMarkdownRemoteImage('https://badge.example.org/large', signal())).rejects.toThrow('超过 2 MiB');
  await expect(fetchMarkdownRemoteImage('https://badge.example.org/html', signal())).rejects.toThrow('不是受支持的图片');
});

it('classifies network ranges independently of their URL representation', () => {
  expect(['0.2.3.4', '100.64.1.1', '224.0.0.1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2002:7f00:1::1'].some(publicImageAddress)).toBe(false);
  expect(['1.1.1.1', '2606:4700:4700::1111'].every(publicImageAddress)).toBe(true);
});
