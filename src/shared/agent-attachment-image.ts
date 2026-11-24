export type AttachmentImageSource =
  | { kind: 'draft'; attachmentId: string }
  | { kind: 'message'; turnId: string; index: number };

const rasterTypes = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'], ['webp', 'image/webp'], ['avif', 'image/avif'],
  ['bmp', 'image/bmp'], ['ico', 'image/x-icon'],
]);
const rasterMimes = new Set(rasterTypes.values());

export function attachmentImageMime(name: string, mime?: string): string | undefined {
  if (mime && rasterMimes.has(mime)) return mime;
  const dot = name.lastIndexOf('.');
  return dot < 0 ? undefined : rasterTypes.get(name.slice(dot + 1).toLowerCase());
}
