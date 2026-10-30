import { describe, expect, it } from 'vitest';
import { translateOfficeFormula } from './formula';

describe('shared A1 formula translation', () => {
  it('moves relative components while preserving strings, sheet qualifiers, names and structured selectors', () => {
    expect(translateOfficeFormula('SUM(Data!B2,$B2,B$2,$B$2,A:C,1:3)+LOG10(A1)+Sales[Value]+IF("A1"="A1",0,1)', 2, 1)).toBe('SUM(Data!C4,$B4,C$2,$B$2,B:D,3:5)+LOG10(B3)+Sales[Value]+IF("A1"="A1",0,1)');
    expect(translateOfficeFormula("'中文 😀''名'!B2+'S1:S2'!A1+S1:S2!A1+[Book.xlsx]S1!A1+Table1[[#This Row],[Column1]]", 1, 0)).toBe("'中文 😀''名'!B3+'S1:S2'!A2+S1:S2!A2+[Book.xlsx]S1!A2+Table1[[#This Row],[Column1]]");
  });
  it('does not turn function names, decimals or longer names into cell references, and rejects malformed quoting', () => {
    expect(translateOfficeFormula('LOG10(A1)+NamedA1+1.23E10+_xlfn.XLOOKUP(A1,B1:B4,C1:C4)', 1, 1)).toBe('LOG10(B2)+NamedA1+1.23E10+_xlfn.XLOOKUP(B2,C2:C5,D2:D5)');
    expect(translateOfficeFormula('A1+$A$1+XFD1048576', -1, -1)).toBe('#REF!+$A$1+XFC1048575');
    expect(() => translateOfficeFormula('"unterminated', 1, 1)).toThrow('未闭合');
    expect(() => translateOfficeFormula('Table1[[Column]', 1, 1)).toThrow('未闭合');
  });
});
