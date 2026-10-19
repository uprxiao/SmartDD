// Independent R3.4-P1 byte boundaries. Do not import production FILE_LIMITS.
export const EDIT_BYTES = 10 * 1024 * 1024;
export const READ_BYTES = 20 * 1024 * 1024;
export const textSizeCases = [
  ...[-1, 0, 1].map(delta => ({ id: `edit-${delta + 1}`, caseId: 'M9-T-K01', bytes: EDIT_BYTES + delta })),
  ...[-1, 0, 1].map(delta => ({ id: `read-${delta + 1}`, caseId: 'M9-T-K02', bytes: READ_BYTES + delta })),
];
export function exactUtf8Text(size, bom = false) {
  // Short logical lines avoid conflating size policy with long-line rendering.
  const line = Buffer.from('中文文🙂'.repeat(192) + '\n'), prefix = bom ? Buffer.from([239, 187, 191]) : Buffer.alloc(0);
  if (size < prefix.length) throw Error('Invalid fixture size');
  const bytes = Buffer.alloc(size, 120); prefix.copy(bytes);
  let offset = prefix.length;
  while (offset + line.length <= size) { line.copy(bytes, offset); offset += line.length; }
  return bytes;
}
export const textSizeMetadata = bytes => ({ bytes: bytes.length, units: bytes.toString('utf8').replace(/^\ufeff/, '').length, editable: bytes.length <= EDIT_BYTES, readable: bytes.length <= READ_BYTES });
