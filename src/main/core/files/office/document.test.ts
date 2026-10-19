import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { OfficePackage } from './package';
import { OfficeDocument } from './document';
import { OfficeWorkbook } from './workbook';

const fixture = async () => OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
const edit = (text: string) => ({ sheetId:'1', row:1, column:1, text });
describe('Office history and authoritative materialized receipts', () => {
  it('keeps saves and undo positions separate, ignores same input and discards redo only after a new edit', async () => {
    const document = new OfficeDocument(await fixture());
    expect(document.edit(0,edit('3'))).toMatchObject({version:0,dirty:false,canUndo:false});
    expect(document.edit(0,edit('10'))).toMatchObject({version:1,dirty:true,canUndo:true});
    const snapshot = await document.materialize(1);
    expect(new OfficeWorkbook(await OfficePackage.read(snapshot.bytes)).cell('1',1,1).value).toBe('10');
    expect(document.acknowledge(1,snapshot.hash)).toMatchObject({dirty:false});
    expect(document.undo(1,'undo')).toMatchObject({version:2,dirty:true,canRedo:true});
    expect(document.workbook.cell('1',1,1).value).toBe('3');
    expect(document.undo(2,'redo')).toMatchObject({version:3,dirty:false});
    document.undo(3,'undo');
    expect(document.edit(4,edit('11'))).toMatchObject({version:5,dirty:true,canRedo:false});
    expect(()=>document.edit(4,edit('12'))).toThrow('版本已改变');
    expect(()=>document.acknowledge(1,snapshot.hash)).toThrow('快照不一致');
    expect(document.state().dirty).toBe(true);
  });
  it('invalidates a prepared calculation on edit, never clears dirty on a forged or obsolete save receipt', async () => {
    const document = new OfficeDocument(await fixture()), calculation = await document.prepareCalculation();
    document.edit(0,edit('10'));
    await expect(document.applyCalculation(calculation!.bytes,calculation!.hash)).rejects.toThrow('过期');
    const snapshot = await document.materialize(1);
    expect(()=>document.acknowledge(1,'0'.repeat(64))).toThrow('快照不一致');
    expect(document.state().dirty).toBe(true);
    document.edit(1,edit('20'));
    expect(()=>document.acknowledge(1,snapshot.hash)).toThrow('快照不一致');
    expect(document.workbook.cell('1',1,1).value).toBe('20');
  });
  it('validates only changed formulas across undo, save baselines and restored legacy drafts', async()=>{
    const original=await fixture(), document=new OfficeDocument(original);
    expect(document.validationFormulas(0)).toEqual([]);
    document.edit(0,edit('12'));
    expect(document.validationFormulas(1)).toEqual([]);
    document.edit(1,edit('=SUM(B3,2)'));
    expect(document.validationFormulas(2)).toEqual([{sheetIndex:0,row:1,formula:'SUM(B3,2)'}]);
    const saved=await document.materialize(2); document.acknowledge(2,saved.hash);
    expect(document.validationFormulas(2)).toEqual([]);
    document.edit(2,edit('=SUM('));
    const draft=await document.materialize(3);
    const reopened=new OfficeDocument(original);
    reopened.restore(0,await OfficePackage.read(draft.bytes));
    expect(reopened.validationFormulas(1)).toEqual([{sheetIndex:0,row:1,formula:'SUM('}]);
    reopened.undo(1,'undo'); expect(reopened.validationFormulas(2)).toEqual([]);
    expect(()=>reopened.validationFormulas(1)).toThrow('版本已改变');
  });
  it('bounds retained history while retaining the current document and does not mutate on rejected input', async () => {
    const original = await fixture(), document = new OfficeDocument(original), hashes = original.hashes();
    for (let i=0;i<205;i++) document.edit(i,edit(String(100+i)));
    let version=205, undone=0;
    while(document.state().canUndo) { document.undo(version++,'undo'); undone++; }
    expect(undone).toBe(199);
    expect(()=>document.edit(version,{sheetId:'2',row:2,column:3,text:'999'})).toThrow('数组公式');
    expect(document.state().version).toBe(version); expect(original.hashes()).toEqual(hashes);
  },15000); // 404 model revisions; functional history bound, not a timing benchmark.
});
