import { describe, expect, it } from 'vitest';
import { decodeFileText, encodeFileText } from '@shared/file-text';
import { EDIT_BYTES, READ_BYTES, exactUtf8Text, textSizeCases } from '../../../../scripts/files/text-size-fixtures.mjs';

describe('K01/K02 exact UTF-8 byte policy, independent of code units', () => {
  it.each(textSizeCases.flatMap(item => [false, true].map(bom => ({ ...item, bom }))))('$caseId $bytes bytes, BOM=$bom', ({ bytes: size, bom }) => {
    const bytes = exactUtf8Text(size, bom), raw = bytes.subarray(bom ? 3 : 0).toString('utf8'), decoded = decodeFileText(bytes);
    expect(bytes.length).toBe(size); expect(raw.length).toBeLessThan(EDIT_BYTES);
    if (size > READ_BYTES) expect(decoded).toMatchObject({ kind: 'too-large', editable: false });
    else {
      expect(decoded).toMatchObject({ kind: 'text', editable: size <= EDIT_BYTES, bom });
      if (decoded.kind !== 'text') throw Error('Expected lossless text');
      expect(decoded.raw).toBe(raw);
    }
    if (size <= EDIT_BYTES) expect(Buffer.from(encodeFileText(raw, bom)).equals(bytes)).toBe(true);
    else expect(() => encodeFileText(raw, bom)).toThrow('10 MiB');
    if (size <= READ_BYTES) expect(Buffer.from(encodeFileText(raw, bom, 'checkpoint')).equals(bytes)).toBe(true);
    else expect(() => encodeFileText(raw, bom, 'checkpoint')).toThrow('20 MiB');
  });
});
