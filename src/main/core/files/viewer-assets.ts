import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { protocol, session } from 'electron';
import { MEDIA_SCHEME } from '@shared/file-media';
import { HTML_SCHEME } from '@shared/file-html';
import { FILE_RESOURCE_SCHEME } from '@shared/file-resource';
import type { FileMediaService } from './media-service';

// This origin exposes only bundled, public viewer resources. It cannot open a
// project path, forward a network URL, or convey a file lease to another frame.
export const VIEWER_ASSET_SCHEME = 'willyou-assets';
export function registerViewerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: VIEWER_ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true } },
    { scheme: FILE_RESOURCE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
    { scheme: HTML_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}
export function installMediaProtocol(media: FileMediaService, resources?: FileMediaService, binaryMedia = false): void {
  try {
    // Electron keeps only the last listener: install one combined owner gate.
    session.defaultSession.webRequest.onBeforeRequest({ urls: [`${MEDIA_SCHEME}://*/*`, ...(resources ? [`${FILE_RESOURCE_SCHEME}://*/*`] : [])] }, (details, callback) => {
      const frame = details.frame, contents = details.webContents;
      const owner = frame && contents && frame === contents.mainFrame ? `${contents.id}:${frame.processId}:${frame.routingId}` : '';
      const service = details.url.startsWith(`${FILE_RESOURCE_SCHEME}:`) ? resources : binaryMedia ? undefined : media;
      callback({ cancel: !owner || !service?.allows(owner, details.url) });
    });
    if (!binaryMedia) { protocol.handle(MEDIA_SCHEME, (request) => media.handle(request)); media.setProtocolAvailable(true); }
    if (resources) { protocol.handle(FILE_RESOURCE_SCHEME, request => resources.handle(request)); resources.setProtocolAvailable(true); }
  }
  catch { media.setProtocolAvailable(false); resources?.setProtocolAvailable(false); console.warn('[files] Local resource protocol unavailable; media binary fallback enabled, protected image/PDF URLs unavailable'); }
}
export function viewerAssetPath(url: string, directory: string): string | null {
  try {
    const value = new URL(url);
    if (value.protocol !== `${VIEWER_ASSET_SCHEME}:` || value.host !== 'pdf' || value.username || value.password || value.search || value.hash) return null;
    const match = /^\/(cmaps|standard_fonts|wasm)\/([a-zA-Z0-9_-][a-zA-Z0-9_.-]*)$/.exec(value.pathname);
    if (!match || match[2].includes('..')) return null;
    return join(directory, match[1], match[2]);
  } catch { return null; }
}
export function installViewerAssets(directory: string): void {
  protocol.handle(VIEWER_ASSET_SCHEME, async (request) => {
    const path = viewerAssetPath(request.url, directory);
    if (!path || request.method !== 'GET') return new Response('Not found', { status: 404 });
    try {
      const bytes = await readFile(path);
      const type = path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
      return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
}
