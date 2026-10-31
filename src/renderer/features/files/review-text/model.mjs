export const REVIEW_TEXT_LIMIT = 256 * 1024 * 1024;
export const REVIEW_TEXT_PAGE_BYTES = 64 * 1024;

// Classification is deliberately checked before size. This verdict never
// authorizes a file; the caller must already hold its owner-bound capability.
export function reviewTextVerdict(kind, size) {
  if (kind !== 'text') return 'unsupported';
  if (!Number.isSafeInteger(size) || size < 0) return 'invalid';
  return size > REVIEW_TEXT_LIMIT ? 'too-large' : 'readable';
}

/** One bounded raw source, <=4097 page offsets, and one <=64KiB+4 UTF8 window.
 * Validation runs in a Worker; no whole decoded string, line array or editor
 * history is retained. Joining every window recovers the complete UTF8 text. */
export class ReviewTextModel {
  #bytes;
  #offsets;
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('[INVALID_INPUT] 无效文本数据');
    if (bytes.byteLength > REVIEW_TEXT_LIMIT) throw new Error('[TOO_LARGE] 文本超过 256 MiB 只读预览上限');
    if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff) throw new Error('[UNSUPPORTED] 此只读预览尚不支持 UTF-16；原始文件已保留');
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    try {
      for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + 1024 * 1024));
        if (chunk.includes(0)) throw new Error('binary');
        decoder.decode(chunk, { stream: true });
      }
      decoder.decode();
    } catch { throw new Error('[UNSUPPORTED] 文件不是可无损读取的 UTF-8 文本；原始字节已保留'); }
    const offsets = [0];
    for (let offset = REVIEW_TEXT_PAGE_BYTES; offset < bytes.length; offset += REVIEW_TEXT_PAGE_BYTES) {
      let boundary = offset;
      while (boundary < bytes.length && (bytes[boundary] & 0xc0) === 0x80) boundary++;
      if (bytes[boundary] === 10 && bytes[boundary - 1] === 13) boundary++;
      if (boundary < bytes.length && boundary > offsets.at(-1)) offsets.push(boundary);
    }
    offsets.push(bytes.length);
    this.#bytes = bytes; this.#offsets = new Uint32Array(offsets);
  }
  get info() { return { bytes: this.#bytes.length, pages: this.#offsets.length - 1 }; }
  window(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.info.pages) throw new Error('[INVALID_INPUT] 文本块超出范围');
    const start = this.#offsets[index], end = this.#offsets[index + 1];
    const bom = index === 0 && this.#bytes[0] === 0xef && this.#bytes[1] === 0xbb && this.#bytes[2] === 0xbf ? 3 : 0;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(this.#bytes.subarray(start + bom, end));
    return { index, start, end, text, total: this.#bytes.length, pages: this.info.pages };
  }
}
