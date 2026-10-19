import { describe,expect,it } from 'vitest';
import { rewriteOfficeSheetReferences as rewrite } from './sheet-references';

const base={oldName:'Data',newName:"新表 O'Brien😀",sheets:['Data','Calc','Spare']};
describe('worksheet reference token edits',()=>{
  it('rewrites direct/range/local references while preserving strings, spacing, structured selectors and external books',()=>{
    const input='SUM(Data!$B$2:B3,\'Data\'!Local)+IFERROR(INDIRECT("Data!B2"),42)+SUM(Sales[Value])+[Book.xlsx]Data!A1+\'[Book two.xlsx]Data\'!B2 + "Data!B2"';
    expect(rewrite(input,base)).toBe('SUM(\'新表 O\'\'Brien😀\'!$B$2:B3,\'新表 O\'\'Brien😀\'!Local)+IFERROR(INDIRECT("Data!B2"),42)+SUM(Sales[Value])+[Book.xlsx]Data!A1+\'[Book two.xlsx]Data\'!B2 + "Data!B2"');
    expect(rewrite('Table[Data!A1]+NotData!A1+data!A1',base)).toBe("Table[Data!A1]+NotData!A1+'新表 O''Brien😀'!A1");
  });
  it('preserves quoted punctuation and escaped quotes in sheet names',()=>{
    const change={oldName:"A ! O'Brien",newName:'Next',sheets:["A ! O'Brien",'Spare']};
    expect(rewrite("'A ! O''Brien'!A1",change)).toBe("'Next'!A1");
    expect(rewrite('"a""Data!A1" + Data!A1',base)).toBe('"a""Data!A1" + \'新表 O\'\'Brien😀\'!A1');
  });
  it('updates 3D endpoints and preserves interior renames and direction',()=>{
    expect(rewrite('SUM(Data:Spare!A1)',base)).toBe("SUM('新表 O''Brien😀:Spare'!A1)");
    expect(rewrite("SUM('Data:Spare'!A1)",base)).toBe("SUM('新表 O''Brien😀:Spare'!A1)");
    expect(rewrite("SUM('Data':'Spare'!A1)",base)).toBe("SUM('新表 O''Brien😀:Spare'!A1)");
    expect(rewrite('SUM(Data:Spare!A1)',{...base,oldName:'Calc'})).toBe('SUM(Data:Spare!A1)');
    expect(rewrite('SUM(Spare:Data!A1)',{...base,newName:null})).toBe("SUM('Spare:Calc'!A1)");
  });
  it('turns deleted direct/table dependencies into errors and shrinks a 3D endpoint without editing literal INDIRECT strings',()=>{
    const change={...base,newName:null,removedTables:['Sales']};
    expect(rewrite('Data!A1+SUM(Sales[Value])+IFERROR(INDIRECT("Data!A1"),100)',change)).toBe('#REF!+SUM(#REF!)+IFERROR(INDIRECT("Data!A1"),100)');
    expect(rewrite('SUM(Data:Spare!A1)',change)).toBe("SUM('Calc:Spare'!A1)");
    expect(rewrite('SUM(Data:Data!A1)',change)).toBe('SUM(#REF!)');
    expect(rewrite('Data!A1:Data!B2',change)).toBe('#REF!');
    expect(rewrite('SUM(Sales)+SUM(Sales[Value])+@Sales[Value]+Sales(1)',change)).toBe('SUM(#REF!)+SUM(#REF!)+#REF!+Sales(1)');
    expect(rewrite('@Data!A1',base)).toBe("@'新表 O''Brien😀'!A1");
  });
  it('handles both qualified range endpoints and rejects malformed or ambiguous syntax',()=>{
    expect(rewrite('Data!A1:Data!B2',base)).toBe("'新表 O''Brien😀'!A1:'新表 O''Brien😀'!B2");
    expect(()=>rewrite("'Data!A1",base)).toThrow('引号');
    expect(()=>rewrite('Sales[[Value]',base)).toThrow('适配');
    expect(()=>rewrite('Data!A1!B2',base)).toThrow('适配');
  });
});
