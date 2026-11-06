import { z } from 'zod';
import { fileRefSchema } from './files';

export const MEDIA_LIMIT = 128 * 1024 * 1024;
export const MEDIA_SCHEME = 'willyou-media';
export const mediaOpenSchema = z.object({ id: z.string().uuid(), ref: fileRefSchema, baseHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type MediaOpenInput = z.infer<typeof mediaOpenSchema>;
export interface MediaSource { id: string; transport: 'protocol' | 'binary'; url?: string; mime: string; size: number; hash: string }
const audio: Record<string, string> = { aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4', mp3: 'audio/mpeg', mp4a: 'audio/mp4', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' };
const video: Record<string, string> = { mp4: 'video/mp4', ogv: 'video/ogg', webm: 'video/webm' };
export function mediaType(name: string): { kind: 'audio' | 'video'; mime: string } | null {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
  return Object.hasOwn(audio, extension) ? { kind: 'audio', mime: audio[extension] } : Object.hasOwn(video, extension) ? { kind: 'video', mime: video[extension] } : null;
}
