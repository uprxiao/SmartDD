import { describe, expect, it } from 'vitest';
import { classifyFile, FILE_ARCHIVE_EXTENSIONS } from './file-classification';
const bytes = (value: string) => new TextEncoder().encode(value);
describe('file type hints and safe text routing', () => {
  it('uses content signatures for misleading text names and extensionless local images/PDF', () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(classifyFile('fake.txt', png)).toMatchObject({ kind: 'image', mime: 'image/png', basis: 'signature' });
    expect(classifyFile('picture', png).kind).toBe('image');
    expect(classifyFile('document', bytes('%PDF-1.7')).kind).toBe('pdf');
    expect(classifyFile('vector', bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatchObject({ kind: 'image', mime: 'image/svg+xml' });
  });
  it('keeps unsupported Office and TIFF out of text editing and preserves artifact precedence', () => {
    for (const extension of ['doc', 'ppt', 'xls', 'key', 'numbers', 'pages', 'odp', 'ods', 'odt', 'rtf', 'tif', 'tiff']) expect(classifyFile('file.' + extension, bytes('ASCII CONTENT')).kind).toBe('unsupported');
    for (const extension of ['docx', 'pptx', 'xlsx', 'xlsm']) expect(classifyFile('file.' + extension, Uint8Array.from([80, 75, 3, 4])).kind).toBe('office');
    expect(classifyFile('unknown', Uint8Array.from([73, 73, 42, 0])).kind).toBe('unsupported');
  });
  it('covers all 27 archived suffixes with Office overrides and case-insensitive compound suffixes', () => {
    expect(FILE_ARCHIVE_EXTENSIONS).toHaveLength(27);
    for (const extension of FILE_ARCHIVE_EXTENSIONS) {
      const result = classifyFile(`file.${extension.toUpperCase()}`, new Uint8Array());
      expect(result.container).toBe('archive');
      expect(result.kind).toBe(['docx', 'pptx', 'xlsx', 'xlsm'].includes(extension.toLowerCase()) ? 'office' : ['odp', 'ods', 'odt'].includes(extension.toLowerCase()) ? 'unsupported' : 'archive');
    }
    expect(classifyFile('file.TAR.GZ', new Uint8Array()).kind).toBe('archive');
    expect(classifyFile('archive', Uint8Array.from([80, 75, 5, 6])).kind).toBe('archive');
  });
  it('uses exactly 4096 sample bytes, preserves permitted controls and never treats wasm as text', () => {
    expect(classifyFile('empty', new Uint8Array()).kind).toBe('text');
    expect(classifyFile('short', bytes('x')).kind).toBe('text');
    expect(classifyFile('allowed', Uint8Array.from([7, 8, 9, 10, 11, 12, 13, 14, 32, 65])).kind).toBe('text');
    for (const value of [0, 6, 15, 26, 27, 28, 31]) expect(classifyFile('control.txt', Uint8Array.from([65, value])).kind).toBe('binary');
    const sample = new Uint8Array(4097).fill(65); sample[4096] = 0; expect(classifyFile('sample', sample).kind).toBe('text'); sample[4095] = 0; expect(classifyFile('sample', sample).kind).toBe('binary');
    expect(classifyFile('module.wasm', bytes('ASCII symbols')).kind).toBe('binary');
    expect(classifyFile('utf16', Uint8Array.from([255, 254, 65, 0])).kind).toBe('text');
    expect(classifyFile('invalid.mp4', bytes('broken')).kind).toBe('video');
    expect(classifyFile('unknown.avi', bytes('broken')).kind).toBe('unsupported');
  });
});
