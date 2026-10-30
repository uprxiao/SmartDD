import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:net';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NativeFileBroker } from '../native-broker';
import { FileEngineWorkspaces } from '../engine-workspaces';
import { OfficeCalculationEngine, type OfficeNativeResult } from './engine';
import { officeEngineResources, type OfficeEngineResources } from './engine-resources';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { prepareOfficeCalculation, transplantOfficeCalculation } from './calculation';
import { OfficeXml, descendants, attribute } from './xml';
import { patchWorksheetCells } from './worksheet-edits';
import { FileOfficeService } from './service';
import { FileHeavyJobs } from '../heavy-jobs';
import { editOfficeCell } from './cell-edit';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { decodeOfficeDraft, encodeOfficeDraft } from './draft';
import { OfficeDocument } from './document';
import { editOfficeSheet } from './sheet-edit';
import { editOfficeFormats } from './format-edit';
import type {OfficeMeasureInput} from '@shared/office-measure';
import {officeColumnPixels} from '@shared/office-measure';
import {OfficeValidations} from './validation';
import {OfficeConditionals} from './conditional';

const enabled = process.platform === 'darwin' && process.env.SMARTDD_M9_OFFICE_NATIVE === '1';
const runtime = resolve('out/native/office'), fixtures = resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
describe.skipIf(!enabled)('fixed POI/JRE through the real native boundary', () => {
  let build: string, fixture: string, userData: string, broker: NativeFileBroker, engine: OfficeCalculationEngine, workspaces: FileEngineWorkspaces, resources: OfficeEngineResources, worker: string;
  let canaryServer: Server | undefined;
  beforeAll(async () => {
    expect(existsSync(join(runtime, 'resources.json'))).toBe(true);
    build = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-office-native-build-')));
    const executable = join(build, 'willyou-files-test');
    execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-O1', '-Wno-deprecated-declarations', '-DWILLYOU_FILE_BROKER_TEST=1', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ImageIO', '-framework', 'CoreGraphics', '-framework', 'CoreText', resolve('native/files/broker.mm'), '-o', executable]);
    broker = new NativeFileBroker(executable); resources = await officeEngineResources(runtime);
    const require = createRequire(import.meta.url), esbuild = createRequire(require.resolve('electron-vite/package.json'))('esbuild'); worker = join(build, 'office.cjs');
    esbuild.buildSync({ entryPoints: [resolve('src/main/core/files/office/worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } });
  }, 30_000);
  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-office-native-'))); userData = join(fixture, 'user-data'); mkdirSync(userData);
    engine = new OfficeCalculationEngine(broker, { userData, directory: runtime }); workspaces = new FileEngineWorkspaces(userData, broker, 'office');
  });
  afterEach(async () => { engine.dispose(); broker.dispose(); if (canaryServer) { await new Promise<void>((resolve) => canaryServer!.close(() => resolve())); canaryServer = undefined; } rmSync(fixture, { recursive: true, force: true }); });
  afterAll(() => rmSync(build, { recursive: true, force: true }));
  const nativeInput = async (extra = {}) => {
    const bytes = readFileSync(join(fixtures, 'oa12-deleted.xlsx')), job = await workspaces.create();
    return { operation: 'office-calculate', job, ...resources, base64: bytes.toString('base64'), hash: hash(bytes), ...extra };
  };
  it('recalculates the two real fixtures in Seatbelt, transplants only caches and removes private copies', async () => {
    for (const [name, count] of [['oa12-deleted.xlsx', 3], ['rich-delete-final.xlsx', 15]] as const) {
      const source = readFileSync(join(fixtures, name)), original = await OfficePackage.read(source);
      const result = await engine.calculate(source, new AbortController().signal);
      expect(result.formulas).toBe(count); expect(result.peakRssBytes).toBeGreaterThan(0); expect(result.peakRssBytes).toBeLessThan(768 * 1024 * 1024);
      const candidate = transplantOfficeCalculation(original, await OfficePackage.read(result.bytes)).packageData;
      const workbook = new OfficeWorkbook(candidate), sheet = workbook.info.sheets.find((value) => value.name === 'Calc')!;
      expect(workbook.cell(sheet.id, 1, 1).value).toBe('#REF!'); expect(Number(workbook.cell(sheet.id, 3, 1).value)).toBe(100);
      expect(hash(readFileSync(join(fixtures, name)))).toBe(hash(source));
      expect(readdirSync(join(userData, 'm9-office-jobs'))).toEqual([]);
    }
  }, 30_000);
  it('rejects a malformed workbook without retaining temporary output, then permits a valid retry', async () => {
    await expect(engine.calculate(Buffer.from('not an office package'), new AbortController().signal)).rejects.toThrow('INVALID_INPUT');
    expect(readdirSync(join(userData, 'm9-office-jobs'))).toEqual([]);
    expect((await engine.calculate(readFileSync(join(fixtures, 'oa12-deleted.xlsx')), new AbortController().signal)).formulas).toBe(3);
  }, 15_000);
  it('measures real local glyphs, rich text and wrapping and rejects unavailable fonts without substituting them',async()=>{
    const font={family:'Arial',points:11,bold:false,italic:false},item=(text:string,points=11,wrap=false):OfficeMeasureInput['items'][number]=>({runs:[{text,font:{...font,points}}],widths:[8],wrap,indent:0,rotation:0});
    const rich=item('');rich.runs=[{text:'中文 😀 ',font},{text:'large',font:{...font,points:22,bold:true}}];
    const input={normalFont:font,items:[item('WWW'),item('iii'),item('WWW',22),item('words wrap into several lines words wrap into several lines',11,true),item('first\nsecond'),rich]};
    const result=await engine.measure(input,new AbortController().signal);
    expect(result.digitWidth).toBeGreaterThan(3);expect(result.items[0].width).toBeGreaterThan(result.items[1].width*1.5);expect(result.items[2].width-15).toBeCloseTo((result.items[0].width-15)*2,-1);
    expect(result.items[3].height).toBeGreaterThan(result.items[0].height*3);expect(result.items[4].height).toBeGreaterThan(result.items[0].height*1.5);expect(result.items[5].height).toBeGreaterThan(result.items[0].height);expect(result.fonts.length).toBeGreaterThan(1);
    await expect(engine.measure({normalFont:{...font,family:'WillYou Missing Font 9375'},items:[]},new AbortController().signal)).rejects.toThrow('缺少字体');
    const aborted=new AbortController();aborted.abort();await expect(engine.measure(input,aborted.signal)).rejects.toThrow('取消');
    expect((await engine.measure({normalFont:font,items:[item('retry')]},new AbortController().signal)).items).toHaveLength(1);expect(broker.activeProcesses).toBe(0);
  },15000);
  it('fits full columns and wrapped rows via actual font metrics, saves precisely and reopens with the same geometry',async()=>{
    const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',part='xl/worksheets/sheet1.xml',project=join(fixture,'fit-project');mkdirSync(project);
    const original=await OfficePackage.read(readFileSync(join(fixtures,'rich-source.xlsx')));
    const sheet=`<worksheet xmlns="${ns}"><cols><col min="1" max="4" width="12" outlineLevel="2"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>words wrap into several lines words wrap into several lines</t></is></c><c r="B1" t="inlineStr"><is><t>iii</t></is></c><c r="C1" t="inlineStr"><is><t>missing font</t></is></c></row><row r="1001"><c r="B1001" t="inlineStr"><is><t>WWWWWWWWWWWWWWWWWWWW</t></is></c></row></sheetData></worksheet>`;
    let source=original.patch(new Map([[part,Buffer.from(sheet)],['xl/styles.xml',Buffer.from(original.read('xl/styles.xml').toString().replaceAll('Calibri','Arial'))]]),{changed:[part,'xl/styles.xml'],added:[],removed:[]});
    const range=(r:number,c:number)=>({firstRow:r,lastRow:r,firstColumn:c,lastColumn:c});
    source=editOfficeFormats(source,'1',range(0,0),{alignment:{wrap:true}});source=editOfficeFormats(source,'1',range(0,2),{font:{family:'WillYou Missing Font 9375'}});
    const bytes=await source.bytes(),path=join(project,'fit.xlsx');writeFileSync(path,bytes);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'fit-dir',path:project,label:'Fit',projectId:'fit-test'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'fit-test'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'fit.xlsx'}),id=randomUUID();
    try {
      const opened=await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});expect(opened.workbook.fontMetric?.measured,opened.workbook.fontMetric?.message).toBe(true);
      const mdw=opened.workbook.fontMetric!.digitWidth;
      await expect(service.office.rangeAction('owner',{id,version:0,action:{type:'fit',axis:'column',sheetId:'1',range:range(0,2)}})).rejects.toThrow('缺少字体');
      const columns=await service.office.rangeAction('owner',{id,version:0,action:{type:'fit',axis:'column',sheetId:'1',range:range(0,1)}});
      expect(columns.state.version).toBe(1);expect(columns.state.workbook.sheets[0].columnSizes.find(c=>c.first===1)?.pixels).toBeGreaterThan(250);
      const rows=await service.office.rangeAction('owner',{id,version:1,action:{type:'fit',axis:'row',sheetId:'1',range:range(1000,1)}});
      expect(rows.state.workbook.sheets[0].rowSizes.find(row=>row.index===1000)?.pixels).toBeGreaterThan(20);
      // Row 1 includes a missing C1 font. The failure must preserve both earlier edits.
      await expect(service.office.rangeAction('owner',{id,version:2,action:{type:'fit',axis:'row',sheetId:'1',range:range(0,0)}})).rejects.toThrow('缺少字体');
      const fixed=await service.office.rangeAction('owner',{id,version:2,action:{type:'format',sheetId:'1',range:range(0,2),format:{font:{family:'Arial'}}}});
      const fitted=await service.office.rangeAction('owner',{id,version:fixed.state.version,action:{type:'fit',axis:'row',sheetId:'1',range:range(0,0)}});expect(fitted.state.version).toBe(4);expect(fitted.state.workbook.sheets[0].rowSizes.find(row=>row.index===0)?.pixels).toBeGreaterThan(80);
      const undone=await service.office.history('owner',{id,version:4,direction:'undo'});expect(undone.state.workbook.sheets[0].rowSizes.find(row=>row.index===0)).toBeUndefined();const redone=await service.office.history('owner',{id,version:5,direction:'redo'});
      const saved=await service.office.save('owner',{id,version:6,draftId:randomUUID(),bufferVersion:6,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const disk=await OfficePackage.read(readFileSync(path)),model=new OfficeWorkbook(disk,{digitWidth:mdw,measured:true});
      expect(model.info.sheets[0]).toEqual(redone.state.workbook.sheets[0]);expect(model.cell('1',1000,1).value).toBe('WWWWWWWWWWWWWWWWWWWW');
      for(const name of source.names())if(![part,'xl/styles.xml','xl/worksheets/sheet2.xml'].includes(name))expect(disk.read(name),name).toEqual(source.read(name));
      const independent=await engine.calculate(await disk.bytes(),new AbortController().signal),readback=await OfficePackage.read(independent.bytes),a=new OfficeXml(disk.read(part)),b=new OfficeXml(readback.read(part));
      expect(descendants(b.root,'col').map(c=>[attribute(c,'min'),attribute(c,'max'),Number(attribute(c,'width'))])).toEqual(descendants(a.root,'col').map(c=>[attribute(c,'min'),attribute(c,'max'),Number(attribute(c,'width'))]));
      expect(descendants(b.root,'row').map(r=>Number(attribute(r,'ht') ?? 0))).toEqual(descendants(a.root,'row').map(r=>Number(attribute(r,'ht') ?? 0)));
      service.office.close('owner',id);const fresh=await service.office.open('owner',{id:randomUUID(),ref:file.ref,baseHash:saved.receipt.revision!.hash});expect(fresh.state.dirty).toBe(false);expect(fresh.workbook.sheets[0]).toEqual(model.info.sheets[0]);expect(fresh.workbook.sheets[0].columnSizes.find(c=>c.first===0)?.pixels).toBe(officeColumnPixels(12,mdw));
    } finally {service.closeOwner('owner');service.office.dispose();}
  },30000);
  it('persists validation through real save, independent engine readback and reopen, then removes only the selected rule segment',async()=>{
    const project=join(fixture,'validation-project');mkdirSync(project);const path=join(project,'validation.xlsx'),source=readFileSync(join(fixtures,'rich-source.xlsx'));writeFileSync(path,source);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'validation-dir',path:project,label:'Validation',projectId:'validation-test'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'validation-test'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'validation.xlsx'});let id=randomUUID();
    const target={firstRow:1,lastRow:2,firstColumn:1,lastColumn:1},part='xl/worksheets/sheet1.xml';
    try {
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const validated=await service.office.rangeAction('owner',{id,version:0,action:{type:'validation',value:'number',sheetId:'1',range:target}});expect(validated.state.version).toBe(1);
      await expect(service.office.edit('owner',{id,version:1,edit:{sheetId:'1',row:1,column:1,text:'bad text'}})).rejects.toThrow('仅接受');expect(hash(readFileSync(path))).toBe(hash(source));
      await service.office.edit('owner',{id,version:1,edit:{sheetId:'1',row:1,column:1,text:'5'}});
      await service.office.edit('owner',{id,version:2,edit:{sheetId:'1',row:2,column:1,text:'="formula text"'}});
      const refreshed=await service.office.recalculate('owner',{id,version:3});expect(refreshed.calculation,refreshed.calculation?.message).toMatchObject({state:'ready'});
      const saved=await service.office.save('owner',{id,version:3,draftId:randomUUID(),bufferVersion:3,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const disk=await OfficePackage.read(readFileSync(path)),model=new OfficeWorkbook(disk),rules=new OfficeValidations(new OfficeXml(disk.read(part)));expect(rules.rules).toHaveLength(1);expect(rules.rules[0].number).toBe(true);expect(rules.rules[0].ranges).toEqual([target]);expect(model.cell('1',2,1)).toMatchObject({value:'formula text',validation:'number',formula:{text:'"formula text"'}});
      const original=await OfficePackage.read(source);for(const name of original.names())if(![part,'xl/worksheets/sheet2.xml','xl/workbook.xml'].includes(name))expect(disk.read(name),name).toEqual(original.read(name));
      const beforeBook=new OfficeXml(original.read('xl/workbook.xml')),afterBook=new OfficeXml(disk.read('xl/workbook.xml')),beforeCalc=descendants(beforeBook.root,'calcPr')[0],afterCalc=descendants(afterBook.root,'calcPr')[0];
      expect(attribute(afterCalc,'fullCalcOnLoad')).toBe('1');expect(attribute(afterCalc,'forceFullCalc')).toBe('1');expect(afterBook.edit([{start:afterCalc.start,end:afterCalc.end,value:beforeBook.slice(beforeCalc)}])).toEqual(original.read('xl/workbook.xml'));
      const calculated=await engine.calculate(await disk.bytes(),new AbortController().signal),independent=await OfficePackage.read(calculated.bytes),readback=new OfficeValidations(new OfficeXml(independent.read(part)));expect(readback.rules).toHaveLength(1);expect(readback.rules[0].number).toBe(true);expect(readback.rules[0].ranges).toEqual([target]);
      service.office.close('owner',id);id=randomUUID();const opened=await service.office.open('owner',{id,ref:file.ref,baseHash:saved.receipt.revision!.hash});expect(opened.state).toMatchObject({dirty:false,version:0});
      await expect(service.office.edit('owner',{id,version:0,edit:{sheetId:'1',row:1,column:1,text:'still invalid'}})).rejects.toThrow('仅接受');
      await service.office.rangeAction('owner',{id,version:0,action:{type:'validation',value:'none',sheetId:'1',range:{...target,lastRow:1}}});
      await service.office.edit('owner',{id,version:1,edit:{sheetId:'1',row:1,column:1,text:'now allowed'}});
      await expect(service.office.edit('owner',{id,version:2,edit:{sheetId:'1',row:2,column:1,text:'still invalid'}})).rejects.toThrow('仅接受');
      expect((await service.office.recalculate('owner',{id,version:2})).calculation?.state).toBe('ready');
      const final=await service.office.save('owner',{id,version:2,draftId:randomUUID(),bufferVersion:2,opId:randomUUID()});expect(final.receipt.state).toBe('saved');service.office.close('owner',id);id=randomUUID();await service.office.open('owner',{id,ref:file.ref,baseHash:final.receipt.revision!.hash});
      const reopened=new OfficeWorkbook(await OfficePackage.read(readFileSync(path)));expect(reopened.cell('1',1,1)).toMatchObject({value:'now allowed'});expect(reopened.cell('1',1,1).validation).toBeUndefined();expect(reopened.cell('1',2,1).validation).toBe('number');
      await expect(service.office.edit('owner',{id,version:0,edit:{sheetId:'1',row:2,column:1,text:'still invalid'}})).rejects.toThrow('仅接受');
    } finally {service.closeOwner('owner');service.office.dispose();}
  },30000);
  it('saves dynamic conditional rules, reads them independently and preserves partial cancellation on reopening',async()=>{
    const project=join(fixture,'conditional-project');mkdirSync(project);const path=join(project,'conditional.xlsx'),source=readFileSync(join(fixtures,'rich-source.xlsx'));writeFileSync(path,source);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'conditional-dir',path:project,label:'Conditional',projectId:'conditional-test'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'conditional-test'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'conditional.xlsx'});let id=randomUUID();
    const target={firstRow:1,lastRow:2,firstColumn:1,lastColumn:1},part='xl/worksheets/sheet1.xml';
    const view=()=>service.office.window('owner',{id,sheetId:'1',row:1,column:1,rows:2,columns:1});
    try {
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      await service.office.rangeAction('owner',{id,version:0,action:{type:'conditional',value:3,sheetId:'1',range:target}});
      expect((await view()).cells.map(c=>c.conditional?.fill)).toEqual([undefined,'#FFF0C8']);
      const saved=await service.office.save('owner',{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const disk=await OfficePackage.read(readFileSync(path)),model=new OfficeWorkbook(disk),original=await OfficePackage.read(source);for(const name of original.names())if(![part,'xl/styles.xml','xl/worksheets/sheet2.xml'].includes(name))expect(disk.read(name),name).toEqual(original.read(name));
      const calculated=await engine.calculate(await disk.bytes(),new AbortController().signal),independent=await OfficePackage.read(calculated.bytes),independentModel=new OfficeWorkbook(independent),readback=new OfficeConditionals(new OfficeXml(independent.read(part)),independentModel.styles);expect(readback.rules).toHaveLength(1);expect(readback.rules[0]).toMatchObject({threshold:3,editable:true,priority:1,stop:false});expect(readback.rules[0].ranges).toEqual([target]);expect(independentModel.cell('1',2,1).conditional).toEqual(model.cell('1',2,1).conditional);
      // Independently evaluate the actual stored condition on typed numeric and
      // numeric-looking text cells with the fixed POI engine.
      let probe=editOfficeCell(disk,{sheetId:'1',row:1,column:1,text:"'99"}).packageData;probe=editOfficeCell(probe,{sheetId:'1',row:0,column:5,text:'=AND(ISNUMBER(B2),B2>3)'}).packageData;probe=editOfficeCell(probe,{sheetId:'1',row:1,column:5,text:'=AND(ISNUMBER(B3),B3>3)'}).packageData;
      const prepared=prepareOfficeCalculation(probe),evaluated=await engine.calculate(await prepared.packageData.bytes(),new AbortController().signal),booleans=new OfficeWorkbook(await OfficePackage.read(evaluated.bytes));expect(booleans.cell('1',0,5)).toMatchObject({type:'boolean',value:'FALSE'});expect(booleans.cell('1',1,5)).toMatchObject({type:'boolean',value:'TRUE'});
      service.office.close('owner',id);id=randomUUID();const opened=await service.office.open('owner',{id,ref:file.ref,baseHash:saved.receipt.revision!.hash});expect(opened.state.dirty).toBe(false);expect((await view()).cells[1].conditional?.fill).toBe('#FFF0C8');
      await service.office.edit('owner',{id,version:0,edit:{sheetId:'1',row:1,column:1,text:'5'}});expect((await view()).cells[0].conditional?.fill).toBe('#FFF0C8');
      await service.office.rangeAction('owner',{id,version:1,action:{type:'conditional',value:null,sheetId:'1',range:{...target,lastRow:1}}});expect((await view()).cells.map(c=>c.conditional?.threshold)).toEqual([undefined,3]);
      expect((await service.office.recalculate('owner',{id,version:2})).calculation?.state).toBe('ready');const final=await service.office.save('owner',{id,version:2,draftId:randomUUID(),bufferVersion:2,opId:randomUUID()});expect(final.receipt.state).toBe('saved');
      service.office.close('owner',id);id=randomUUID();await service.office.open('owner',{id,ref:file.ref,baseHash:final.receipt.revision!.hash});expect((await view()).cells.map(c=>c.conditional?.threshold)).toEqual([undefined,3]);expect((await view()).cells[0].value).toBe('5');
    } finally {service.closeOwner('owner');service.office.dispose();}
  },30000);
  it('parses changed formulas without evaluating or rewriting the source, rejects malformed input and permits retry', async()=>{
    const source=readFileSync(join(fixtures,'rich-source.xlsx')), originalHash=hash(source), signal=new AbortController().signal;
    for (const formula of ['SUM(', '1+', '"unterminated']) {
      await expect(engine.validateFormulas(source,[{sheetIndex:0,row:1,formula}],signal)).rejects.toThrow('公式未通过');
      expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
    }
    await engine.validateFormulas(source,[
      {sheetIndex:0,row:1,formula:'SUM(B2:B3)'},
      {sheetIndex:1,row:1,formula:'IFERROR(#REF!,100)'},
      {sheetIndex:1,row:2,formula:'"中文😀"&"x"'},
      {sheetIndex:0,row:0,formula:'UnknownUserFunction(1)'},
    ],signal);
    expect(hash(readFileSync(join(fixtures,'rich-source.xlsx')))).toBe(originalHash);
    expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
  },30_000);
  it('normalizes real shared formulas and inserts a missing array follower while retaining original formula XML', async () => {
    const input = await OfficePackage.read(readFileSync(join(fixtures, 'rich-source.xlsx'))), part = 'xl/worksheets/sheet2.xml';
    const original = input.patch(new Map([[part, patchWorksheetCells(new OfficeXml(input.read(part)), new Map([['D3', null]]))]]), { changed: [part], added: [], removed: [] });
    const prepared = prepareOfficeCalculation(original), calculated = await engine.calculate(await prepared.packageData.bytes(), new AbortController().signal);
    const result = transplantOfficeCalculation(original, await OfficePackage.read(calculated.bytes), prepared.packageData), model = new OfficeWorkbook(result.packageData);
    const expected = { B2:7, B3:7, B4:100, B5:3, B6:42, B7:7, B8:7, B9:7, B10:5, B11:6, B12:8, B15:7, B16:3, D2:9, D3:12 };
    const values = new Map(model.window('2', 0, 0, 16, 4).cells.map((cell) => [cell.address, Number(cell.value)]));
    for (const [address, value] of Object.entries(expected)) expect(values.get(address), address).toBe(value);
    const before = new OfficeXml(original.read(part)), after = new OfficeXml(result.packageData.read(part));
    expect(descendants(after.root, 'f').map((node) => after.slice(node))).toEqual(descendants(before.root, 'f').map((node) => before.slice(node)));
    expect(descendants(after.root, 'c').find((node) => attribute(node, 'r') === 'D3')).toBeDefined();
    for (const name of original.names()) if (!result.changedParts.includes(name)) expect(result.packageData.read(name)).toEqual(original.read(name));
  }, 15_000);
  it('recalculates dependent/shared/array results after a precise input edit and preserves other parts through serialization', async () => {
    const original = await OfficePackage.read(readFileSync(join(fixtures, 'rich-source.xlsx')));
    const edit = editOfficeCell(original, { sheetId:'1', row:1, column:1, text:'10' }), prepared = prepareOfficeCalculation(edit.packageData);
    const output = await engine.calculate(await prepared.packageData.bytes(), new AbortController().signal);
    expect(output.formulas).toBe(15);
    const result = transplantOfficeCalculation(edit.packageData, await OfficePackage.read(output.bytes), prepared.packageData);
    const roundTrip = await OfficePackage.read(await result.packageData.bytes()), model = new OfficeWorkbook(roundTrip);
    expect(Number(model.cell('2',1,1).value)).toBe(14);
    expect(Number(model.cell('2',10,1).value)).toBe(20); expect(Number(model.cell('2',11,1).value)).toBe(8);
    expect(Number(model.cell('2',1,3).value)).toBe(30); expect(Number(model.cell('2',2,3).value)).toBe(12);
    for (const name of original.names()) if (![...edit.changedParts, ...result.changedParts].includes(name)) expect(roundTrip.read(name), name).toEqual(original.read(name));
    expect(readdirSync(join(userData, 'm9-office-jobs'))).toEqual([]);
  }, 15_000);
  it('runs real Worker and calculation through the same queue without deadlock or source writes', async () => {
    const bytes = readFileSync(join(fixtures, 'rich-source.xlsx')), originalHash = hash(bytes), jobs = new FileHeavyJobs();
    const calculation = new OfficeCalculationEngine(broker, { userData, directory: runtime }, jobs);
    const service = new FileOfficeService(() => ({ name: 'fixture.xlsx', hash: originalHash, size: bytes.length, signal: new AbortController().signal, assert() {}, read: async (offset, length) => bytes.subarray(offset, offset + length) }), worker, jobs, calculation);
    const id = randomUUID();
    try {
      const opened = await service.open('test', { id, ref: { id: randomUUID(), lease: randomUUID(), generation: 1 }, baseHash: originalHash });
      expect(opened.calculation, JSON.stringify(opened.calculation)).toEqual({ state: 'ready' });
      expect((await service.window('test', { id, sheetId: '2', row: 10, column: 1, rows: 2, columns: 1 })).cells.map((cell) => cell.value)).toEqual(['6.0', '8.0']);
      expect(hash(readFileSync(join(fixtures, 'rich-source.xlsx')))).toBe(originalHash);
    } finally { service.dispose(); }
  }, 20_000);
  it('saves the Worker candidate through real recovery and native commit, retaining pending input and rejecting an external conflict', async()=>{
    const project=join(fixture,'project'); mkdirSync(project);
    const original=readFileSync(join(fixtures,'rich-source.xlsx')); writeFileSync(join(project,'editable.xlsx'),original);
    const sources=[{kind:'project-directory' as const,id:'dir-1',path:project,label:'Office',projectId:'office-test'}],resolver={sources:()=>sources};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'office-test'})).roots[0];
    const file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'editable.xlsx'}),id=randomUUID(),draftId=randomUUID();
    try {
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const edit=await service.office.edit('owner',{id,version:0,edit:{sheetId:'1',row:1,column:1,text:'10'}}); expect(edit.state.dirty).toBe(true);
      const pending={sheetId:'1',row:2,column:1,text:'=SUM(中文'};
      await service.office.checkpoint('owner',{id,version:1,draftId,bufferVersion:1,pending});
      const recovered=await service.readDraft('owner',file.ref,draftId),draft=decodeOfficeDraft(Buffer.from(recovered.base64,'base64'));
      expect(recovered.encoding).toBe('ooxml-draft'); expect(draft.pending).toEqual(pending); expect(new OfficeWorkbook(await OfficePackage.read(draft.bytes)).cell('1',1,1).value).toBe('10');
      expect(readFileSync(join(project,'editable.xlsx'))).toEqual(original);
      await service.office.recalculate('owner',{id,version:1});
      const saved=await service.office.save('owner',{id,version:1,draftId,bufferVersion:2,opId:randomUUID()});
      expect(saved.receipt.state,saved.receipt.message).toBe('saved'); expect(saved.state.dirty).toBe(false); expect(service.drafts('owner',file.ref)).toEqual([]);
      const onDisk=new OfficeWorkbook(await OfficePackage.read(readFileSync(join(project,'editable.xlsx'))));
      expect(onDisk.cell('1',1,1).value).toBe('10'); expect(Number(onDisk.cell('2',1,1).value)).toBe(14);
      await service.office.edit('owner',{id,version:1,edit:{sheetId:'1',row:1,column:1,text:'20'}});
      writeFileSync(join(project,'editable.xlsx'),original); await service.refresh('owner',file.ref);
      expect((await service.office.cell('owner',{id,sheetId:'1',row:1,column:1,start:0,length:100})).text).toBe('20');
      const conflict=await service.office.save('owner',{id,version:2,draftId,bufferVersion:3,opId:randomUUID()});
      expect(conflict.receipt.state).toBe('conflict'); expect(conflict.state.dirty).toBe(true); expect(readFileSync(join(project,'editable.xlsx'))).toEqual(original);
      sources[0].path=userData; await expect(service.refresh('owner',file.ref)).rejects.toThrow('STALE_ROOT');
      expect((await service.office.cell('owner',{id,sheetId:'1',row:1,column:1,start:0,length:100})).text).toBe('20');
      await service.office.checkpoint('owner',{id,version:2,draftId,bufferVersion:4,pending});
      expect(decodeOfficeDraft(Buffer.from((await service.readDraft('owner',file.ref,draftId)).base64,'base64')).pending).toEqual(pending);
      await expect(service.office.save('owner',{id,version:2,draftId,bufferVersion:5,opId:randomUUID()})).rejects.toMatchObject({code:'UNTRUSTED'});
      expect(readFileSync(join(project,'editable.xlsx'))).toEqual(original);
      service.closeDocument('owner',file.ref); expect(service.office.activeDocuments).toBe(0);
    } finally {service.closeOwner('owner'); service.office.dispose();}
  },30_000);
  it('synchronizes legacy checkbox state through Worker, native save and reopen while preserving unrelated parts',async()=>{
    const project=join(fixture,'checkbox-project');mkdirSync(project);
    const original=readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/checkbox/checkbox.xlsx')),path=join(project,'checkbox.xlsx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'checkbox-dir',path:project,label:'Checkbox',projectId:'checkbox-test'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'checkbox-test'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'checkbox.xlsx'});let id=randomUUID();
    try {
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      await service.office.edit('owner',{id,version:0,edit:{sheetId:'1',row:1,column:1,text:'FALSE'}});
      const saved=await service.office.save('owner',{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state,saved.receipt.message).toBe('saved');
      const bytes=readFileSync(path),disk=await OfficePackage.read(bytes),before=await OfficePackage.read(original);
      expect(new OfficeWorkbook(disk).window('1',0,0,6,4).checkboxes?.[0]).toMatchObject({checked:false,linked:{row:1,column:1}});
      expect(new OfficeWorkbook(disk).window('1',0,0,6,4).checkboxes?.[0].reason).toBeUndefined();
      for(const part of before.names())if(!['xl/workbook.xml','xl/worksheets/sheet1.xml','xl/ctrlProps/ctrlProps2.xml','xl/drawings/vmlDrawing1.vml'].includes(part))expect(disk.read(part),part).toEqual(before.read(part));
      if(process.env.SMARTDD_M9_OFFICE_CHECKBOX_EVIDENCE)writeFileSync(process.env.SMARTDD_M9_OFFICE_CHECKBOX_EVIDENCE,bytes);
      await service.office.close('owner',id);
      id=randomUUID();
      const fresh=await service.refresh('owner',file.ref);await service.office.open('owner',{id,ref:fresh.ref,baseHash:fresh.revision.hash});
      expect((await service.office.cell('owner',{id,sheetId:'1',row:1,column:1,start:0,length:100})).text).toBe('FALSE');
      await service.office.edit('owner',{id,version:0,edit:{sheetId:'1',row:1,column:1,text:'TRUE'}});
      expect((await service.office.save('owner',{id,version:1,draftId:randomUUID(),bufferVersion:2,opId:randomUUID()})).receipt.state).toBe('saved');
      expect(new OfficeWorkbook(await OfficePackage.read(readFileSync(path))).window('1',0,0,6,4).checkboxes?.[0].checked).toBe(true);
      if(process.env.SMARTDD_M9_OFFICE_CHECKBOX_EVIDENCE)writeFileSync(process.env.SMARTDD_M9_OFFICE_CHECKBOX_EVIDENCE.replace(/\.xlsx$/,'.checked.xlsx'),readFileSync(path));
    }finally{service.closeOwner('owner');service.office.dispose();}
  },30000);
  it('inserts checkbox controls through Worker and native save, then reopens bindings and preserves chart resources',async()=>{
    const project=join(fixture,'checkbox-insert-project');mkdirSync(project);
    const original=readFileSync(join(fixtures,'rich-source.xlsx')),path=join(project,'insert.xlsx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'checkbox-insert-dir',path:project,label:'Checkbox insert',projectId:'checkbox-insert-test'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'checkbox-insert-test'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'insert.xlsx'});let id=randomUUID();
    try{
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      await service.office.rangeAction('owner',{id,version:0,action:{type:'checkbox',sheetId:'1',range:{firstRow:1,lastRow:2,firstColumn:1,lastColumn:2}}});
      expect((await service.office.save('owner',{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()})).receipt.state).toBe('saved');
      const bytes=readFileSync(path),disk=await OfficePackage.read(bytes),before=await OfficePackage.read(original),page=new OfficeWorkbook(disk).window('1',0,0,6,5);
      expect(page.controlsWarning).toBeUndefined();expect(page.checkboxes).toHaveLength(4);expect(page.checkboxes!.every(c=>!c.checked && !c.reason)).toBe(true);
      for(const part of before.names().filter(p=>p.includes('/charts/') || p.includes('/comments') || p.includes('/media/')))expect(disk.read(part),part).toEqual(before.read(part));
      if(process.env.SMARTDD_M9_OFFICE_CHECKBOX_INSERT_EVIDENCE)writeFileSync(process.env.SMARTDD_M9_OFFICE_CHECKBOX_INSERT_EVIDENCE,bytes);
      await service.office.close('owner',id);id=randomUUID();const fresh=await service.refresh('owner',file.ref);await service.office.open('owner',{id,ref:fresh.ref,baseHash:fresh.revision.hash});
      await service.office.edit('owner',{id,version:0,edit:{sheetId:'1',row:1,column:1,text:'TRUE'}});
      expect((await service.office.save('owner',{id,version:1,draftId:randomUUID(),bufferVersion:2,opId:randomUUID()})).receipt.state).toBe('saved');
      expect(new OfficeWorkbook(await OfficePackage.read(readFileSync(path))).window('1',0,0,6,5).checkboxes?.filter(c=>c.checked)).toHaveLength(1);
      if(process.env.SMARTDD_M9_OFFICE_CHECKBOX_INSERT_EVIDENCE)writeFileSync(process.env.SMARTDD_M9_OFFICE_CHECKBOX_INSERT_EVIDENCE.replace(/\.xlsx$/,'.checked.xlsx'),readFileSync(path));
    }finally{service.closeOwner('owner');service.office.dispose();}
  },30000);
  it.skipIf(!process.env.SMARTDD_M9_OFFICE_PACKAGE)('loads and runs the actual signed runtime from a packaged App', async () => {
    const packagePath = resolve(process.env.SMARTDD_M9_OFFICE_PACKAGE!), resourcesPath = join(packagePath, 'Contents/Resources');
    const packagedBroker = new NativeFileBroker(join(resourcesPath, 'native/willyou-files'));
    const calculation = new OfficeCalculationEngine(packagedBroker, { userData, directory: join(resourcesPath, 'native/office'), packagePath });
    try {
      const result = await calculation.calculate(readFileSync(join(fixtures, 'oa12-deleted.xlsx')), new AbortController().signal);
      expect(result.formulas).toBe(3); const model = new OfficeWorkbook(await OfficePackage.read(result.bytes));
      expect(model.cell('2', 1, 1).value).toBe('#REF!'); expect(Number(model.cell('2', 3, 1).value)).toBe(100);
      const bytes=readFileSync(join(fixtures,'rich-source.xlsx')), signal=new AbortController().signal;
      await calculation.validateFormulas(bytes,[{sheetIndex:0,row:1,formula:'SUM(B2:B3)'}],signal);
      await expect(calculation.validateFormulas(bytes,[{sheetIndex:0,row:1,formula:'SUM('}],signal)).rejects.toThrow('公式未通过');
    } finally { calculation.dispose(); packagedBroker.dispose(); }
  }, 20_000);
  it('retains rejected raw input and legacy invalid draft formulas, then commits a corrected formula through native save', async()=>{
    const project=join(fixture,'formula-project'); mkdirSync(project);
    const original=readFileSync(join(fixtures,'rich-source.xlsx')), path=join(project,'formula.xlsx'); writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'formula-dir',path:project,label:'Formula',projectId:'formula-test'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'formula-test'})).roots[0];
    const file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'formula.xlsx'}),id=randomUUID(),draftId=randomUUID();
    try {
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const pending={sheetId:'1',row:1,column:1,text:'=SUM('};
      await service.office.checkpoint('owner',{id,version:0,draftId,bufferVersion:1,pending});
      await expect(service.office.edit('owner',{id,version:0,edit:pending})).rejects.toThrow('公式未通过');
      expect((await service.office.cell('owner',{id,sheetId:'1',row:1,column:1,start:0,length:100})).text).toBe('3');
      expect(decodeOfficeDraft(Buffer.from((await service.readDraft('owner',file.ref,draftId)).base64,'base64')).pending).toEqual(pending);
      expect(readFileSync(path)).toEqual(original);
      // This simulates a durable draft from the earlier implementation, where
      // malformed syntax had already entered the model rather than pending UI.
      const legacy=new OfficeDocument(await OfficePackage.read(original)); legacy.edit(0,pending);
      const legacyBytes=encodeOfficeDraft((await legacy.materialize(1)).bytes);
      await service.checkpoint('owner',{ref:file.ref,draftId,bufferVersion:2,baseHash:file.revision.hash,base64:legacyBytes.toString('base64'),encoding:'ooxml-draft',bom:false});
      expect((await service.office.restore('owner',{id,version:0,draftId})).state.version).toBe(1);
      await expect(service.office.save('owner',{id,version:1,draftId,bufferVersion:3,opId:randomUUID()})).rejects.toThrow('公式未通过');
      expect(readFileSync(path)).toEqual(original);
      const retained=decodeOfficeDraft(Buffer.from((await service.readDraft('owner',file.ref,draftId)).base64,'base64'));
      expect(new OfficeWorkbook(await OfficePackage.read(retained.bytes)).cell('1',1,1).formula?.text).toBe('SUM(');
      await service.office.edit('owner',{id,version:1,edit:{...pending,text:'=SUM(B3,2)'}});
      const saved=await service.office.save('owner',{id,version:2,draftId,bufferVersion:4,opId:randomUUID()});
      expect(saved.receipt.state).toBe('saved'); expect(saved.state.dirty).toBe(false);
      expect(new OfficeWorkbook(await OfficePackage.read(readFileSync(path))).cell('1',1,1).formula?.text).toBe('SUM(B3,2)');
      expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
    } finally { service.closeOwner('owner');service.office.dispose(); }
  },30_000);
  it('reads precise range formatting through the independent POI reader, then saves and reopens via the real native service',async()=>{
    const project=join(fixture,'format-project');mkdirSync(project);
    const original=readFileSync(join(fixtures,'rich-source.xlsx')),path=join(project,'format.xlsx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'format-dir',path:project,label:'Format',projectId:'format-test'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'format-test'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'format.xlsx'}),id=randomUUID(),range={firstRow:1,lastRow:2,firstColumn:1,lastColumn:1};
    const format={font:{bold:true,italic:true,points:15,color:'#123456'},fill:'#fff0c8',border:true,alignment:{horizontal:'center' as const,wrap:true},numberFormat:'currency' as const,decimals:3};
    try {
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      await service.office.rangeAction('owner',{id,version:0,action:{type:'format',sheetId:'1',range,format}});
      const saved=await service.office.save('owner',{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const disk=await OfficePackage.read(readFileSync(path)),model=new OfficeWorkbook(disk);expect(model.window('1',1,1,2,1).cells.map(cell=>cell.display)).toEqual(['¥3.000','¥4.000']);
      // POI consumes and serializes every style definition; only inspect its
      // independent candidate here, never replace the original with that package.
      const independent=await engine.calculate(await disk.bytes(),new AbortController().signal),parsed=new OfficeWorkbook(await OfficePackage.read(independent.bytes));
      expect(parsed.styles.get(parsed.cell('1',1,1).style)).toMatchObject({font:{bold:true,italic:true,points:15,color:'#123456'},fill:'#FFF0C8',alignment:{horizontal:'center',wrap:true}});
      expect(parsed.window('1',1,1,2,1).cells.map(cell=>cell.display)).toEqual(['¥3.000','¥4.000']);expect(Number(parsed.cell('2',1,1).value)).toBe(7);
      const before=await OfficePackage.read(original);for(const part of before.names())if(!['xl/styles.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml'].includes(part))expect(disk.read(part),part).toEqual(before.read(part));
      service.office.close('owner',id);const fresh=await service.office.open('owner',{id:randomUUID(),ref:file.ref,baseHash:saved.receipt.revision!.hash});expect(fresh.state.dirty).toBe(false);expect(fresh.calculation?.state).toBe('ready');
      const reset=editOfficeFormats(disk,'1',range,null),resetRead=await engine.calculate(await reset.bytes(),new AbortController().signal),resetModel=new OfficeWorkbook(await OfficePackage.read(resetRead.bytes));expect(resetModel.cell('1',1,1).type).toBe('number');expect(Number(resetModel.cell('1',1,1).value)).toBe(3);expect(resetModel.styles.get(resetModel.cell('1',1,1).style).font?.bold).toBe(false);
    } finally {service.closeOwner('owner');service.office.dispose();}
  },30_000);
  it('fills, merges and clears real ranges through validation, native save and reopening without rewriting unrelated parts',async()=>{
    const project=join(fixture,'range-project');mkdirSync(project);
    const original=readFileSync(join(fixtures,'rich-source.xlsx')),path=join(project,'range.xlsx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'range-dir',path:project,label:'Range',projectId:'range-test'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'range-test'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'range.xlsx'}),id=randomUUID();
    const range=(r1:number,c1:number,r2=r1,c2=c1)=>({firstRow:r1,lastRow:r2,firstColumn:c1,lastColumn:c2});
    try {
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      await service.office.rangeAction('owner',{id,version:0,action:{type:'fill',direction:'right',sheetId:'2',range:range(1,1,1,2)}});
      await service.office.rangeAction('owner',{id,version:1,action:{type:'fill',direction:'down',sheetId:'1',range:range(1,1,2,1)}});
      await service.office.rangeAction('owner',{id,version:2,action:{type:'merge',sheetId:'1',range:range(1,0,2,1)}});
      const recalc=await service.office.recalculate('owner',{id,version:3});expect(recalc.calculation?.state,recalc.calculation?.message).toBe('ready');
      const saved=await service.office.save('owner',{id,version:3,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const disk=await OfficePackage.read(readFileSync(path)),model=new OfficeWorkbook(disk),before=await OfficePackage.read(original);
      expect(model.cell('2',1,2).formula?.text).toBe('Data!$B$2+Data!C3');expect(Number(model.cell('2',1,2).value)).toBe(3);expect(Number(model.cell('2',1,1).value)).toBe(6);
      expect(model.cell('1',2,1).value).toBe('3');expect(model.window('1',0,0,4,3).merges).toEqual([range(1,0,2,1)]);
      for(const part of before.names())if(!['xl/workbook.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml'].includes(part))expect(disk.read(part),part).toEqual(before.read(part));
      service.office.close('owner',id);const reopened=randomUUID();await service.office.open('owner',{id:reopened,ref:file.ref,baseHash:saved.receipt.revision!.hash});
      expect((await service.office.cell('owner',{id:reopened,sheetId:'2',row:1,column:2,start:0,length:100})).text).toBe('=Data!$B$2+Data!C3');
      await expect(service.office.rangeAction('owner',{id:reopened,version:0,action:{type:'clear',mode:'contents',sheetId:'1',range:range(1,0)}})).rejects.toThrow('完整合并');
      await service.office.rangeAction('owner',{id:reopened,version:0,action:{type:'unmerge',sheetId:'1',range:range(1,0)}});
      await service.office.rangeAction('owner',{id:reopened,version:1,action:{type:'clear',mode:'contents',sheetId:'2',range:range(1,2)}});
      const cleared=await service.office.save('owner',{id:reopened,version:2,draftId:randomUUID(),bufferVersion:2,opId:randomUUID()});expect(cleared.receipt.state).toBe('saved');
      const final=new OfficeWorkbook(await OfficePackage.read(readFileSync(path)));expect(final.cell('2',1,2).formula).toBeUndefined();expect(final.cell('1',2,1).value).toBe('3');expect(final.window('1',0,0,4,3).merges).toEqual([]);
      expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
    } finally {service.closeOwner('owner');service.office.dispose();}
  },30_000);
  it('adds, moves and renames sheets through Worker/native save and reopens the real package with formulas and original resources intact',async()=>{
    const project=join(fixture,'sheet-project');mkdirSync(project);
    const original=readFileSync(join(fixtures,'rich-source.xlsx')),path=join(project,'sheets.xlsx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'sheets-dir',path:project,label:'Sheets',projectId:'sheets-test'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'sheets-test'})).roots[0];
    const file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'sheets.xlsx'}),id=randomUUID();
    try {
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const added=await service.office.sheetAction('owner',{id,version:0,action:{type:'add'}});
      await service.office.sheetAction('owner',{id,version:1,action:{type:'move',sheetId:added.sheetId,index:0}});
      await service.office.sheetAction('owner',{id,version:2,action:{type:'rename',sheetId:'1',name:'Renamed Data'}});
      expect((await service.office.recalculate('owner',{id,version:3})).calculation?.state).toBe('ready');
      const saved=await service.office.save('owner',{id,version:3,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const disk=await OfficePackage.read(readFileSync(path)),model=new OfficeWorkbook(disk),before=await OfficePackage.read(original);
      expect(model.info.sheets.map(sheet=>sheet.name)).toEqual(['Sheet1','Renamed Data','Calc','Spare']);expect(Number(model.cell('2',1,1).value)).toBe(7);
      const chartPart='xl/charts/chart1.xml', chartBefore=before.read(chartPart).toString();
      expect(descendants(new OfficeXml(before.read(chartPart)).root,'f').map(node=>node.text)).toEqual(["'Data'!B1","'Data'!$B$2:$B$3"]);
      expect(disk.read(chartPart).toString()).toBe(chartBefore.replaceAll("<f>'Data'!",'<f>&apos;Renamed Data&apos;!'));
      expect(descendants(new OfficeXml(disk.read(chartPart)).root,'f').map(node=>node.text)).toEqual(["'Renamed Data'!B1","'Renamed Data'!$B$2:$B$3"]);
      const allowed=['xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml','xl/worksheets/sheet2.xml',chartPart];
      for(const name of before.names()) if(!allowed.includes(name)) expect(disk.read(name),name).toEqual(before.read(name));
      service.office.close('owner',id);const fresh=await service.office.open('owner',{id:randomUUID(),ref:file.ref,baseHash:saved.receipt.revision!.hash});
      expect(fresh.workbook.sheets[0].id).toBe(added.sheetId);expect(fresh.calculation?.state).toBe('ready');expect(fresh.state.dirty).toBe(false);
    } finally {service.closeOwner('owner');service.office.dispose();}
  },30_000);
  it('recalculates precise sheet renames with Unicode and quoted names while retaining shared/array/structured/3D semantics',async()=>{
    const original=await OfficePackage.read(readFileSync(join(fixtures,'rich-source.xlsx')));
    for(const name of ['新表',"另一个 O'Brien",'Budget 2027','Sheet_42','Σ','名称中含😀','D E','Αβγ']) {
      const changed=editOfficeSheet(original,{type:'rename',sheetId:'1',name}),prepared=prepareOfficeCalculation(changed.packageData);
      const output=await engine.calculate(await prepared.packageData.bytes(),new AbortController().signal);
      const final=transplantOfficeCalculation(changed.packageData,await OfficePackage.read(output.bytes),prepared.packageData),model=new OfficeWorkbook(final.packageData);
      const expected={B2:7,B3:7,B4:100,B5:3,B6:42,B7:7,B8:7,B9:7,B10:5,B11:6,B12:8,B15:7,B16:66,D2:9,D3:12};
      const actual=new Map(model.window('2',0,0,16,4).cells.map(cell=>[cell.address,Number(cell.value)]));
      for(const [address,value] of Object.entries(expected))expect(actual.get(address),`${name}/${address}`).toBe(value);
      expect(model.cell('2',8,1).formula?.text).toBe('SUM(Sales[Value])');
      for(const part of original.names()) if(!changed.plan.changed.includes(part)&&!changed.plan.removed.includes(part)&&!final.changedParts.includes(part))expect(final.packageData.read(part),part).toEqual(original.read(part));
    }
  },30_000);
  it('deletes a referenced sheet through Worker/native save and restores its full graph with undo after saving',async()=>{
    const project=join(fixture,'delete-project');mkdirSync(project);
    const original=readFileSync(join(fixtures,'rich-source.xlsx')),path=join(project,'delete.xlsx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'delete-dir',path:project,label:'Delete',projectId:'delete-test'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,{userData,directory:runtime},worker);
    const root=(await service.openScope('owner',{kind:'project',projectId:'delete-test'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'delete.xlsx'}),id=randomUUID();
    try {
      await service.office.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const deleted=await service.office.sheetAction('owner',{id,version:0,action:{type:'delete',sheetId:'1'}});
      expect(deleted.calculation?.state).toBe('cached');expect(deleted.sheetId).toBe('2');
      const calculated=await service.office.recalculate('owner',{id,version:1});expect(calculated.calculation?.state,calculated.calculation?.message).toBe('ready');
      const saved=await service.office.save('owner',{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const disk=await OfficePackage.read(readFileSync(path)),model=new OfficeWorkbook(disk),before=await OfficePackage.read(original);
      expect(model.info.sheets.map(sheet=>sheet.name)).toEqual(['Calc','Spare']);expect(model.cell('2',1,1).value).toBe('#REF!');expect(Number(model.cell('2',4,1).value)).toBe(77);expect(Number(model.cell('2',9,1).value)).toBe(5);
      expect(disk.has('xl/tables/table1.xml')).toBe(false);expect(disk.read('customXml/m9-opaque.bin')).toEqual(before.read('customXml/m9-opaque.bin'));
      const freshId=randomUUID(),fresh=await service.office.open('owner',{id:freshId,ref:file.ref,baseHash:saved.receipt.revision!.hash});
      expect(fresh.workbook.sheets.map(sheet=>sheet.id)).toEqual(['2','3']);expect(fresh.state.dirty).toBe(false);service.office.close('owner',freshId);
      await service.office.history('owner',{id,version:1,direction:'undo'});
      expect((await service.office.recalculate('owner',{id,version:2})).calculation?.state).toBe('ready');
      const restored=await service.office.save('owner',{id,version:2,draftId:randomUUID(),bufferVersion:2,opId:randomUUID()});expect(restored.receipt.state).toBe('saved');
      const undo=await OfficePackage.read(readFileSync(path));expect(undo.names()).toEqual(before.names());
      for(const name of before.names())if(name !== 'xl/worksheets/sheet2.xml')expect(undo.read(name),name).toEqual(before.read(name));
      expect(Number(new OfficeWorkbook(undo).cell('2',1,1).value)).toBe(7);
    } finally {service.closeOwner('owner');service.office.dispose();}
  },30_000);
  it('recalculates deletion variants with exact REF errors, IFERROR fallbacks, shared/array outputs and 3D shrinkage',async()=>{
    const original=await OfficePackage.read(readFileSync(join(fixtures,'rich-source.xlsx')));
    for(const name of ['新表',"另一个 O'Brien",'Budget 2027','Sheet_42','Σ','名称中含😀','D E','Αβγ']) {
      const input=name === '新表' ? editOfficeCell(original,{sheetId:'2',row:8,column:1,text:'=SUM(Sales)'}).packageData : original;
      const renamed=editOfficeSheet(input,{type:'rename',sheetId:'1',name}),changed=editOfficeSheet(renamed.packageData,{type:'delete',sheetId:'1'}),prepared=prepareOfficeCalculation(changed.packageData);
      const output=await engine.calculate(await prepared.packageData.bytes(),new AbortController().signal);
      const final=transplantOfficeCalculation(changed.packageData,await OfficePackage.read(output.bytes),prepared.packageData),model=new OfficeWorkbook(final.packageData);
      const expected={B2:'#REF!',B3:'#REF!',B4:100,B5:77,B6:42,B7:88,B8:'#REF!',B9:'#REF!',B10:5,B11:'#REF!',B12:'#REF!',B15:99,B16:66,D2:'#REF!',D3:'#REF!'};
      const actual=new Map(model.window('2',0,0,16,4).cells.map(cell=>[cell.address,cell.type === 'number' ? Number(cell.value) : cell.value]));
      for(const [address,value] of Object.entries(expected))expect(actual.get(address),`${name}/${address}`).toBe(value);
      expect(model.cell('2',15,1).formula?.text).toBe('IFERROR(INDIRECT("Data!B2"),66)');
      for(const part of renamed.packageData.names())if(!changed.plan.changed.includes(part)&&!changed.plan.removed.includes(part)&&!final.changedParts.includes(part))expect(final.packageData.read(part),part).toEqual(renamed.packageData.read(part));
    }
  },30_000);
  it('enforces native wall and RSS limits and kills the calculation group on cancellation', async () => {
    for (const extra of [{ testWallMs: 1 }, { testRssBytes: 1 }]) {
      const input = await nativeInput(extra);
      await expect(broker.request(input, { timeoutMs: 10_000 })).rejects.toThrow('testWallMs' in extra ? 'TIMEOUT' : 'TOO_LARGE');
      expect(broker.activeProcesses).toBe(0); await workspaces.clean(input.job);
    }
    const input = await nativeInput({ testStopAt: 'office-running' }), abort = new AbortController(); let started = 0;
    await expect(broker.request(input, { signal: abort.signal, timeoutMs: 10_000, onTestStop: () => { started = Date.now(); abort.abort(); } })).rejects.toThrow('CANCELLED');
    expect(started).toBeGreaterThan(0); expect(Date.now() - started).toBeLessThan(2000); expect(broker.activeProcesses).toBe(0);
    await workspaces.clean(input.job); expect(readdirSync(join(userData, 'm9-office-jobs'))).toEqual([]);
  }, 20_000);
  it('rejects an input digest mismatch, a foreign job marker and a changed native resource receipt', async () => {
    const mismatch = await nativeInput({ hash: '0'.repeat(64) }); await expect(broker.request(mismatch)).rejects.toThrow('CHANGED'); await workspaces.clean(mismatch.job);
    const changed = await nativeInput({ files: resources.files.map((file) => file.path === 'classes/WillYouOffice.class' ? { ...file, hash: '0'.repeat(64) } : file) });
    await expect(broker.request(changed)).rejects.toThrow('CHANGED'); await workspaces.clean(changed.job);
    const foreign = await nativeInput(); writeFileSync(join(foreign.job.path, '.willyou-office-job.json'), JSON.stringify({ schema: 1, ownerPid: 2, identity: foreign.job.identity }));
    await expect(broker.request(foreign)).rejects.toThrow('UNTRUSTED');
  });
  it('recovers only Office orphan jobs while retaining a live job and the separate TeX workspace', async () => {
    const dead = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }));
    const orphan = await workspaces.create(), live = await workspaces.create(), tex = await new FileEngineWorkspaces(userData, broker, 'tex').create();
    writeFileSync(join(orphan.path, '.willyou-office-job.json'), JSON.stringify({ schema: 1, ownerPid: dead, identity: orphan.identity }));
    writeFileSync(join(orphan.path, 'candidate.xlsx'), 'private old candidate');
    expect((await workspaces.recover()).removed).toEqual([orphan.path.split('/').at(-1)]);
    expect(existsSync(orphan.path)).toBe(false); expect(existsSync(live.path)).toBe(true); expect(existsSync(tex.path)).toBe(true);
    await workspaces.clean(live);
  });
  it('blocks an actual Java read/write/process/network canary under the production sandbox profile', async () => {
    // Test-only helper in an isolated clone: attempts never target user files.
    // The production helper/resources remain byte-identical.
    const clone = join(fixture, 'runtime'); cpSync(runtime, clone, { recursive: true, mode: constants.COPYFILE_FICLONE });
    const canary = join(fixture, 'outside-secret'), outputCanary = join(fixture, 'outside-write'); writeFileSync(canary, 'synthetic private marker');
    let connections = 0; canaryServer = createServer((socket) => { connections++; socket.destroy(); });
    await new Promise<void>((done) => canaryServer!.listen(0, '127.0.0.1', done));
    const port = (canaryServer.address() as { port: number }).port;
    const java = `import java.nio.file.*; import java.net.*; public class WillYouOffice {
      interface Attempt { void run() throws Exception; }
      static void denied(Attempt attempt) throws Exception { boolean blocked=false; try { attempt.run(); } catch (Exception e) { blocked=true; } if(!blocked) throw new Exception("Sandbox canary was allowed"); }
      public static void main(String[] args) throws Exception {
        denied(() -> Files.readAllBytes(Path.of(${JSON.stringify(canary)})));
        denied(() -> Files.writeString(Path.of(${JSON.stringify(outputCanary)}), "must not write"));
        denied(() -> new ProcessBuilder("/usr/bin/true").start().waitFor());
        denied(() -> { try(Socket socket = new Socket()) { socket.connect(new InetSocketAddress("127.0.0.1", ${port}), 500); } });
        Files.copy(Path.of(args[1]), Path.of(args[2]));
        System.out.println("WILLYOU_OFFICE_RESULT={\\\"engine\\\":\\\"Apache POI 5.5.1\\\",\\\"formulas\\\":0}");
      }
    }`;
    const source = join(fixture, 'WillYouOffice.java'); writeFileSync(source, java);
    execFileSync(join(clone, 'jre/bin/java'), ['-jar', resolve('release/engine-cache/office/ecj-3.43.0.jar'), '-21', '-proc:none', '-d', join(clone, 'classes'), source]);
    const manifestPath = join(clone, 'resources.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const name of readdirSync(join(clone, 'classes'))) {
      const bytes = readFileSync(join(clone, 'classes', name)), path = `classes/${name}`, value = { path, bytes: bytes.length, sha256: hash(bytes) };
      const index = manifest.files.findIndex((file: { path: string }) => file.path === path); if (index >= 0) manifest.files[index] = value; else manifest.files.push(value);
    }
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const testResources = await officeEngineResources(clone), input = await nativeInput(testResources), result = await broker.request<OfficeNativeResult>(input, { timeoutMs: 15_000 });
    expect(result.state, result.state === 'failed' ? result.diagnostic : '').toBe('ready'); expect(connections).toBe(0); expect(existsSync(outputCanary)).toBe(false); expect(readFileSync(canary, 'utf8')).toBe('synthetic private marker');
    await workspaces.clean(input.job);
  }, 30_000);
});
