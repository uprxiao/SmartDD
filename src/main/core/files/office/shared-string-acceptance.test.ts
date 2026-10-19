import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { NativeFileBroker } from '../native-broker';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeXml, attribute, children } from './xml';
import { worksheetCellNodes } from './worksheet-edits';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const native = process.env.SMARTDD_M9_FILE_BROKER;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let directory = '', worker = '';
const rows: unknown[] = [];
beforeAll(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-shared-string-'))); worker = join(directory, 'office.cjs');
  if (process.env.SMARTDD_OFFICE_ACCEPTANCE_APP) { worker = join(process.env.SMARTDD_OFFICE_ACCEPTANCE_APP, 'Contents/Resources/app.asar/out/main/m9-office-document.js'); return; }
  const require = createRequire(import.meta.url), esbuild = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
  esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
});
afterAll(() => {
  if (process.env.SMARTDD_SHARED_STRING_EVIDENCE) writeFileSync(process.env.SMARTDD_SHARED_STRING_EVIDENCE, JSON.stringify({completedAt:new Date().toISOString(),rows},null,2)+'\n');
  rmSync(directory,{recursive:true,force:true});
});
describe.skipIf(!native || process.platform !== 'darwin')('DEV053 shared strings through actual Worker, checkpoint and native save', () => {
  it.each([1,3])('preserves all other cells with %i references and reopens the saved copy independently', async references => {
    const project = join(directory, `project-${references}`), userdata = join(directory, `userdata-${references}`); mkdirSync(project); mkdirSync(userdata);
    const original = await OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
    const rel='xl/_rels/workbook.xml.rels',types='[Content_Types].xml',shared='xl/sharedStrings.xml',sheet1='xl/worksheets/sheet1.xml',sheet2='xl/worksheets/sheet2.xml';
    const item='<si><r><rPr><b/></rPr><t>Alpha</t></r><r><rPr><i/></rPr><t>Beta</t></r></si>';
    const changes=new Map<string,Buffer>([
      [rel,Buffer.from(original.read(rel).toString().replace('</Relationships>','<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'))],
      [types,Buffer.from(original.read(types).toString().replace('</Types>','<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'))],
      [shared,Buffer.from(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${references}" uniqueCount="1">${item}</sst>`)],
      [sheet1,Buffer.from('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>')],
      [sheet2,Buffer.from(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${references===3?'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c></row>':''}</sheetData></worksheet>`)],
    ]);
    const source=original.patch(changes,{changed:[...changes.keys()].filter(name=>original.has(name)),added:[shared],removed:[]}),bytes=await source.bytes(),path=join(project,'shared.xlsx');writeFileSync(path,bytes);
    const broker=new NativeFileBroker(native!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',path:project,label:'Synthetic shared strings',projectId:'shared'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver),undefined,undefined,undefined,undefined,worker);
    const owner='shared';
    try {
      const root=(await service.openScope(owner,{kind:'project',projectId:'shared'})).roots[0],file=await service.open(owner,{lease:root.lease,generation:root.generation,relativePath:'shared.xlsx'}),id=randomUUID();
      await service.office.open(owner,{id,ref:file.ref,baseHash:hash(bytes)});
      const edit=await service.office.edit(owner,{id,version:0,edit:{sheetId:'1',row:0,column:0,text:'Al中文🙂ta'}});expect(edit.state.version).toBe(1);expect(hash(readFileSync(path))).toBe(hash(bytes));
      const saved=await service.office.save(owner,{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state,saved.receipt.message).toBe('saved');expect(saved.receipt.revision?.hash).toBe(hash(readFileSync(path)));
      const reopened=await OfficePackage.read(readFileSync(path)),model=new OfficeWorkbook(reopened),strings=new OfficeXml(reopened.read(shared)),items=children(strings.root,'si');
      expect(model.cell('1',0,0)).toMatchObject({value:'Al中文🙂ta',runs:[{text:'Al中文🙂',font:{bold:true}},{text:'ta',font:{italic:true}}]});
      expect(items).toHaveLength(references===1?1:2);expect(attribute(strings.root,'count')).toBe(String(references));
      const cell=worksheetCellNodes(new OfficeXml(reopened.read(sheet1))).get('A1')!;expect(attribute(cell,'t')).toBe('s');expect(children(cell,'v')[0].text).toBe(references===1?'0':'1');
      if(references===3){expect(strings.slice(items[0])).toBe(item);expect(model.cell('2',0,0).value).toBe('AlphaBeta');expect(model.cell('2',0,1).value).toBe('AlphaBeta');}
      expect(reopened.read(sheet2)).toEqual(source.read(sheet2));
      const changed=source.names().filter(name=>hash(source.read(name))!==hash(reopened.read(name)));expect(changed.sort()).toEqual(references===1?['xl/sharedStrings.xml','xl/workbook.xml']:['xl/sharedStrings.xml','xl/workbook.xml','xl/worksheets/sheet1.xml']);
      service.office.close(owner,id);service.closeDocument(owner,file.ref);
      const next=await service.open(owner,{lease:root.lease,generation:root.generation,relativePath:'shared.xlsx'}),fresh=randomUUID();await service.office.open(owner,{id:fresh,ref:next.ref,baseHash:next.revision.hash});
      expect((await service.office.cell(owner,{id:fresh,sheetId:'1',row:0,column:0,start:0,length:100})).text).toBe('Al中文🙂ta');
      rows.push({references,changed,sourceHash:hash(bytes),savedHash:hash(readFileSync(path)),receipt:saved.receipt.state,sharedItems:items.length,targetIndex:children(cell,'v')[0].text,otherSheetUnchanged:true,reopened:true});
    } finally {service.closeOwner(owner);await service.watcher.dispose();broker.dispose();}
  });
});
