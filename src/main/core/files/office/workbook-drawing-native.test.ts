import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {NativeFileBroker} from '../native-broker';
import {FileService} from '../file-service';
import {FileRootsService,type RootSource} from '../roots';
import {FileRecoveryStore} from '../recovery-store';
import {OfficePackage} from './package';
import {decodeOfficeDraft} from './draft';
import {OfficeCalculationEngine} from './engine';
import {PPTX_BASIC_CHARTS} from '@shared/file-pptx-chart';

const enabled=process.platform==='darwin'&&!!process.env.SMARTDD_M9_FILE_BROKER&&process.env.SMARTDD_M9_WORKBOOK_DRAWING_NATIVE==='1';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
describe.skipIf(!enabled)('actual packaged native image decoder through FileService and the current real workbook Worker',()=>{
 let directory:string,worker:string;
 beforeAll(()=>{
  directory=realpathSync(mkdtempSync(join(tmpdir(),'willyou-workbook-drawing-native-')));worker=join(directory,'office.cjs');
  const require=createRequire(import.meta.url),build=createRequire(require.resolve('electron-vite/package.json'))('esbuild');build.buildSync({entryPoints:[resolve('src/main/core/files/office/worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
  expect(sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!))).toBe('8d9a50019c981e747b5bc1a0e252acbb150694ea15d6147ee7abbd4cce9cf8a2');
 });
 afterAll(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});
 it('rejects invalid native raster content, then inserts exact real PNG bytes and saves/reopens with the original package closure intact',async()=>{
  const project=join(directory,'project'),userData=join(directory,'user-data');mkdirSync(project);mkdirSync(userData);
  const original=readFileSync('src/main/core/files/office/__fixtures__/ordinary-drawing.xlsx'),source=await OfficePackage.read(original),png=source.read('xl/media/image1.png'),path=join(project,'source.xlsx');writeFileSync(path,original);
  const broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!),requests=vi.spyOn(broker,'request'),resolver={sources:():RootSource[]=>[{kind:'project-directory',id:'drawing-native-project',path:project,label:'Drawing native fixture',projectId:'drawing-native'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,worker),owner='drawing-native-owner',id=randomUUID();
  try{
   const root=(await service.openScope(owner,{kind:'project',projectId:'drawing-native'})).roots[0],file=await service.open(owner,{lease:root.lease,generation:root.generation,relativePath:'source.xlsx'});
   await service.office.open(owner,{id,ref:file.ref,baseHash:file.revision.hash});
   const range={firstRow:4,lastRow:4,firstColumn:1,lastColumn:1},action={type:'drawing-insert' as const,sheetId:'1',range,drawing:{kind:'image' as const,image:{mime:'image/png' as const,base64:png.toString('base64')}}};
   await expect(service.office.rangeAction('foreign',{id,version:0,action})).rejects.toThrow('不属于');
   await expect(service.office.rangeAction(owner,{id,version:0,action:{...action,drawing:{kind:'image',image:{mime:'image/png',base64:'iVBORw0KGgo='}}}})).rejects.toThrow();
   const changed=await service.office.rangeAction(owner,{id,version:0,action});expect(changed.state.version).toBe(1);
   const page=await service.office.window(owner,{id,sheetId:'1',row:0,column:0,rows:6,columns:6}),images=page.objects?.filter(value=>value.kind==='image');expect(images).toHaveLength(2);const inserted=images!.at(-1)!;
   expect(inserted.media.sha256).toBe(sha(png));const media=await service.office.drawingImage(owner,{id,sheetId:'1',objectId:inserted.id,mediaHash:inserted.media.sha256});expect(Buffer.from(media.bytes)).toEqual(png);expect(sha(readFileSync(path))).toBe(sha(original));
   const saved=await service.office.save(owner,{id,version:1,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');expect(saved.state.dirty).toBe(false);
   const output=readFileSync(path),reopened=await OfficePackage.read(output);for(const part of source.names())if(part!=='xl/drawings/drawing1.xml'&&part!=='xl/drawings/_rels/drawing1.xml.rels'&&part!=='[Content_Types].xml')expect(reopened.read(part),part).toEqual(source.read(part));
   service.office.close(owner,id);const refreshed=await service.refresh(owner,file.ref),second=randomUUID();await service.office.open(owner,{id:second,ref:refreshed.ref,baseHash:refreshed.revision.hash});const reloaded=await service.office.window(owner,{id:second,sheetId:'1',row:0,column:0,rows:6,columns:6});expect(reloaded.objects?.filter(value=>value.kind==='image')).toEqual(images);
   const textInserted=await service.office.rangeAction(owner,{id:second,version:0,action:{type:'drawing-insert',sheetId:'1',range,drawing:{kind:'text',frame:{x:145,y:90,width:240,height:100},autoSize:false}}}),textPage=await service.office.window(owner,{id:second,sheetId:'1',row:0,column:0,rows:6,columns:6}),textBox=textPage.objects!.find(value=>value.kind==='shape'&&value.shape?.textBox)!;
   const pendingDrawing={sheetId:'1',objectId:textBox.id,text:'原生草稿恢复\nText & <hello> 😀'},draftId=randomUUID();
   await service.office.checkpoint(owner,{id:second,version:textInserted.state.version,draftId,bufferVersion:2,pendingDrawing});const draft=await service.readDraft(owner,refreshed.ref,draftId),envelope=Buffer.from(draft.base64,'base64');expect(decodeOfficeDraft(envelope).pendingDrawing).toEqual(pendingDrawing);expect(sha(readFileSync(path))).toBe(sha(output));
   service.office.close(owner,second);const third=randomUUID();await service.office.open(owner,{id:third,ref:refreshed.ref,baseHash:refreshed.revision.hash});
   const restored=await service.office.restore(owner,{id:third,version:0,draftId});expect(restored.pendingDrawing).toEqual(pendingDrawing);
   const textChanged=await service.office.rangeAction(owner,{id:third,version:restored.state.version,action:{type:'drawing-text',...pendingDrawing}}),textSaved=await service.office.save(owner,{id:third,version:textChanged.state.version,draftId,bufferVersion:3,opId:randomUUID()});expect(textSaved.receipt.state).toBe('saved');expect(textSaved.state.dirty).toBe(false);
   const finalOutput=readFileSync(path);service.office.close(owner,third);const finalRef=await service.refresh(owner,refreshed.ref),last=randomUUID();await service.office.open(owner,{id:last,ref:finalRef.ref,baseHash:finalRef.revision.hash});
   const finalPage=await service.office.window(owner,{id:last,sheetId:'1',row:0,column:0,rows:6,columns:6});expect(finalPage.objects?.find(value=>value.id===textBox.id)).toMatchObject({shape:{text:pendingDrawing.text}});expect(finalPage.objects?.filter(value=>value.kind==='image')).toEqual(images);
   let chartVersion=0;for(const chartType of PPTX_BASIC_CHARTS){const result=await service.office.rangeAction(owner,{id:last,version:chartVersion,action:{type:'drawing-insert',sheetId:'1',range:{firstRow:1,lastRow:1,firstColumn:1,lastColumn:1},drawing:{kind:'chart',chartType}}});chartVersion=result.state.version;}
   const numeric=await service.office.edit(owner,{id:last,version:chartVersion,edit:{sheetId:'1',row:1,column:1,text:'91'}}),updated=await service.office.window(owner,{id:last,sheetId:'1',row:0,column:0,rows:6,columns:6});
   const charts=updated.objects?.flatMap(value=>value.kind==='chart'&&value.chart?[value.chart]:[])!;expect(charts.map(value=>value.type)).toEqual([...PPTX_BASIC_CHARTS]);for(const chart of charts)expect(chart.series[0].values).toEqual([91]);
   const chartSaved=await service.office.save(owner,{id:last,version:numeric.state.version,draftId:randomUUID(),bufferVersion:4,opId:randomUUID()});expect(chartSaved.receipt.state).toBe('saved');const chartOutput=readFileSync(path);
   service.office.close(owner,last);const chartRef=await service.refresh(owner,finalRef.ref),chartSession=randomUUID();await service.office.open(owner,{id:chartSession,ref:chartRef.ref,baseHash:chartRef.revision.hash});const chartReopened=await service.office.window(owner,{id:chartSession,sheetId:'1',row:0,column:0,rows:6,columns:6});expect(chartReopened.objects?.flatMap(value=>value.kind==='chart'&&value.chart?[value.chart]:[])).toEqual(charts);
   let poiOutput:Uint8Array|undefined,poiSmoke=false;
   if(process.env.SMARTDD_M9_WORKBOOK_OFFICE_RUNTIME){
    const engine=new OfficeCalculationEngine(broker,{userData,directory:process.env.SMARTDD_M9_WORKBOOK_OFFICE_RUNTIME,packagePath:process.env.SMARTDD_M9_WORKBOOK_APP});
    try{const calculated=await engine.calculate(chartOutput,new AbortController().signal);expect(calculated.formulas).toBe(0);poiOutput=calculated.bytes;const candidate=await OfficePackage.read(poiOutput);expect(candidate.names().filter(name=>/^xl\/charts\/willyou-chart-.*\.xml$/.test(name))).toHaveLength(5);expect(sha(readFileSync(path))).toBe(sha(chartOutput));poiSmoke=true;}finally{engine.dispose();}
   }
   const nativeInspect=requests.mock.calls.filter(([request])=>request.operation==='raster-inspect');expect(nativeInspect.length).toBeGreaterThanOrEqual(2);
   if(process.env.SMARTDD_M9_WORKBOOK_DRAWING_OUTPUT){const out=process.env.SMARTDD_M9_WORKBOOK_DRAWING_OUTPUT;mkdirSync(out,{recursive:true});writeFileSync(join(out,'original.xlsx'),original);writeFileSync(join(out,'image-saved.xlsx'),output);writeFileSync(join(out,'saved.xlsx'),finalOutput);writeFileSync(join(out,'chart-edited-saved.xlsx'),chartOutput);if(poiOutput)writeFileSync(join(out,'poi-private-consumer-smoke.xlsx'),poiOutput);writeFileSync(join(out,'selected.png'),png);writeFileSync(join(out,'pending-recovery.bin'),envelope);writeFileSync(join(out,'native-receipt.json'),JSON.stringify({sourceSHA256:sha(original),savedSHA256:sha(finalOutput),imageSavedSHA256:sha(output),chartSavedSHA256:sha(chartOutput),pngSHA256:sha(png),brokerSHA256:sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)),nativeInspectCount:nativeInspect.length,saveReceipt:saved.receipt,textSaveReceipt:textSaved.receipt,chartSaveReceipt:chartSaved.receipt,pendingDrawing,textRecovery:true,linkedChartTypes:[...PPTX_BASIC_CHARTS],linkedChartValue:91,poiConsumerSmoke:poiSmoke,poiIsNotChartVisualAcceptance:true,sourceUnchangedBeforeSave:true,kind:'actual-native-FileService-Worker-I-no-App-or-picker'},null,2)+'\n');}
  }finally{service.closeOwner(owner);expect(service.office.activeDocuments).toBe(0);requests.mockRestore();broker.dispose();}
 },30000);
});
