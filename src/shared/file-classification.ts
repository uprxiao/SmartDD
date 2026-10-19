/** Local routing hints, never a claim that a decoder accepts the whole file.
 * Signatures follow WHATWG MIME Sniffing §6/7. The control-byte fallback
 * follows the reviewed M9 reference: C0 values 7..14 are allowed text.
 * Only the first 4096 authorized bytes are examined; SVG uses at most 512. */
export type FileContentKind = 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'notebook' | 'office' | 'archive' | 'unsupported' | 'binary';
export interface FileClassification { kind: FileContentKind; mime?: string; format?: string; container?: 'archive'; reason?: string; basis: 'extension' | 'signature' | 'sample' }
export const FILE_ARCHIVE_EXTENSIONS = ['7z', 'Z', 'apk', 'bz2', 'docm', 'docx', 'epub', 'gz', 'jar', 'odp', 'ods', 'odt', 'potm', 'potx', 'ppsm', 'ppsx', 'pptm', 'pptx', 'rar', 'tar', 'tar.gz', 'xlsm', 'xlsx', 'xpi', 'xz', 'zip', 'zst'] as const;
const images: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', ico: 'image/x-icon', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' };
const audio: Record<string, string> = { aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4', mp3: 'audio/mpeg', mp4a: 'audio/mp4', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' };
const video: Record<string, string> = { mp4: 'video/mp4', ogv: 'video/ogg', webm: 'video/webm' };
export function classifyFile(name: string, input: Uint8Array): FileClassification {
  const bytes = input.subarray(0, 4096), lower = name.toLowerCase(), extension = lower.includes('.') ? lower.split('.').at(-1)! : '';
  const match = (signature: readonly number[], offset = 0) => bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);
  const ascii = (value: string, offset = 0) => match([...value].map((char) => char.charCodeAt(0)), offset);
  const archive = FILE_ARCHIVE_EXTENSIONS.some((value) => lower.endsWith('.' + value.toLowerCase()));
  const typed = (kind: FileContentKind, mime?: string, basis: FileClassification['basis'] = 'extension'): FileClassification => ({ kind, ...(mime ? { mime } : {}), ...(extension ? { format: extension } : {}), ...(archive || kind === 'archive' ? { container: 'archive' as const } : {}), basis });
  if (['tif', 'tiff'].includes(extension)) return { ...typed('unsupported'), reason: '当前文件工作区不支持 TIFF 预览；可使用外部应用打开或另存副本。' };
  if (['doc', 'ppt', 'xls', 'key', 'numbers', 'pages', 'odp', 'ods', 'odt', 'rtf'].includes(extension)) return { ...typed('unsupported'), reason: `当前未提供 ${extension.toUpperCase()} 文件查看器；可使用外部应用打开或另存副本。` };
  // Artifact formats precede the archive container hint.
  if (['docx', 'pptx', 'xlsx', 'xlsm'].includes(extension)) return typed('office');
  if (extension === 'pdf') return typed('pdf', 'application/pdf');
  if (extension === 'ipynb') return typed('notebook', 'application/x-ipynb+json');
  if (extension === 'wasm') return { ...typed('binary', 'application/wasm'), reason: 'WebAssembly 二进制文件不提供文本编辑；可另存副本或在外部应用打开。' };
  if (archive) return typed('archive');
  if (ascii('%PDF-')) return typed('pdf', 'application/pdf', 'signature');
  if (match([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return typed('image', 'image/png', 'signature');
  if (match([0xff, 0xd8, 0xff])) return typed('image', 'image/jpeg', 'signature');
  if (ascii('GIF87a') || ascii('GIF89a')) return typed('image', 'image/gif', 'signature');
  if (ascii('BM')) return typed('image', 'image/bmp', 'signature');
  if (match([0, 0, 1, 0]) || match([0, 0, 2, 0])) return typed('image', 'image/x-icon', 'signature');
  if (ascii('RIFF') && ascii('WEBP', 8)) return typed('image', 'image/webp', 'signature');
  if (match([0x49, 0x49, 0x2a, 0]) || match([0x4d, 0x4d, 0, 0x2a])) return { kind: 'unsupported', format: 'tiff', basis: 'signature', reason: '当前文件工作区不支持 TIFF 预览；可使用外部应用打开或另存副本。' };
  if (images[extension]) return typed('image', images[extension]);
  if (audio[extension]) return typed('audio', audio[extension]);
  if (video[extension]) return typed('video', video[extension]);
  if (['aif', 'aiff', 'avi', 'mov', 'mkv', 'wmv', 'wma', 'heic', 'heif', 'jxl', 'psd'].includes(extension)) return { ...typed('unsupported'), reason: `当前未提供 ${extension.toUpperCase()} 预览；可使用外部应用打开或另存副本。` };
  if (ascii('RIFF') && (ascii('WAVE', 8) || ascii('AVI ', 8)) || ascii('ID3') || ascii('fLaC') || ascii('OggS') || ascii('FORM') && (ascii('AIFF', 8) || ascii('AIFC', 8))) return { kind: 'unsupported', basis: 'signature', reason: '已识别为媒体数据，但当前文件没有受支持的媒体类型；可使用外部应用打开或另存副本。' };
  if (match([0x50, 0x4b, 3, 4]) || match([0x50, 0x4b, 5, 6]) || match([0x1f, 0x8b, 8]) || ascii('Rar!')) return typed('archive', undefined, 'signature');
  if (match([0, 0x61, 0x73, 0x6d])) return typed('binary', 'application/wasm', 'signature');
  // A text BOM is an encoding hint, not permission to write that encoding.
  if (match([0xfe, 0xff]) || match([0xff, 0xfe]) || match([0xef, 0xbb, 0xbf])) return typed('text', undefined, 'sample');
  if ([...bytes].some((value) => value < 32 && (value < 7 || value > 14))) return typed('binary', undefined, 'sample');
  const prefix = new TextDecoder('utf-8').decode(bytes.subarray(0, 512));
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(prefix)) return typed('image', 'image/svg+xml', 'signature');
  return typed('text', undefined, 'sample');
}
