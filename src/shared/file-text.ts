import { FILE_LIMITS, FileError } from './files';

export type Eol = '\r\n' | '\r' | '\n';
export type EolRun = [count: number, ending: Eol];
export type DecodedFileText =
  | { kind: 'text'; raw: string; bom: boolean; editable: boolean; reason?: string }
  | { kind: 'binary' | 'unsupported-encoding' | 'too-large'; editable: false; reason: string };

/** No replacement characters or implicit transcoding may enter a saved file. */
export function decodeFileText(bytes: Uint8Array): DecodedFileText {
  if (bytes.byteLength > FILE_LIMITS.readableText) return { kind: 'too-large', editable: false, reason: '文件超过 20 MiB，未载入全文编辑器' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff) return { kind: 'unsupported-encoding', editable: false, reason: '此文件使用 UTF-16；当前未提供无损写回能力，请在外部应用打开' };
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
    if (raw.includes('\0')) return { kind: 'binary', editable: false, reason: '此文件包含二进制数据，不能作为文本编辑' };
    const editable = bytes.byteLength <= FILE_LIMITS.editableText;
    return { kind: 'text', raw, bom, editable, ...(!editable ? { reason: '文件超过 10 MiB，当前以只读文本打开' } : {}) };
  } catch { return { kind: 'unsupported-encoding', editable: false, reason: '无法按 UTF-8 无损解码；已保留原始字节，请在外部应用打开' }; }
}

export function encodeFileText(raw: string, bom: boolean, purpose: 'save' | 'checkpoint' = 'save'): Uint8Array {
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = raw.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new FileError('INVALID_INPUT', '文本包含不完整的 Unicode 字符，未写入磁盘');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new FileError('INVALID_INPUT', '文本包含不完整的 Unicode 字符，未写入磁盘');
  }
  const bytes = new TextEncoder().encode(raw);
  const output = bom ? new Uint8Array(bytes.byteLength + 3) : bytes;
  if (bom) { output.set([0xef, 0xbb, 0xbf]); output.set(bytes, 3); }
  if (output.byteLength > (purpose === 'checkpoint' ? FILE_LIMITS.readableText : FILE_LIMITS.editableText)) throw new FileError('TOO_LARGE', purpose === 'checkpoint' ? '修改超过 20 MiB 草稿上限；内存内容仍保留，请先缩减或另存' : '文本超过 10 MiB 可编辑上限；修改仍保留，可另存或缩减内容');
  return output;
}

// Ported from the reviewed P1 editor experiment in this repository. Source
// offsets and CodeMirror positions are UTF-16; disk bytes stay separate.
export function textOffsetMap(raw: string) {
  const breaks: { raw: number; cm: number }[] = [];
  const normalizedParts: string[] = [];
  let from = 0, extra = 0;
  for (const match of raw.matchAll(/\r\n|\r|\n/g)) {
    normalizedParts.push(raw.slice(from, match.index), '\n');
    if (match[0].length === 2) breaks.push({ raw: match.index, cm: match.index - extra });
    extra += match[0].length - 1; from = match.index + match[0].length;
  }
  normalizedParts.push(raw.slice(from));
  const normalized = normalizedParts.join('');
  const countBefore = (position: number, key: 'cm' | 'raw') => {
    let low = 0, high = breaks.length;
    while (low < high) { const mid = (low + high) >> 1; if (breaks[mid][key] < position) low = mid + 1; else high = mid; }
    return low;
  };
  return {
    normalized,
    cmToRaw(position: number): number {
      if (!Number.isInteger(position) || position < 0 || position > normalized.length) throw new FileError('INVALID_INPUT', '编辑器位置超出文档');
      return position + countBefore(position, 'cm');
    },
    rawToCm(position: number): number {
      if (!Number.isInteger(position) || position < 0 || position > raw.length) throw new FileError('INVALID_INPUT', '源码位置超出文档');
      return position - countBefore(position, 'raw');
    },
  };
}

export function preferredEol(raw: string): Eol {
  const counts = new Map<Eol, number>([['\r\n', 0], ['\r', 0], ['\n', 0]]);
  for (const match of raw.matchAll(/\r\n|\r|\n/g)) counts.set(match[0] as Eol, counts.get(match[0] as Eol)! + 1);
  if (![...counts.values()].some(Boolean)) return '\n';
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}
export function eolRuns(raw: string): EolRun[] {
  const runs: EolRun[] = [];
  for (const match of raw.matchAll(/\r\n|\r|\n/g)) {
    const last = runs.at(-1), eol = match[0] as Eol;
    if (last?.[1] === eol) last[0]++; else runs.push([1, eol]);
  }
  return runs;
}
export function restoreEols(raw: string, runs: EolRun[]): string {
  let group = 0, count = 0, used = 0;
  const value = raw.replace(/\r\n|\r|\n/g, () => {
    if (!runs[group]) throw new FileError('INVALID_INPUT', '换行历史与当前内容不匹配');
    const eol = runs[group][1]; used++;
    if (++count === runs[group][0]) { group++; count = 0; }
    return eol;
  });
  if (used !== runs.reduce((sum, run) => sum + run[0], 0)) throw new FileError('INVALID_INPUT', '换行历史与当前内容不匹配');
  return value;
}
