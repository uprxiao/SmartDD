import { FileError } from '@shared/files';

const columnIndex = (letters: string) => { let value = 0; for (const char of letters.toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64; return value; };
const columnText = (index: number) => { let text = ''; for (; index; index = Math.floor((index - 1) / 26)) text = String.fromCharCode(65 + (index - 1) % 26) + text; return text; };
const identifier = (char: string) => /[\p{L}\p{N}_.\\]/u.test(char);

/** Translate only A1 reference tokens. String literals, quoted sheet names,
 * external workbook qualifiers, names and structured table selectors are kept
 * verbatim. This is not a formula evaluator. */
export function translateOfficeFormula(source: string, rowDelta: number, columnDelta: number): string {
  if (source.length > 8192) throw new FileError('TOO_LARGE', '共享公式超过 8192 个字符');
  let result = '', index = 0;
  const translate = (token: string, columns: boolean) => {
    const absolute = token[0] === '$', raw = absolute ? token.slice(1) : token;
    const before = columns ? columnIndex(raw) : Number(raw), after = before + (absolute ? 0 : columns ? columnDelta : rowDelta), max = columns ? 16384 : 1048576;
    if (before < 1 || before > max) return null;
    if (after < 1 || after > max) return '#REF!';
    return `${absolute ? '$' : ''}${columns ? columnText(after) : after}`;
  };
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'") {
      const start = index++;
      for (;;) {
        if (index >= source.length) throw new FileError('INVALID_INPUT', '公式引用引号未闭合');
        if (source[index++] !== char) continue;
        if (source[index] === char) { index++; continue; }
        break;
      }
      result += source.slice(start, index); continue;
    }
    if (char === '[') {
      const start = index++; let depth = 1;
      while (index < source.length && depth) { if (source[index] === '[') depth++; else if (source[index] === ']') depth--; index++; }
      if (depth) throw new FileError('INVALID_INPUT', '公式表引用未闭合');
      result += source.slice(start, index); continue;
    }
    const rest = source.slice(index), boundary = index === 0 || !identifier(source[index - 1]);
    if (boundary) {
      const qualifier = /^[\p{L}_\\][\p{L}\p{N}_.\\]*(?::[\p{L}_\\][\p{L}\p{N}_.\\]*)?!/u.exec(rest);
      if (qualifier) { result += qualifier[0]; index += qualifier[0].length; continue; }
      const range = /^(\$?[A-Z]{1,3}):(\$?[A-Z]{1,3})(?![\p{L}\p{N}_.(])/iu.exec(rest) ?? /^(\$?[1-9][0-9]{0,6}):(\$?[1-9][0-9]{0,6})(?![\p{L}\p{N}_.])/u.exec(rest);
      if (range) {
        const columns = /[A-Z]/i.test(range[1]), left = translate(range[1], columns), right = translate(range[2], columns);
        if (left !== null && right !== null) { result += `${left}:${right}`; index += range[0].length; continue; }
      }
      const cell = /^(\$?[A-Z]{1,3})(\$?[1-9][0-9]{0,6})(?![\p{L}\p{N}_.(!])/iu.exec(rest);
      if (cell) {
        const column = translate(cell[1], true), row = translate(cell[2], false);
        if (column !== null && row !== null) { result += column === '#REF!' || row === '#REF!' ? '#REF!' : column + row; index += cell[0].length; continue; }
      }
    }
    result += char; index++;
  }
  return result;
}
