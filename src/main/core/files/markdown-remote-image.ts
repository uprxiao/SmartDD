import { lookup } from 'node:dns/promises';
import { request, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP, type TcpNetConnectOpts } from 'node:net';
import { FileError } from '@shared/files';
import { markdownRemoteImageUrl, type MarkdownRemoteImage } from '@shared/markdown-remote-image';
import { safeSvg } from '@shared/safe-image-svg';

const maxBytes = 2 * 1024 * 1024;
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']);
const local4 = new BlockList();
for (const [start, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) local4.addSubnet(start, bits);
const global6 = new BlockList(), special6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
for (const [start, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) special6.addSubnet(start, bits, 'ipv6');

export function publicImageAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? !local4.check(address) : version === 6 && global6.check(address, 'ipv6') && !special6.check(address, 'ipv6');
}

function checkedUrl(href: string) {
  const url = markdownRemoteImageUrl(href);
  if (!url) throw new FileError('INVALID_INPUT', '仅支持公开的 HTTPS 外链图片');
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host) ? !publicImageAddress(host) : !host.includes('.') || /\.(?:local|localhost|internal|home\.arpa)$/.test(host)) {
    throw new FileError('UNTRUSTED', '外链图片不能访问本机或内网地址');
  }
  return url;
}

// This runs in the socket's actual DNS lookup. No second resolution can change
// the destination after the check. A fresh agent is used for each redirect.
const lookupPublic: RequestOptions['lookup'] = (name, _options, callback) => {
  void lookup(name, { all: true }).then(records => {
    const address = records.find(item => publicImageAddress(item.address));
    if (address) callback(null, address.address, address.family);
    else callback(new FileError('UNTRUSTED', '外链图片不能访问本机或内网地址'), '', 0);
  }, error => callback(error, '', 0));
};

function openImage(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions & Pick<TcpNetConnectOpts, 'autoSelectFamily'> = {
      agent: false, autoSelectFamily: false, lookup: lookupPublic, signal, headers: { Accept: [...allowedTypes].join(', ') },
    };
    const req = request(url, options, resolve);
    req.once('error', reject);
    req.end();
  });
}

export async function fetchMarkdownRemoteImage(href: string, owner: AbortSignal): Promise<MarkdownRemoteImage> {
  const signal = AbortSignal.any([owner, AbortSignal.timeout(10_000)]);
  let url = checkedUrl(href);
  for (let redirect = 0; redirect <= 3; redirect++) {
    signal.throwIfAborted();
    const response = await openImage(url, signal);
    try {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location && redirect < 3) {
        url = checkedUrl(new URL(response.headers.location, url).href);
        continue;
      }
      if (response.statusCode !== 200) throw new FileError('UNSUPPORTED', '外链图片服务器未返回图片');
      const mime = response.headers['content-type']?.split(';')[0].trim().toLowerCase() ?? '';
      if (!allowedTypes.has(mime)) throw new FileError('UNSUPPORTED', '外链返回的内容不是受支持的图片');
      if (Number(response.headers['content-length']) > maxBytes) throw new FileError('TOO_LARGE', '外链图片超过 2 MiB');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        size += chunk.length;
        if (size > maxBytes) throw new FileError('TOO_LARGE', '外链图片超过 2 MiB');
        chunks.push(chunk);
      }
      signal.throwIfAborted();
      if (!size) throw new FileError('UNSUPPORTED', '外链返回了空图片');
      const bytes = Buffer.concat(chunks, size);
      return { mime, base64: (mime === 'image/svg+xml' ? Buffer.from(safeSvg(bytes.toString('utf8'))) : bytes).toString('base64') };
    } finally { response.destroy(); }
  }
  throw new FileError('UNSUPPORTED', '外链图片跳转过多');
}
