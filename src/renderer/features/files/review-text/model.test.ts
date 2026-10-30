import { expect, it } from 'vitest';
import { FILE_LIMITS } from '@shared/files';
import { REVIEW_TEXT_LIMIT, REVIEW_TEXT_PAGE_BYTES, ReviewTextModel, reviewTextVerdict } from './model.mjs';

it('K06 preserves strict256MiB acceptance, unsupported priority and ordinary editor limits without allocating boundary arrays', () => {
  expect(REVIEW_TEXT_LIMIT).toBe(FILE_LIMITS.asset);
  expect([REVIEW_TEXT_LIMIT - 1, REVIEW_TEXT_LIMIT, REVIEW_TEXT_LIMIT + 1].map(size => reviewTextVerdict('text', size))).toEqual(['readable', 'readable', 'too-large']);
  expect(reviewTextVerdict('unsupported', REVIEW_TEXT_LIMIT + 1)).toBe('unsupported');
  expect(reviewTextVerdict('binary', REVIEW_TEXT_LIMIT + 1)).toBe('unsupported');
  expect(reviewTextVerdict('text', NaN)).toBe('invalid');
  expect(FILE_LIMITS.editableText).toBe(10 * 1024 * 1024); expect(FILE_LIMITS.readableText).toBe(20 * 1024 * 1024);
});
it.each(['中', '🙂', '\r\n'])('bounded windows preserve exact%s crossing a64KiB boundary and true EOF', marker => {
  const prefix = 'A'.repeat(REVIEW_TEXT_PAGE_BYTES - 1), raw = prefix + marker + 'B'.repeat(REVIEW_TEXT_PAGE_BYTES) + '\nTRUE_EOF';
  const bytes = new TextEncoder().encode(raw), model = new ReviewTextModel(bytes), windows = Array.from({ length: model.info.pages }, (_, index) => model.window(index));
  expect(windows.map(value => value.text).join('')).toBe(raw); expect(windows.at(-1)!.text.endsWith('TRUE_EOF')).toBe(true);
  expect(windows[0].start).toBe(0); expect(windows.at(-1)!.end).toBe(bytes.length);
  for (let i = 0; i < windows.length; i++) {
    expect(windows[i].end - windows[i].start).toBeLessThanOrEqual(REVIEW_TEXT_PAGE_BYTES + 4);
    if (i) expect(windows[i].start).toBe(windows[i - 1].end);
    expect(windows[i].text).not.toContain('\ufffd');
  }
});
it('validation crosses1MiB decoder slices and does not expose invalid or binary suffixes as complete text', () => {
  const raw = 'a'.repeat(1024 * 1024 - 2) + '中🙂\r\n' + 'complete';
  const model = new ReviewTextModel(new TextEncoder().encode(raw));
  expect(Array.from({ length: model.info.pages }, (_, i) => model.window(i).text).join('')).toBe(raw);
  expect(() => new ReviewTextModel(new Uint8Array([65, 0xff]))).toThrow('[UNSUPPORTED]');
  expect(() => new ReviewTextModel(new Uint8Array([65, 0]))).toThrow('[UNSUPPORTED]');
  expect(() => new ReviewTextModel(new Uint8Array([0xff, 0xfe, 65, 0]))).toThrow('UTF-16');
});
it('BOM is suppressed once, empty files stay readable, and invalid page requests never return a prefix', () => {
  const model = new ReviewTextModel(new TextEncoder().encode('\ufefffirst\ufefflast'));
  expect(model.window(0).text).toBe('first\ufefflast');
  const empty = new ReviewTextModel(new Uint8Array()); expect(empty.info).toEqual({ bytes: 0, pages: 1 }); expect(empty.window(0).text).toBe('');
  for (const page of [-1, .5, NaN, 1]) expect(() => model.window(page)).toThrow('[INVALID_INPUT]');
});
