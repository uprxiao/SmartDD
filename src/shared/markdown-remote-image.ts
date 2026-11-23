import { z } from 'zod';

export function markdownRemoteImageUrl(value: string): URL | null {
  if (value.length > 8192 || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

export const markdownRemoteImageRequest = z.object({ id: z.string().uuid(), href: z.string().max(8192) });
export type MarkdownRemoteImageRequest = z.infer<typeof markdownRemoteImageRequest>;
export interface MarkdownRemoteImage { mime: string; base64: string }
