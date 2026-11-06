/** OOXML ST_Xstring escaping, including literal escape-looking text and CR.
 * Decode in one pass: an escaped underscore must not start a second escape.
 * See MS-OE376 §2.1.1127. Formula expressions are not ST_Xstring. */
export const decodeOfficeString = (value: string): string => value.replace(/_x([0-9a-fA-F]{4})_/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
export function encodeOfficeString(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index), next = value.charCodeAt(index + 1);
    if (value[index] === '_' && /^_x[0-9a-fA-F]{4}_/.test(value.slice(index))) output += '_x005F_';
    else if ((code < 0x20 && code !== 9 && code !== 10) || code === 0xfffe || code === 0xffff || code >= 0xd800 && code <= 0xdbff && !(next >= 0xdc00 && next <= 0xdfff) || code >= 0xdc00 && code <= 0xdfff && !(index > 0 && value.charCodeAt(index - 1) >= 0xd800 && value.charCodeAt(index - 1) <= 0xdbff)) output += `_x${code.toString(16).padStart(4, '0').toUpperCase()}_`;
    else output += value[index];
  }
  return output;
}
