import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect } from 'vitest';
import { resolve,join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync,statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { ZipFile } from 'yazl';
import { libreOfficeResources,type LibreOfficeResources } from './libreoffice-resources';
import { LibreOfficeEngine,type OfficeRenderNativeResult } from './libreoffice-engine';
import { NativeFileBroker } from '../native-broker';
import { FileEngineWorkspaces } from '../engine-workspaces';
import { FileHeavyJobs } from '../heavy-jobs';
import { OfficePackage } from './package';
import { OfficeRelationships,OPC_REL,OPC_TYPES,OFFICE_REL } from './relationships';
import { OfficeXml,children,attribute } from './xml';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { PPTX_SHAPES,PPTX_PRESETS } from '@shared/file-pptx-elements';
import type { PptxAction } from '@shared/file-pptx';
import { pptxPendingInputs } from '@shared/file-pptx';
import { OfficePagesModel } from './pages-model';
import { editPptx } from './pptx-edit';
import { pptxTestImage } from './pptx-image-fixtures';
import { pptxTableLayoutSource,readPptxTableLayout } from './pptx-table-layout';
import { drawingNamespace,EMU_PER_POINT,pptxShapeTree,pptxDrawingNodes } from './pptx-elements';

const enabled=process.env.SMARTDD_M9_LIBREOFFICE_NATIVE==='1' && process.platform==='darwin';
// A verified package may supply the unchanged vendor resources when the live
// worktree has no generated out/ cache. The actual broker is still built here.
const preparedRuntime=resolve(process.env.SMARTDD_M9_LIBREOFFICE_RUNTIME??'out/native/libreoffice');
const checksum=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function docxFixture():Promise<Buffer>{
  const zip=new ZipFile(),parts={
    '[Content_Types].xml':`<Types xmlns="${OPC_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels':`<Relationships xmlns="${OPC_REL}"><Relationship Id="r1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>WillYou DOCX native rendering</w:t></w:r></w:p><w:p><w:r><w:t>中文排版 😀</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
  };
  for(const [name,text] of Object.entries(parts))zip.addBuffer(Buffer.from(text),name);zip.end();
  const chunks:Buffer[]=[];for await(const chunk of zip.outputStream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);
}

describe.skipIf(!enabled)('full pinned LibreOffice resources (real vendor signature, no UI acceptance)',()=>{
  it('verifies the prepared official bundle and returns a bounded native manifest',async()=>{
    const result=await libreOfficeResources(preparedRuntime);
    expect(result.bytes).toBeGreaterThan(500*1024*1024);expect(result.bytes).toBeLessThanOrEqual(1024*1024*1024);
    expect(result.files.length+result.links.length).toBeGreaterThan(10000);
    expect(result.files.some(file=>file.path==='LibreOffice.app/Contents/MacOS/soffice')).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(16*1024*1024);
    console.log(JSON.stringify({bytes:result.bytes,files:result.files.length,links:result.links.length,requestBytes:Buffer.byteLength(JSON.stringify(result))}));
  },60000);
});

describe.skipIf(!enabled)('fixed LibreOffice through the real native rendering boundary',()=>{
  let build:string,fixture:string,userData:string,broker:NativeFileBroker,engine:LibreOfficeEngine,workspaces:FileEngineWorkspaces,resources:LibreOfficeResources;
  const runtime=preparedRuntime;
  beforeAll(async()=>{
    build=realpathSync(mkdtempSync(join(tmpdir(),'willyou-lo-native-build-')));
    const executable=join(build,'willyou-files-test');
    execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-DWILLYOU_FILE_BROKER_TEST=1','-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',resolve('native/files/broker.mm'),'-o',executable]);
    broker=new NativeFileBroker(executable);resources=await libreOfficeResources(runtime);
  },60000);
  beforeEach(()=>{
    fixture=realpathSync(mkdtempSync(join(tmpdir(),'willyou-lo-native-')));userData=join(fixture,'userdata');mkdirSync(userData);
    engine=new LibreOfficeEngine(broker,{userData,directory:runtime},new FileHeavyJobs());workspaces=new FileEngineWorkspaces(userData,broker,'office');
  });
  afterEach(()=>{engine?.dispose();broker?.dispose();if(fixture)rmSync(fixture,{recursive:true,force:true});});
  afterAll(()=>{if(build)rmSync(build,{recursive:true,force:true});});
  const request=async(bytes:Buffer,format:'docx'|'pptx',extra={})=>({operation:'office-render',job:await workspaces.create(),...resources,format,base64:bytes.toString('base64'),hash:checksum(bytes),...extra});
  it('resizes nine chart datasets through real Worker save native rendering and full source recovery',async()=>{
    const worker=join(build,'chart-resize.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);const path=join(project,'resize.pptx');writeFileSync(path,readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')));
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'Chart resize',projectId:'resize'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker),evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'resize'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'resize.pptx'});let id=randomUUID(),draftId=randomUUID(),{state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const edit=async(action:PptxAction)=>{state=await service.pptx.edit('owner',{id,version:state.version,action});};const charts:{type:string;slideId:string;elementId:string;page:number}[]=[];
      for(const type of ['bar','line','pie','area','scatter','histogram','waterfall','funnel','treemap'] as const){
        await edit({type:'add',slideId:state.info.slides.at(-1)!.id});const slideId=state.info.slides.at(-1)!.id;await edit({type:'chart-insert',slideId,chartType:'funnel'});const elementId=state.info.slides.at(-1)!.elements!.at(-1)!.id;
        await edit({type:'chart-options',slideId,elementId,patch:{axes:true,gridLines:true,legend:true}});await edit({type:'chart-type',slideId,elementId,chartType:type});charts.push({type,slideId,elementId,page:state.info.slides.length});
      }
      await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});const baseline=readFileSync(path),baselinePath=join(fixture,'resize-baseline.pptx');writeFileSync(baselinePath,baseline);service.pptx.close('owner',id);
      const fresh=await service.refresh('owner',file.ref);id=randomUUID();draftId=randomUUID();({state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:fresh.revision.hash}));
      const verify=(expected:number[])=>JSON.parse(execFileSync('python3',['-c',String.raw`import sys,zipfile,io,posixpath,json,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);o=zipfile.ZipFile(sys.argv[2]);items=json.loads(sys.argv[3]);expected=json.loads(sys.argv[4]);cx='{http://schemas.microsoft.com/office/drawing/2014/chartex}';c='{http://schemas.openxmlformats.org/drawingml/2006/chart}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';s='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}';p='{http://schemas.openxmlformats.org/presentationml/2006/main}'
def rels(book,part):return {n.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),n.attrib['Target'])) for n in E.fromstring(book.read(posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')))}
slides={n.attrib['id']:rels(z,'ppt/presentation.xml')[n.attrib[r+'id']] for n in E.fromstring(z.read('ppt/presentation.xml')).iter(p+'sldId')}
def chart(book,part):
 ref=next(n for n in E.fromstring(book.read(part)).iter() if n.tag in [cx+'chart',c+'chart']);cp=rels(book,part)[ref.attrib[r+'id']];root=E.fromstring(book.read(cp));modern=ref.tag==cx+'chart';ed=root.find(cx+'chartData/'+cx+'externalData') if modern else root.find(c+'externalData');bp=rels(book,cp)[ed.attrib[r+'id']];return root,zipfile.ZipFile(io.BytesIO(book.read(bp))),modern
out=[];edited={'[Content_Types].xml'}
for item in items:
 part=slides[item['slideId']];edited.update([part,posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')]);root,book,modern=chart(z,part);_,old,_=chart(o,part)
 if modern:
  dim=root.find(cx+'chartData/'+cx+'data/'+cx+'numDim');cat=root.find(cx+'chartData/'+cx+'data/'+cx+'strDim');values=[float(n.text) for n in dim.findall(cx+'lvl/'+cx+'pt')];labels=[n.text for n in cat.findall(cx+'lvl/'+cx+'pt')];formula=dim.find(cx+'f').text;category=cat.find(cx+'f').text
 else:
  series=root.find('.//'+c+'ser');value=series.find(c+('yVal' if item['type']=='scatter' else 'val')+'/'+c+'numRef');cat=series.find(c+('xVal' if item['type']=='scatter' else 'cat'));cat=list(cat)[0];values=[float(n.text) for n in value.findall(c+'numCache/'+c+'pt/'+c+'v')];labels=[n.text for n in cat.findall('.//'+c+'pt/'+c+'v')];formula=value.find(c+'f').text;category=cat.find(c+'f').text
 assert values==expected and labels==[str(i+1) for i in range(len(expected))],(item,values,labels)
 if item['type']=='area':
  companions=root.findall(c+'chart/'+c+'plotArea/'+c+'lineChart/'+c+'ser');assert len(companions)==1;helper=companions[0];hv=helper.find(c+'val/'+c+'numRef');hc=list(helper.find(c+'cat'))[0];assert hv.find(c+'f').text==formula and hc.find(c+'f').text==category;assert [float(n.text) for n in hv.findall(c+'numCache/'+c+'pt/'+c+'v')]==expected;assert [n.text for n in hc.findall('.//'+c+'pt/'+c+'v')]==labels;assert len(helper.findall(c+'dPt'))==len(expected);assert root.find(c+'chart/'+c+'legend/'+c+'legendEntry/'+c+'delete').attrib['val']=='1'
 name=formula.split('!')[0];sheets={n.attrib['name']:rels(book,'xl/workbook.xml')[n.attrib[r+'id']] for n in E.fromstring(book.read('xl/workbook.xml')).iter(s+'sheet')};assert formula==name+'!$B$2:$B$'+str(len(expected)+1);assert category==name+'!$A$2:$A$'+str(len(expected)+1)
 cells={n.attrib['r']:float(n.find(s+'v').text) for n in E.fromstring(book.read(sheets[name])).iter(s+'c') if n.find(s+'v') is not None};assert [cells['B'+str(i+2)] for i in range(len(expected))]==expected;assert [cells['A'+str(i+2)] for i in range(len(expected))]==list(range(1,len(expected)+1));assert len(cells)==2*len(expected)
 assert all(book.read(n)==old.read(n) for n in old.namelist() if n not in ['[Content_Types].xml','xl/workbook.xml','xl/_rels/workbook.xml.rels']);out.append({'type':item['type'],'count':len(expected),'sheet':name,'values':values,'oldWorksheetsPreserved':True})
assert all(z.read(n)==o.read(n) for n in o.namelist() if n not in edited);print(json.dumps(out))`,path,baselinePath,JSON.stringify(charts),JSON.stringify(expected)],{encoding:'utf8',timeout:15000}));
      for(const chart of charts)await edit({type:'chart-values',slideId:chart.slideId,elementId:chart.elementId,values:[7]});await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});const single=verify([7]);
      const one=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),onePdf=join(fixture,'single.pdf');writeFileSync(onePdf,Buffer.from(service.pptx.chunk('owner',id,one.id,0,one.bytes),'base64'));expect(one.pages).toBe(11);
      const linePage=charts.find(row=>row.type==='line')!.page,lineStem=join(fixture,'single-line');execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(linePage),'-singlefile','-r','96',onePdf,lineStem],{timeout:15000});
      const singleLinePixels=Number(execFileSync('python3',['-c',String.raw`import sys,pathlib
head,size,maximum,data=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);assert head==b'P6' and maximum==b'255';count=list(zip(data[::3],data[1::3],data[2::3])).count((20,128,110));assert count>5,count;print(count)`,lineStem+'.ppm'],{encoding:'utf8',timeout:15000}));
      const areaPage=charts.find(row=>row.type==='area')!.page,areaStem=join(fixture,'single-area');execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(areaPage),'-singlefile','-r','96',onePdf,areaStem],{timeout:15000});
      const singleAreaPixels=Number(execFileSync('python3',['-c',String.raw`import sys,pathlib
head,size,maximum,data=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);assert head==b'P6' and maximum==b'255';count=list(zip(data[::3],data[1::3],data[2::3])).count((20,128,110));assert count>5,count;print(count)`,areaStem+'.ppm'],{encoding:'utf8',timeout:15000}));
      if(evidence){writeFileSync(join(evidence,'single.pptx'),readFileSync(path));writeFileSync(join(evidence,'single.pdf'),readFileSync(onePdf));for(const type of ['line','area','pie','funnel'] as const){const page=charts.find(row=>row.type===type)!.page,stem=join(evidence,'single-'+type);execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(page),'-singlefile','-r','96','-png',onePdf,stem],{timeout:15000});}}
      const values=[1,8,2,7,3,6,4,5];for(const chart of charts)await edit({type:'chart-values',slideId:chart.slideId,elementId:chart.elementId,values});const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');const expanded=verify(values);
      const projection=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),pdf=join(fixture,'eight.pdf');writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,projection.id,0,projection.bytes),'base64'));expect(projection.pages).toBe(11);expect(projection.sourceHash).toBe(saved.receipt.revision!.hash);
      const renders=[];for(const chart of charts){const stem=join(fixture,chart.type);execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(chart.page),'-singlefile','-r','96',pdf,stem],{timeout:15000});const pixels=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,pathlib,json,collections
head,size,maximum,data=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);assert head==b'P6' and maximum==b'255';w,h=map(int,size.split());rgb=list(zip(data[::3],data[1::3],data[2::3]));nonwhite=sum(min(v)<180 for v in rgb);assert nonwhite>300
components=[]
if sys.argv[2] in ['scatter','area']:
 for color in [(20,128,110),(195,91,85),(87,121,168),(182,133,56)]:
  remaining={i for i,p in enumerate(rgb) if p==color};groups=[]
  while remaining:
   seed=remaining.pop();queue=[seed];count=0
   while queue:
    i=queue.pop();count+=1
    for j in [i-1,i+1,i-w,i+w]:
     if j in remaining and abs((i%w)-(j%w))+abs((i//w)-(j//w))==1:remaining.remove(j);queue.append(j)
   if count>5:groups.append(count)
  assert len(groups)==2,(color,groups);components.append(groups)
print(json.dumps({'nonWhitePixels':nonwhite,'scatterComponents':components if sys.argv[2]=='scatter' else [],'markerComponents':components}))`,stem+'.ppm',chart.type],{encoding:'utf8',timeout:15000}));renders.push({type:chart.type,...pixels,ppmHash:checksum(readFileSync(stem+'.ppm'))});if(evidence){execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(chart.page),'-singlefile','-r','96','-png',pdf,stem],{timeout:15000});writeFileSync(join(evidence,'resize-'+chart.type+'.png'),readFileSync(stem+'.png'));}}
      const refreshed=await service.refresh('owner',file.ref),verifyId=randomUUID(),reopened=await service.pptx.open('owner',{id:verifyId,ref:file.ref,baseHash:refreshed.revision.hash});for(const chart of charts)expect(reopened.state.info.slides.find(row=>row.id===chart.slideId)!.elements!.find(row=>row.id===chart.elementId)!.chart?.values).toEqual(values);
      const pending={slideId:charts[3].slideId,elementId:charts[3].elementId,chartValues:true as const,text:'1,8,候选,'},recoveryId=randomUUID();await service.pptx.checkpoint('owner',{id,version:state.version,draftId:recoveryId,bufferVersion:30,pending});const recovered=await service.pptx.restore('owner',{id:verifyId,version:0,draftId:recoveryId});expect(pptxPendingInputs(recovered.pending)).toEqual([pending]);service.pptx.close('owner',verifyId);
      if(evidence){writeFileSync(join(evidence,'baseline.pptx'),baseline);writeFileSync(join(evidence,'eight.pptx'),readFileSync(path));writeFileSync(join(evidence,'eight.pdf'),readFileSync(pdf));}
      for(let index=0;index<18;index++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual((await OfficePackage.read(baseline)).hashes());
      if(evidence)writeFileSync(join(evidence,'resize.json'),JSON.stringify({single,expanded,renders,singleLinePixels,singleAreaPixels,baselineHash:checksum(baseline),sourceHash:saved.receipt.revision!.hash,pdfHash:projection.hash,reopened:true,pendingRecovered:true,pendingType:'area',undoMutations:18,allBaselinePartsRestored:true,uiAcceptance:false,pixelParity:false,singlePointVisualReview:'line and area single-point markers independently checked; full prototype/App fidelity pending'},null,2)+'\n');
    }finally{service.closeOwner('owner');}
  },240000);
  it('round trips nine chart source types through the real Worker save and native renderer',async()=>{
    const worker=join(build,'chart-roundtrip.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'nine.pptx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'Chart conversions',projectId:'charts'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'charts'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'nine.pptx'}),id=randomUUID(),draftId=randomUUID();let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash}),mutations=0;
      const edit=async(action:PptxAction)=>{const before=state.version;state=await service.pptx.edit('owner',{id,version:before,action});if(state.version!==before)mutations++;};const charts=[];
      for(const type of ['bar','line','pie','area','scatter','histogram','waterfall','funnel','treemap'] as const){
        await edit({type:'add',slideId:state.info.slides.at(-1)!.id});const slideId=state.info.slides.at(-1)!.id;
        await edit({type:'chart-insert',slideId,chartType:'funnel'});const elementId=state.info.slides.at(-1)!.elements!.at(-1)!.id;
        await edit({type:'chart-values',slideId,elementId,values:[6,3,4]});await edit({type:'chart-options',slideId,elementId,patch:{axes:true,gridLines:true,legend:true}});await edit({type:'chart-type',slideId,elementId,chartType:type});
        charts.push({type,slideId,elementId,page:state.info.slides.length});
      }
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,zipfile,io,posixpath,json,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);o=zipfile.ZipFile(sys.argv[2]);cx='{http://schemas.microsoft.com/office/drawing/2014/chartex}';c='{http://schemas.openxmlformats.org/drawingml/2006/chart}';a='{http://schemas.openxmlformats.org/drawingml/2006/main}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';s='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
def rels(part):return {n.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),n.attrib['Target'])) for n in E.fromstring(z.read(posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')))}
out=[]
for item in json.loads(sys.argv[3]):
 part=next(rels('ppt/presentation.xml')[n.attrib[r+'id']] for n in E.fromstring(z.read('ppt/presentation.xml')).iter('{http://schemas.openxmlformats.org/presentationml/2006/main}sldId') if n.attrib['id']==item['slideId']);slide=E.fromstring(z.read(part));ref=next(n for n in slide.iter() if n.tag in [cx+'chart',c+'chart']);cp=rels(part)[ref.attrib[r+'id']];chart=E.fromstring(z.read(cp));modern=ref.tag==cx+'chart';ns=cx if modern else c
 if modern:
  series=chart.find('.//'+cx+'series');kind=series.attrib['layoutId'];kind='histogram' if kind=='clusteredColumn' else kind;values=[float(n.text) for n in chart.findall(cx+'chartData/'+cx+'data/'+cx+'numDim/'+cx+'lvl/'+cx+'pt')];points=series.findall(cx+'dataPt');ed=chart.find(cx+'chartData/'+cx+'externalData')
 else:
  plot=chart.find(c+'chart/'+c+'plotArea');typed=next(n for n in plot if n.tag.endswith('Chart'));kind=typed.tag.split('}')[1][:-5];series=typed.find(c+'ser');values=[float(n.text) for n in series.findall(c+('yVal' if kind=='scatter' else 'val')+'/'+c+'numRef/'+c+'numCache/'+c+'pt/'+c+'v')];points=series.findall(c+'dPt');ed=chart.find(c+'externalData')
  if kind=='scatter':assert [float(n.text) for n in series.findall(c+'xVal/'+c+'numRef/'+c+'numCache/'+c+'pt/'+c+'v')]==[1,2,3]
 assert kind==item['type'] and values==[6,3,4],(kind,values);assert [n.find(ns+'spPr/'+a+'solidFill/'+a+'srgbClr').attrib['val'] for n in points]==['14806E','C35B55','5779A8'];assert chart.find('.//'+a+'latin').attrib['typeface']=='Arial';assert chart.find('.//'+ns+'legend') is not None
 bp=rels(cp)[ed.attrib[r+'id']];book=zipfile.ZipFile(io.BytesIO(z.read(bp)));cells={n.attrib['r']:float(n.find(s+'v').text) for n in E.fromstring(book.read('xl/worksheets/sheet1.xml')).iter(s+'c') if n.find(s+'v') is not None};assert [cells['B2'],cells['B3'],cells['B4']]==values;out.append({'type':kind,'values':values,'pointColorsRetained':True,'fontRetained':True,'realWorkbook':True})
assert all(z.read(n)==o.read(n) for n in o.namelist() if n not in ['ppt/presentation.xml','ppt/_rels/presentation.xml.rels','[Content_Types].xml']);print(json.dumps(out))`,path,originalPath,JSON.stringify(charts)],{encoding:'utf8',timeout:15000}));
      const projection=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),pdf=join(fixture,'nine.pdf');expect(projection.pages).toBe(11);expect(projection.sourceHash).toBe(saved.receipt.revision!.hash);writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,projection.id,0,projection.bytes),'base64'));
      const renders=[];
      for(const chart of charts){const stem=join(fixture,chart.type);execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(chart.page),'-singlefile','-r','96',pdf,stem],{timeout:15000});const pixels=Number(execFileSync('python3',['-c',String.raw`import sys,pathlib
h,s,m,d=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);assert h==b'P6' and m==b'255';pixels=list(zip(d[::3],d[1::3],d[2::3]));n=sum(min(rgb)<180 for rgb in pixels);assert n>300
if sys.argv[2]=='scatter':
 counts=[pixels.count(color) for color in [(20,128,110),(195,91,85),(87,121,168)]];assert min(counts)>5,counts
print(n)`,stem+'.ppm',chart.type],{encoding:'utf8',timeout:15000}));renders.push({type:chart.type,nonWhitePixels:pixels,ppmHash:checksum(readFileSync(stem+'.ppm'))});if(evidence){execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(chart.page),'-singlefile','-r','96','-png',pdf,stem],{timeout:15000});writeFileSync(join(evidence,chart.type+'.png'),readFileSync(stem+'.png'));}}
      expect(new Set(renders.map(row=>row.ppmHash)).size).toBe(9);
      if(evidence){writeFileSync(join(evidence,'nine.pptx'),readFileSync(path));writeFileSync(join(evidence,'nine.pdf'),readFileSync(pdf));}
      const fresh=await service.refresh('owner',file.ref),verify=randomUUID(),reopened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});for(const chart of charts)expect(reopened.state.info.slides.find(row=>row.id===chart.slideId)!.elements!.find(row=>row.id===chart.elementId)!.chart).toMatchObject({type:chart.type,values:[6,3,4]});service.pptx.close('owner',verify);
      // Stay within the production 50-entry history limit for a complete undo.
      expect(mutations).toBeLessThan(50);for(let index=0;index<mutations;index++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual((await OfficePackage.read(original)).hashes());
      if(evidence)writeFileSync(join(evidence,'nine.json'),JSON.stringify({independent,renders,sourceHash:saved.receipt.revision!.hash,pdfHash:projection.hash,reopened:true,undoMutations:mutations,allOriginalPartsRestored:true,uiAcceptance:false,pixelParity:false},null,2)+'\n');
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },240000);
  it('renders four modern source charts through private projections and keeps real saved charts through recovery and undo',async()=>{
    const worker=join(build,'chart-modern.cjs'),pagesWorker=join(build,'chart-modern-pages.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    for(const [source,outfile] of [['pptx-worker.ts',worker],['pages-worker.ts',pagesWorker]])esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office',source)],bundle:true,platform:'node',format:'cjs',outfile,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'modern.pptx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'Modern charts',projectId:'modern'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},pagesWorker,worker);
    const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'modern'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'modern.pptx'}),id=randomUUID(),draftId=randomUUID();
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash}),mutations=0;
      const edit=async(action:PptxAction)=>{const before=state.version;state=await service.pptx.edit('owner',{id,version:before,action});if(state.version!==before)mutations++;};
      const charts:Array<{type:'funnel'|'histogram'|'waterfall'|'treemap';slideId:string;elementId:string;page:number}>=[];
      for(const type of ['funnel','histogram','waterfall','treemap'] as const){
        await edit({type:'add',slideId:state.info.slides.at(-1)!.id});const slideId=state.info.slides.at(-1)!.id;
        await edit({type:'chart-insert',slideId,chartType:'bar'});const elementId=state.info.slides.at(-1)!.elements!.at(-1)!.id;
        await edit({type:'chart-type',slideId,elementId,chartType:type});await edit({type:'chart-values',slideId,elementId,values:[6,3,4]});
        charts.push({type,slideId,elementId,page:state.info.slides.length});
      }
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,zipfile,io,posixpath,json,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);o=zipfile.ZipFile(sys.argv[2]);cx='{http://schemas.microsoft.com/office/drawing/2014/chartex}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';s='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
rel=lambda part:{n.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),n.attrib['Target'])) for n in E.fromstring(z.read(posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')))}
out=[]
for part in z.namelist():
 if not(part.startswith('ppt/slides/') and part.endswith('.xml') and '/_rels/' not in part):continue
 for ref in E.fromstring(z.read(part)).iter(cx+'chart'):
  chart=rel(part)[ref.attrib[r+'id']];root=E.fromstring(z.read(chart));series=root.find('.//'+cx+'series');data=root.find(cx+'chartData/'+cx+'data');values=[float(n.text) for n in data.findall(cx+'numDim/'+cx+'lvl/'+cx+'pt')];assert values==[6,3,4]
  book=zipfile.ZipFile(io.BytesIO(z.read(rel(chart)[root.find(cx+'chartData/'+cx+'externalData').attrib[r+'id']])));cells={n.attrib['r']:n.find(s+'v').text for n in E.fromstring(book.read('xl/worksheets/sheet1.xml')).iter(s+'c') if n.find(s+'v') is not None};assert [cells['B2'],cells['B3'],cells['B4']]==['6','3','4'];out.append({'type':series.attrib['layoutId'],'values':values})
assert len(out)==4
for name in o.namelist():
 if name not in ['ppt/presentation.xml','ppt/_rels/presentation.xml.rels','[Content_Types].xml']:assert z.read(name)==o.read(name),name
print(json.dumps(out))`,path,originalPath],{encoding:'utf8',timeout:15000}));
      const projection=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),pdf=join(fixture,'modern.pdf');expect(projection.pages).toBe(6);expect(projection.sourceHash).toBe(saved.receipt.revision!.hash);writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,projection.id,0,projection.bytes),'base64'));
      const measured=[];
      for(const item of charts){
        const stem=join(fixture,item.type);execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(item.page),'-singlefile','-r','96',pdf,stem],{timeout:15000});execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(item.page),'-singlefile','-r','96','-png',pdf,stem],{timeout:15000});
        const result=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,pathlib,json
head,size,maximum,data=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);w,h=map(int,size.split());assert head==b'P6' and maximum==b'255';colors=[(20,128,110),(195,91,85),(87,121,168)];out=[]
for color in colors:
 points=[(i%w,i//w) for i,rgb in enumerate(zip(data[::3],data[1::3],data[2::3])) if rgb==color];assert points,color;xs,ys=zip(*points);out.append({'x':min(xs),'y':min(ys),'width':max(xs)-min(xs)+1,'height':max(ys)-min(ys)+1})
dimension='width' if sys.argv[2] in ['funnel','treemap'] else 'height';scale=sum(row[dimension] for row in out)/13;errors=[abs(row[dimension]-value*scale) for row,value in zip(out,[6,3,4])];assert max(errors)<=2,(out,errors)
if sys.argv[2]=='waterfall':assert all(abs(a['y']-(b['y']+b['height']))<=2 for a,b in zip(out,out[1:]))
print(json.dumps({'type':sys.argv[2],'boxes':out,'maxErrorPixels':max(errors)}))`,stem+'.ppm',item.type],{encoding:'utf8',timeout:15000}));measured.push(result);
        if(evidence)writeFileSync(join(evidence,item.type+'.png'),readFileSync(stem+'.png'));
      }
      for(const item of charts)await edit({type:'chart-options',slideId:item.slideId,elementId:item.elementId,patch:{axes:true,gridLines:true,legend:true}});
      const optionsSaved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()}),shown=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),onPDF=join(fixture,'modern-options.pdf');writeFileSync(onPDF,Buffer.from(service.pptx.chunk('owner',id,shown.id,0,shown.bytes),'base64'));
      const decorations=[];
      for(const item of charts){
        const text=execFileSync('/opt/homebrew/bin/pdftotext',['-f',String(item.page),'-l',String(item.page),onPDF,'-'],{encoding:'utf8',timeout:15000});expect(text).toMatch(/1\s*·\s*2\s*·\s*3/);
        const stem=join(fixture,item.type+'-options');execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(item.page),'-singlefile','-r','96',onPDF,stem],{timeout:15000});
        const visible=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,pathlib,json,collections
def counts(path):
 head,size,maximum,data=pathlib.Path(path).read_bytes().split(b'\n',3);assert head==b'P6' and maximum==b'255';pixels=collections.Counter(zip(data[::3],data[1::3],data[2::3]));return {'axes':pixels[(156,175,171)],'grid':pixels[(213,229,222)]}
before=counts(sys.argv[1]);after=counts(sys.argv[2]);assert before=={'axes':0,'grid':0},before
# Grid lines are behind the data, as in the approved prototype. A treemap
# covers the plot interior; its four grid lines remain visible in the margins.
assert after['axes']>100 and after['grid']>(20 if sys.argv[3]=='treemap' else 100),after
print(json.dumps({'before':before,'after':after}))`,join(fixture,item.type+'.ppm'),stem+'.ppm',item.type],{encoding:'utf8',timeout:15000}));decorations.push({type:item.type,...visible});
        if(evidence){execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(item.page),'-singlefile','-r','96','-png',onPDF,stem],{timeout:15000});writeFileSync(join(evidence,item.type+'-options.png'),readFileSync(stem+'.png'));}
      }
      const fresh=await service.refresh('owner',file.ref),readonlyId=randomUUID(),readonly=await service.officePages.open('owner',{id:readonlyId,ref:file.ref,baseHash:fresh.revision.hash});expect(readonly.pages).toBe(6);expect(readonly.sourceHash).toBe(optionsSaved.receipt.revision!.hash);service.officePages.release('owner',readonlyId);
      const verify=randomUUID(),reopened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});for(const item of charts)expect(reopened.state.info.slides.find(row=>row.id===item.slideId)!.elements!.find(row=>row.id===item.elementId)!.chart).toMatchObject({type:item.type,values:[6,3,4],options:{axes:true,gridLines:true,legend:true}});
      const target=charts[0],pending={slideId:target.slideId,elementId:target.elementId,chartValues:true as const,text:'6,候选,'},recoveryId=randomUUID();await service.pptx.checkpoint('owner',{id,version:state.version,draftId:recoveryId,bufferVersion:100,pending});const recovered=await service.pptx.restore('owner',{id:verify,version:0,draftId:recoveryId});expect(pptxPendingInputs(recovered.pending)).toEqual([pending]);service.pptx.close('owner',verify);
      if(evidence){writeFileSync(join(evidence,'modern.pptx'),readFileSync(path));writeFileSync(join(evidence,'modern.pdf'),readFileSync(pdf));writeFileSync(join(evidence,'modern-options.pdf'),readFileSync(onPDF));}
      for(let index=0;index<mutations;index++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});
      await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual((await OfficePackage.read(original)).hashes());
      if(evidence)writeFileSync(join(evidence,'modern.json'),JSON.stringify({independent,measured,decorations,sourceHash:optionsSaved.receipt.revision!.hash,previewHash:shown.hash,readonlyPreview:true,pendingRecovered:true,undoMutations:mutations,undoAllOriginalParts:true,uiAcceptance:false},null,2)+'\n');
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },240000);
  it('synchronizes chart cache and embedded workbook through the retained Worker and native save',async()=>{
    const worker=join(build,'chart-data.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'chart.pptx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'Chart data',projectId:'chart'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'chart'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'chart.pptx'}),id=randomUUID(),draftId=randomUUID();
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});const elementId=state.info.slides[0].elements!.find(element=>element.kind==='chart')!.id;
      state=await service.pptx.edit('owner',{id,version:0,action:{type:'chart-values',slideId:'256',elementId,values:[15,6]}});
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',String.raw`import json,zipfile,io,sys,posixpath,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);o=zipfile.ZipFile(sys.argv[2]);c='{http://schemas.openxmlformats.org/drawingml/2006/chart}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';s='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
rels=lambda part:{n.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),n.attrib['Target'])) for n in E.fromstring(z.read(posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')))}
part='ppt/slides/slide1.xml';rid=E.fromstring(z.read(part)).find('.//'+c+'chart').attrib[r+'id'];chart=rels(part)[rid];root=E.fromstring(z.read(chart));values=[float(n.text) for n in root.findall('.//'+c+'val/'+c+'numRef/'+c+'numCache/'+c+'pt/'+c+'v')];embedded=rels(chart)[root.find(c+'externalData').attrib[r+'id']]
book=zipfile.ZipFile(io.BytesIO(z.read(embedded)));old=zipfile.ZipFile(io.BytesIO(o.read('ppt/embeddings/chart-data.xlsx')));sheet=E.fromstring(book.read('xl/worksheets/sheet1.xml'));cells={n.attrib['r']:n.find(s+'v').text for n in sheet.findall('.//'+s+'c') if n.find(s+'v') is not None}
assert values==[15,6] and cells['B2']=='15' and cells['B3']=='6';assert book.namelist()==old.namelist();assert all(book.read(n)==old.read(n) for n in old.namelist() if n!='xl/worksheets/sheet1.xml')
changed=[n for n in o.namelist() if z.read(n)!=o.read(n)];assert sorted(changed)==sorted(['[Content_Types].xml',part,'ppt/slides/_rels/slide1.xml.rels']);print(json.dumps({'values':values,'embeddedValues':cells,'changed':changed,'oldChartAndWorkbookPreserved':True,'otherEmbeddedPartsPreserved':True}))`,path,originalPath],{encoding:'utf8'}));
      const preview=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),pdf=join(fixture,'chart.pdf');writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,preview.id,0,preview.bytes),'base64'));expect(preview.pages).toBe(2);
      execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-singlefile','-r','72',pdf,join(fixture,'chart')],{timeout:15000});
      execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-singlefile','-r','72','-png',pdf,join(fixture,'chart')],{timeout:15000});
      const bars=JSON.parse(execFileSync('python3',['-c',String.raw`import pathlib,json,sys
head,dims,maximum,raw=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);w,h=map(int,dims.split());assert head==b'P6' and maximum==b'255';out=[]
for left,right in [(450,530),(590,670)]:
 ys=[]
 for y in range(170,min(h,335)):
  for x in range(left,min(w,right)):
   at=(y*w+x)*3;r,g,b=raw[at:at+3]
   if 60<r<100 and 110<g<150 and 170<b<210:ys.append(y);break
 out.append(max(ys)-min(ys)+1)
print(json.dumps(out))`,join(fixture,'chart.ppm')],{encoding:'utf8'}));
      expect(bars[0]/bars[1]).toBeCloseTo(15/6,1);
      const fresh=await service.refresh('owner',file.ref),verify=randomUUID(),opened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});expect(opened.state.info.slides[0].elements!.find(element=>element.id===elementId)?.chart?.values).toEqual([15,6]);
      const recoveryId=randomUUID(),pending={slideId:'256',elementId,chartValues:true as const,text:'15,候选,'};
      await service.pptx.checkpoint('owner',{id,version:state.version,draftId:recoveryId,bufferVersion:10,pending});
      const recovered=await service.pptx.restore('owner',{id:verify,version:opened.state.version,draftId:recoveryId});expect(pptxPendingInputs(recovered.pending)).toEqual([pending]);service.pptx.close('owner',verify);
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'chart-data.pptx'),readFileSync(path));writeFileSync(join(evidence,'chart-data.pdf'),readFileSync(pdf));writeFileSync(join(evidence,'chart-data.png'),readFileSync(join(fixture,'chart.png')));writeFileSync(join(evidence,'chart-data.json'),JSON.stringify({savedHash:saved.receipt.revision!.hash,pdfHash:preview.hash,independent,bars,pendingRecovered:true},null,2)+'\n');}
      state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual((await OfficePackage.read(original)).hashes());
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },180000);
  it('saves chart axes grid and legend through the retained Worker with native visibility and undo checks',async()=>{
    const worker=join(build,'chart-options.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'chart.pptx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'Chart options',projectId:'chart'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'chart'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'chart.pptx'}),id=randomUUID(),draftId=randomUUID();
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});const elementId=state.info.slides[0].elements!.find(element=>element.kind==='chart')!.id;
      const results=[];
      for(const visible of [true,false]){
        state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'chart-options',slideId:'256',elementId,patch:{axes:visible,gridLines:visible,legend:visible}}});
        const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
        const independent=JSON.parse(execFileSync('python3',['-c',String.raw`import json,zipfile,sys,posixpath,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);o=zipfile.ZipFile(sys.argv[2]);visible=sys.argv[3]=='true';p='{http://schemas.openxmlformats.org/presentationml/2006/main}';c='{http://schemas.openxmlformats.org/drawingml/2006/chart}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';rels='{http://schemas.openxmlformats.org/package/2006/relationships}';part='ppt/slides/slide1.xml'
slide=E.fromstring(z.read(part));rid=slide.find('.//'+c+'chart').attrib[r+'id'];rs=E.fromstring(z.read('ppt/slides/_rels/slide1.xml.rels'));target=next(n.attrib['Target'] for n in rs if n.attrib['Id']==rid);chartPart=posixpath.normpath(posixpath.join('ppt/slides',target));chart=E.fromstring(z.read(chartPart));axes=chart.findall('.//'+c+'catAx')+chart.findall('.//'+c+'valAx')
assert len(axes)==2
for axis in axes:
 deletion=axis.find(c+'delete');hidden=deletion is not None and deletion.attrib.get('val','1') not in ['0','false'];assert hidden!=visible
assert bool(chart.findall('.//'+c+'majorGridlines'))==visible;assert bool(chart.findall('.//'+c+'legend'))==visible
old=E.fromstring(o.read('ppt/charts/chart1.xml'));assert E.tostring(chart.find('.//'+c+'ser'))==E.tostring(old.find('.//'+c+'ser'));assert z.read('ppt/embeddings/chart-data.xlsx')==o.read('ppt/embeddings/chart-data.xlsx')
changed=[n for n in o.namelist() if z.read(n)!=o.read(n)];assert sorted(changed)==sorted(['[Content_Types].xml',part,'ppt/slides/_rels/slide1.xml.rels']);print(json.dumps({'visible':visible,'seriesAndWorkbookPreserved':True,'changed':changed}))`,path,originalPath,String(visible)],{encoding:'utf8'}));
        const preview=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),base=join(fixture,visible?'chart-on':'chart-off'),pdf=base+'.pdf';writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,preview.id,0,preview.bytes),'base64'));
        execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-singlefile','-r','72','-png',pdf,base],{timeout:15000});
        execFileSync('/opt/homebrew/bin/pdftotext',['-f','1','-l','1','-bbox',pdf,base+'.xml'],{timeout:15000});
        const chartText=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,json,xml.etree.ElementTree as E
root=E.parse(sys.argv[1]).getroot();print(json.dumps([n.text for n in root.iter() if n.tag.endswith('word') and float(n.attrib['xMin'])>400]))`,base+'.xml'],{encoding:'utf8'}));
        if(visible){expect(chartText).toContain('Value');expect(chartText).toContain('A');expect(chartText).toContain('B');}else expect(chartText).toEqual([]);
        const fresh=await service.refresh('owner',file.ref),verify=randomUUID(),opened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});expect(opened.state.info.slides[0].elements!.find(element=>element.id===elementId)?.chart?.options).toEqual({hasAxes:true,axes:visible,gridLines:visible,legend:visible});service.pptx.close('owner',verify);
        results.push({visible,savedHash:saved.receipt.revision!.hash,pdfHash:preview.hash,independent,chartText});
        const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});for(const suffix of ['.pdf','.png','.xml'])writeFileSync(join(evidence,(visible?'chart-on':'chart-off')+suffix),readFileSync(base+suffix));writeFileSync(join(evidence,(visible?'chart-on':'chart-off')+'.pptx'),readFileSync(path));}
      }
      for(let i=0;i<2;i++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});
      await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual((await OfficePackage.read(original)).hashes());
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence)writeFileSync(join(evidence,'chart-options.json'),JSON.stringify({results,undoRestoredAllOriginalParts:true},null,2)+'\n');
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },180000);
  it('inserts and converts five editable basic charts through the native save and rendering boundary',async()=>{
    const worker=join(build,'chart-basic.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'chart.pptx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'Basic charts',projectId:'chart'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'chart'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'chart.pptx'}),id=randomUUID(),draftId=randomUUID();
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash}),mutations=0;
      const edit=async(action:PptxAction)=>{const before=state.version;state=await service.pptx.edit('owner',{id,version:before,action});if(state.version!==before)mutations++;};
      await edit({type:'add',slideId:state.info.slides.at(-1)!.id});let slideId=state.info.slides.at(-1)!.id;
      await edit({type:'chart-insert',slideId,chartType:'bar'});const elementId=state.info.slides.at(-1)!.elements!.at(-1)!.id;
      await edit({type:'element-transform',slideId,elementId,patch:{x:100,y:120,width:430,height:230}});const newSlides=[slideId];
      for(const chartType of ['line','pie','area','scatter'] as const){await edit({type:'duplicate',slideId});slideId=state.info.slides.at(-1)!.id;newSlides.push(slideId);await edit({type:'chart-type',slideId,elementId,chartType});}
      await edit({type:'chart-values',slideId,elementId,values:[6,2,4]});
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',String.raw`import json,zipfile,io,sys,posixpath,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);o=zipfile.ZipFile(sys.argv[2]);slideIds=json.loads(sys.argv[3]);p='{http://schemas.openxmlformats.org/presentationml/2006/main}';c='{http://schemas.openxmlformats.org/drawingml/2006/chart}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';s='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
def rels(part):
 name=posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels');return {n.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),n.attrib['Target'])) for n in E.fromstring(z.read(name)) if n.attrib.get('TargetMode')!='External'}
main='ppt/presentation.xml';entries={n.attrib['id']:rels(main)[n.attrib[r+'id']] for n in E.fromstring(z.read(main)).findall('.//'+p+'sldId')};types=['bar','line','pie','area','scatter'];results=[]
for i,slideId in enumerate(slideIds):
 part=entries[slideId];refs=E.fromstring(z.read(part)).findall('.//'+c+'chart');assert len(refs)==1;chartPart=rels(part)[refs[0].attrib[r+'id']];root=E.fromstring(z.read(chartPart));plot=root.find('.//'+c+'plotArea');kind=next(n.tag[len(c):-5] for n in plot if n.tag.startswith(c) and n.tag.endswith('Chart'));assert kind==types[i]
 series=plot.find(c+kind+'Chart/'+c+'ser');values=[float(n.text) for n in series.findall(c+('yVal' if kind=='scatter' else 'val')+'/'+c+'numRef/'+c+'numCache/'+c+'pt/'+c+'v')];expected=[6,2,4] if kind=='scatter' else [3,5,2];assert values==expected;assert len(root.findall('.//'+c+'ser'))==(2 if kind=='area' else 1)
 if kind=='area':
  helper=plot.find(c+'lineChart/'+c+'ser');assert [float(n.text) for n in helper.findall(c+'val/'+c+'numRef/'+c+'numCache/'+c+'pt/'+c+'v')]==expected;assert helper.find(c+'val/'+c+'numRef/'+c+'f').text==series.find(c+'val/'+c+'numRef/'+c+'f').text;assert len(helper.findall(c+'dPt'))==3
 bookPart=rels(chartPart)[root.find(c+'externalData').attrib[r+'id']];book=zipfile.ZipFile(io.BytesIO(z.read(bookPart)));sheet=E.fromstring(book.read('xl/worksheets/sheet1.xml'));cells={n.attrib['r']:float(n.find(s+'v').text) for n in sheet.findall('.//'+s+'c') if n.find(s+'v') is not None};assert [cells['B'+str(n)] for n in [2,3,4]]==expected;assert [cells['A'+str(n)] for n in [2,3,4]]==[1,2,3]
 results.append({'type':kind,'values':values,'chart':chartPart,'workbook':bookPart})
changed=[n for n in o.namelist() if z.read(n)!=o.read(n)];assert sorted(changed)==sorted(['[Content_Types].xml',main,'ppt/_rels/presentation.xml.rels']);print(json.dumps({'charts':results,'changed':changed,'originalPartsPreserved':True}))`,path,originalPath,JSON.stringify(newSlides)],{encoding:'utf8'}));
      const preview=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),pdf=join(fixture,'basic-charts.pdf');writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,preview.id,0,preview.bytes),'base64'));expect(preview.pages).toBe(7);
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'basic-charts.pdf'),readFileSync(pdf));writeFileSync(join(evidence,'basic-charts.pptx'),readFileSync(path));}
      const visualChecks=[];
      for(let page=3;page<=7;page++){
        const base=join(fixture,`basic-chart-${page-2}`);execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(page),'-singlefile','-r','72',pdf,base],{timeout:15000});execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(page),'-singlefile','-r','72','-png',pdf,base],{timeout:15000});
        const check=JSON.parse(execFileSync('python3',['-c',String.raw`import pathlib,sys,json
head,dims,maximum,raw=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);w,h=map(int,dims.split());assert head==b'P6' and maximum==b'255';cols={}
for y in range(120,min(h,350)):
 for x in range(100,min(w,530)):
  at=(y*w+x)*3;r,g,b=raw[at:at+3]
  if b>r+25 and b>g+10 and g>r+10:cols.setdefault(x,[]).append(y)
result={'colored':sum(map(len,cols.values()))}
if sys.argv[2]=='7':
 between=sum(len(ys) for x,ys in cols.items() if 200<=x<=290 or 340<=x<=420);result['pixelsBetweenScatterMarkers']=between;assert between==0,'Scatter chart has connecting lines'
if sys.argv[2]=='4':
 left=min(cols);peak=min(cols,key=lambda x:min(cols[x]));middle=round((left+peak)/2);expected=(sum(cols[left])/len(cols[left])+min(cols[peak]))/2;observed=sum(cols[middle])/len(cols[middle]);result['lineMidpointDeviation']=abs(observed-expected);assert abs(observed-expected)<3,'Line chart is unexpectedly smoothed'
print(json.dumps(result))`,base+'.ppm',String(page)],{encoding:'utf8'}));expect(check.colored).toBeGreaterThan(10);visualChecks.push(check);if(evidence)writeFileSync(join(evidence,`basic-chart-${page-2}.png`),readFileSync(base+'.png'));
      }
      const fresh=await service.refresh('owner',file.ref),verify=randomUUID(),opened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});expect(opened.state.info.slides.slice(2).map(slide=>slide.elements!.find(element=>element.kind==='chart')!.chart?.type)).toEqual(['bar','line','pie','area','scatter']);service.pptx.close('owner',verify);
      for(let i=0;i<mutations;i++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});
      await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual((await OfficePackage.read(original)).hashes());
      if(evidence)writeFileSync(join(evidence,'basic-charts.json'),JSON.stringify({savedHash:saved.receipt.revision!.hash,pdfHash:preview.hash,independent,visualChecks,undoSteps:mutations,undoRestoredAllOriginalParts:true},null,2)+'\n');
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },240000);
  it('embeds and replaces original images through native decoding, preserving a cross-slide shared source',async()=>{
    const worker=join(build,'pptx-images.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'images.pptx');writeFileSync(path,original);
    const resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX images',projectId:'images'}]};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'images'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'images.pptx'}),id=randomUUID(),draftId=randomUUID(),red=pptxTestImage(),blue=pptxTestImage(1);
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const truncated=red.bytes.subarray(0,red.bytes.length-24);
      await expect(service.pptx.edit('owner',{id,version:0,action:{type:'image-insert',slideId:'256',image:{mime:'image/png',base64:truncated.toString('base64')}}})).rejects.toThrow();
      state=await service.pptx.edit('owner',{id,version:0,action:{type:'image-insert',slideId:'256',image:red.image}});const picture=state.info.slides[0].elements!.at(-1)!.id;
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'element-transform',slideId:'256',elementId:picture,patch:{x:500,y:300,width:120,height:80}}});
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'duplicate',slideId:'256'}});const copy=state.info.slides[1].id;
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'image-replace',slideId:'256',elementId:picture,image:blue.image}});
      const jpegPath=join(fixture,'native.jpg'),pngPath=join(fixture,'native.png');writeFileSync(pngPath,pptxTestImage(2).bytes);execFileSync('/usr/bin/sips',['-s','format','jpeg',pngPath,'--out',jpegPath]);const jpeg=readFileSync(jpegPath);
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'image-insert',slideId:'257',image:{mime:'image/jpeg',base64:jpeg.toString('base64')}}});const jpegId=state.info.slides[2].elements!.at(-1)!.id;
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'element-transform',slideId:'257',elementId:jpegId,patch:{x:500,y:300,width:120,height:80}}});
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',String.raw`import json,zipfile,hashlib,sys,posixpath,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]); o=zipfile.ZipFile(sys.argv[2]); p='http://schemas.openxmlformats.org/presentationml/2006/main'; a='http://schemas.openxmlformats.org/drawingml/2006/main'; r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'; n='http://schemas.openxmlformats.org/package/2006/relationships'
rels=lambda name: {x.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(name),x.attrib['Target'])) for x in E.fromstring(z.read(posixpath.join(posixpath.dirname(name),'_rels',posixpath.basename(name)+'.rels')))}
main=E.fromstring(z.read('ppt/presentation.xml')); order=[rels('ppt/presentation.xml')[x.attrib['{'+r+'}id']] for x in main.findall('.//{'+p+'}sldId')]; images=[]
for name in order:
 pic=E.fromstring(z.read(name)).findall('.//{'+p+'}pic')[-1]; rid=pic.find('.//{'+a+'}blip').attrib['{'+r+'}embed']; media=rels(name)[rid]; images.append({'part':media,'hash':hashlib.sha256(z.read(media)).hexdigest(),'transform':E.tostring(pic.find('{'+p+'}spPr')).decode()})
changed=[name for name in o.namelist() if z.read(name)!=o.read(name)]
print(json.dumps({'images':images,'changed':changed,'originalMediaUnchanged':all(z.read(name)==o.read(name) for name in o.namelist() if '/media/' in name)}))`,path,originalPath],{encoding:'utf8'}));
      expect(independent.images.map((item:{hash:string})=>item.hash)).toEqual([blue.receipt.hash,red.receipt.hash,checksum(jpeg)]);expect(independent.images[0].transform).toBe(independent.images[1].transform);expect(independent.originalMediaUnchanged).toBe(true);
      expect(independent.changed.sort()).toEqual(['[Content_Types].xml','ppt/_rels/presentation.xml.rels','ppt/presentation.xml','ppt/slides/_rels/slide1.xml.rels','ppt/slides/_rels/slide2.xml.rels','ppt/slides/slide1.xml','ppt/slides/slide2.xml'].sort());
      const preview=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()});expect(preview.pages).toBe(3);const pdf=join(fixture,'images.pdf');writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,preview.id,0,preview.bytes),'base64'));
      execFileSync('/opt/homebrew/bin/pdftoppm',['-r','72',pdf,join(fixture,'image-page')],{timeout:15000});
      execFileSync('/opt/homebrew/bin/pdftoppm',['-r','72','-png',pdf,join(fixture,'image-page')],{timeout:15000});
      const pixels=JSON.parse(execFileSync('python3',['-c',String.raw`import json,sys,pathlib
out=[]
for i in range(1,4):
 header,dims,maximum,raw=(pathlib.Path(sys.argv[1])/('image-page-'+str(i)+'.ppm')).read_bytes().split(b'\n',3)
 assert header==b'P6' and maximum==b'255'; w,h=map(int,dims.split()); at=(340*w+550)*3; out.append(list(raw[at:at+3]))
print(json.dumps(out))`,fixture],{encoding:'utf8'}));
      expect(pixels[0][2]).toBeGreaterThan(200);expect(pixels[0][0]).toBeLessThan(50);expect(pixels[1][0]).toBeGreaterThan(200);expect(pixels[1][2]).toBeLessThan(50);expect(pixels[2][1]).toBeGreaterThan(190);
      const fresh=await service.refresh('owner',file.ref),verify=randomUUID(),opened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});expect(opened.state.info.slides.map(slide=>slide.id)).toEqual(['256',copy,'257']);expect(opened.state.info.slides.every(slide=>slide.elements!.some(element=>element.kind==='image'))).toBe(true);service.pptx.close('owner',verify);
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'pptx-images.pptx'),readFileSync(path));writeFileSync(join(evidence,'pptx-images.pdf'),readFileSync(pdf));writeFileSync(join(evidence,'pptx-images.json'),JSON.stringify({savedHash:saved.receipt.revision!.hash,pdfHash:preview.hash,independent,pixels},null,2));for(let i=1;i<=3;i++)writeFileSync(join(evidence,`pptx-image-page-${i}.png`),readFileSync(join(fixture,`image-page-${i}.png`)));}
      for(let i=0;i<6;i++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual((await OfficePackage.read(original)).hashes());
      console.log(JSON.stringify({case:'native-pptx-images',savedHash:saved.receipt.revision!.hash,pdfHash:preview.hash,pixels,originalParts:(await OfficePackage.read(original)).names().length}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },180000);
  it('renders real DOCX and PPTX copies to bounded PDFs and cleans their private profiles',async()=>{
    for(const [format,bytes,pages] of [
      ['docx',await docxFixture(),1],
      ['pptx',readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')),2],
    ] as const){
      const original=checksum(bytes),packageData=await OfficePackage.read(bytes);expect(new OfficeRelationships(packageData).kind).toBe(format);
      for(const name of packageData.names().filter(name=>name.endsWith('.xml')))new OfficeXml(packageData.read(name));
      const result=await engine.render(bytes,format,new AbortController().signal);
      expect(Buffer.from(result.bytes).subarray(0,5).toString()).toBe('%PDF-');expect(result.pages).toBe(pages);expect(result.peakRssBytes).toBeGreaterThan(0);expect(result.elapsedMs).toBeLessThan(20000);
      expect(checksum(bytes)).toBe(original);expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
      console.log(JSON.stringify({format,hash:result.hash,bytes:result.bytes.length,pages:result.pages,elapsedMs:result.elapsedMs,peakRssBytes:result.peakRssBytes,diagnostic:result.diagnostic}));
    }
  },60000);
  it('rejects stale resources before engine execution and releases the job',async()=>{
    const input=await request(await docxFixture(),'docx');input.files=input.files.map(file=>file.path.endsWith('/soffice')?{...file,hash:'0'.repeat(64)}:file);
    try {await expect(broker.request(input,{timeoutMs:15000})).rejects.toThrow('CHANGED');}finally{await workspaces.clean(input.job);}
    expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
  },20000);
  it('renders hidden slides in source order without inserting speaker-note pages',async()=>{
    const file=await OfficePackage.read(readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')));
    const part='ppt/slides/slide1.xml',xml=new OfficeXml(file.read(part));
    const candidate=file.patch(new Map([[part,xml.edit([xml.setAttribute(xml.root,'show','0')])]]),{changed:[part],added:[],removed:[]});
    const result=await engine.render(await candidate.bytes(),'pptx',new AbortController().signal);
    expect(result.pages).toBe(2);expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
  },60000);
  it('opens real local files through FileService, isolated Worker and native layout with scoped PDF chunks',async()=>{
    const worker=join(build,'pages.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pages-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);
    const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'Pages',projectId:'pages'}],resolver={sources:()=>sources};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},worker);
    try {
      const root=(await service.openScope('owner',{kind:'project',projectId:'pages'})).roots[0];
      for(const [name,bytes,count] of [['source.docx',await docxFixture(),1],['source.pptx',readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')),2]] as const){
        const path=join(project,name);writeFileSync(path,bytes);const file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:name}),id=randomUUID();
        const result=await service.officePages.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});expect(result.pages).toBe(count);
        const pdf=Buffer.from(service.officePages.chunk('owner',id,0,result.bytes),'base64');expect(checksum(pdf)).toBe(result.hash);
        expect(()=>service.officePages.chunk('other',id,0,5)).toThrow('不属于');expect(checksum(readFileSync(path))).toBe(checksum(bytes));
        service.officePages.release('owner',id);expect(service.officePages.activeDocuments).toBe(0);expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
      }
    } finally {service.closeOwner('owner');service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },60000);
  it('edits PPTX through retained Worker and real native save, independently reads the result, then resolves an external conflict',async()=>{
    const worker=join(build,'pptx.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);
    const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX',projectId:'pptx'}],resolver={sources:()=>sources};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    const original=readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')),path=join(project,'source.pptx');writeFileSync(path,original);
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'pptx'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'source.pptx'}),id=randomUUID(),draftId=randomUUID();
      await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      await service.pptx.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'原备注修改😀\n第二行'}});
      await service.pptx.edit('owner',{id,version:1,action:{type:'notes',slideId:'257',text:'新建备注'}});
      await service.pptx.edit('owner',{id,version:2,action:{type:'background',slideId:'256',color:'#2468ab'}});
      await service.pptx.edit('owner',{id,version:3,action:{type:'hidden',slideId:'256',hidden:true}});
      expect(checksum(readFileSync(path))).toBe(checksum(original));
      const rendered=await service.pptx.render('owner',{id,version:4,requestId:randomUUID()});expect(rendered.pages).toBe(2);
      const saved=await service.pptx.save('owner',{id,version:4,draftId,bufferVersion:4,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');expect(saved.state.dirty).toBe(false);
      expect(checksum(readFileSync(path))).toBe(saved.receipt.revision!.hash);
      // An independent standard-library ZIP/XML reader checks actual on-disk
      // parts, without importing any of the production Office model code.
      const inspect=JSON.parse(execFileSync('python3',['-c',[
        'import json,sys,posixpath',
        'from zipfile import ZipFile',
        'from xml.etree import ElementTree as E',
        'A="{http://schemas.openxmlformats.org/drawingml/2006/main}"',
        'P="{http://schemas.openxmlformats.org/presentationml/2006/main}"',
        'with ZipFile(sys.argv[1]) as z:',
        ' slides=[]',
        ' for i in (1,2):',
        '  root=E.fromstring(z.read("ppt/slides/slide%d.xml"%i))',
        '  rels=E.fromstring(z.read("ppt/slides/_rels/slide%d.xml.rels"%i))',
        '  rel=next(r for r in rels if r.get("Type").endswith("/notesSlide"))',
        '  note=E.fromstring(z.read(posixpath.normpath(posixpath.join("ppt/slides",rel.get("Target")))))',
        '  shape=next(s for s in note.iter(P+"sp") if any(ph.get("type")=="body" for ph in s.iter(P+"ph")))',
        '  text="\\n".join("".join(t.text or "" for t in p.iter(A+"t")) for p in shape.iter(A+"p"))',
        '  color=root.find("./"+P+"cSld/"+P+"bg/"+P+"bgPr/"+A+"solidFill/"+A+"srgbClr")',
        '  slides.append({"notes":text,"show":root.get("show","1"),"color":color.get("val") if color is not None else None})',
        ' print(json.dumps(slides,ensure_ascii=False))',
      ].join('\n'),path],{encoding:'utf8',timeout:15000}));
      expect(inspect).toEqual([{notes:'原备注修改😀\n第二行',show:'0',color:'2468AB'},{notes:'新建备注',show:'1',color:null}]);
      const undone=await service.pptx.history('owner',{id,version:4,direction:'undo'});expect(undone.info.slides[0].hidden).toBe(false);
      await service.pptx.edit('owner',{id,version:5,action:{type:'notes',slideId:'256',text:'冲突本地保留'}});
      writeFileSync(path,original);
      const conflict=await service.pptx.save('owner',{id,version:6,draftId,bufferVersion:6,opId:randomUUID()});expect(conflict.receipt.state).toBe('conflict');expect(conflict.state.dirty).toBe(true);expect(readFileSync(path).equals(original)).toBe(true);
      await service.pptx.rebase('owner',{id,version:6});const kept=await service.pptx.save('owner',{id,version:6,draftId,bufferVersion:7,opId:randomUUID()});expect(kept.receipt.state).toBe('saved');
      service.pptx.close('owner',id);const fresh=await service.refresh('owner',file.ref),reopened=await service.pptx.open('owner',{id:randomUUID(),ref:file.ref,baseHash:fresh.revision.hash});
      expect(reopened.state.info.slides[0].notes).toBe('冲突本地保留');expect(reopened.state.info.slides[1].notes).toBe('新建备注');expect(reopened.state.info.slides[0].hidden).toBe(false);expect(reopened.state.info.slides[0].background).toBe('#2468ab');
      expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
      console.log(JSON.stringify({independentZipXmlRead:true,pages:rendered.pages,savedHash:saved.receipt.revision!.hash,conflict:conflict.receipt.state,reopenedHash:fresh.revision.hash,notesReopened:reopened.state.info.slides.map(s=>s.notes)}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },90000);
  it('saves slide structure edits through the real Worker and broker, renders independent clones, and reopens the restored original parts',async()=>{
    const worker=join(build,'pptx-structure.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);
    const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX structure',projectId:'structure'}],resolver={sources:()=>sources};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'structure.pptx');writeFileSync(path,original);
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'structure'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'structure.pptx'}),id=randomUUID(),draftId=randomUUID();
      await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const duplicate=await service.pptx.edit('owner',{id,version:0,action:{type:'duplicate',slideId:'256'}}),clone=duplicate.info.slides[1].id;
      await service.pptx.edit('owner',{id,version:1,action:{type:'notes',slideId:clone,text:'独立副本备注😀'}});
      const added=await service.pptx.edit('owner',{id,version:2,action:{type:'add',slideId:'256'}}),newId=added.info.slides.at(-1)!.id;
      expect(added.info.slides.map(slide=>slide.id)).toEqual(['256',clone,'257',newId]);expect(checksum(readFileSync(path))).toBe(checksum(original));
      const requestId=randomUUID(),rendered=await service.pptx.render('owner',{id,version:3,requestId});expect(rendered.pages).toBe(4);
      const pdf=join(fixture,'slides.pdf');writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,requestId,0,rendered.bytes),'base64'));
      // Poppler independently checks rendered pixels: a duplicated slide must
      // retain the actual table/chart/text layout, not just OOXML metadata.
      for(const page of [1,2])execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','800','-png',pdf,join(fixture,`page-${page}`)],{timeout:15000});
      const firstPng=checksum(readFileSync(join(fixture,'page-1.png'))),clonePng=checksum(readFileSync(join(fixture,'page-2.png')));expect(clonePng).toBe(firstPng);
      const pageText=execFileSync('/opt/homebrew/bin/pdftotext',['-layout',pdf,'-'],{encoding:'utf8',timeout:15000}).split('\f');
      expect(pageText[0]).toContain('MASTER_TITLE');expect(pageText[1]).toContain('MASTER_TITLE');expect(pageText[2]).toContain('OTHER_SLIDE');expect(pageText[3]).not.toContain('MASTER_TITLE');
      const saved=await service.pptx.save('owner',{id,version:3,draftId,bufferVersion:3,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const inspect=JSON.parse(execFileSync('python3',['-c',[
        'import sys,json,posixpath,hashlib',
        'from zipfile import ZipFile',
        'from xml.etree import ElementTree as E',
        'P="{http://schemas.openxmlformats.org/presentationml/2006/main}"',
        'A="{http://schemas.openxmlformats.org/drawingml/2006/main}"',
        'R="{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"',
        'def relations(z,part):',
        ' name=posixpath.join(posixpath.dirname(part),"_rels",posixpath.basename(part)+".rels")',
        ' return {r.get("Id"):(r.get("Type").split("/")[-1],posixpath.normpath(posixpath.join(posixpath.dirname(part),r.get("Target")))) for r in E.fromstring(z.read(name)) if r.get("TargetMode")!="External"}',
        'with ZipFile(sys.argv[1]) as z:',
        ' rels=relations(z,"ppt/presentation.xml"); slides=[]',
        ' for row in E.fromstring(z.read("ppt/presentation.xml")).find(P+"sldIdLst"):',
        '  part=rels[row.get(R+"id")][1]; links=relations(z,part); note=next((v[1] for v in links.values() if v[0]=="notesSlide"),None); chart=next((v[1] for v in links.values() if v[0]=="chart"),None)',
        '  body=E.fromstring(z.read(note)) if note else None',
        '  slides.append({"id":row.get("id"),"part":part,"layout":next(v[1] for v in links.values() if v[0]=="slideLayout"),"note":note,"notes":"".join(t.text or "" for t in body.iter(A+"t")) if body is not None else "","back":next(v[1] for v in relations(z,note).values() if v[0]=="slide") if note else None,"chart":chart,"workbook":next(v[1] for v in relations(z,chart).values() if v[0]=="package") if chart else None})',
        ' print(json.dumps(slides,ensure_ascii=False))',
      ].join('\n'),path],{encoding:'utf8',timeout:15000}));
      expect(inspect).toHaveLength(4);expect(inspect[0].note).not.toBe(inspect[1].note);expect(inspect[1].back).toBe(inspect[1].part);expect(inspect[1].notes).toContain('独立副本备注😀');expect(inspect[0].notes).toContain('SLIDE_ONE_NOTES');
      expect(inspect[1].chart).not.toBe(inspect[0].chart);expect(inspect[1].workbook).not.toBe(inspect[0].workbook);expect(inspect[3].layout).toBe(inspect[0].layout);
      await service.pptx.edit('owner',{id,version:3,action:{type:'delete',slideId:clone}});await service.pptx.edit('owner',{id,version:4,action:{type:'delete',slideId:newId}});
      expect((await service.pptx.history('owner',{id,version:5,direction:'undo'})).info.slides).toHaveLength(3);expect((await service.pptx.history('owner',{id,version:6,direction:'redo'})).info.slides).toHaveLength(2);
      const final=await service.pptx.save('owner',{id,version:7,draftId,bufferVersion:7,opId:randomUUID()});expect(final.receipt.state).toBe('saved');
      const equal=execFileSync('python3',['-c','import sys,hashlib; from zipfile import ZipFile; a,b=(ZipFile(p) for p in sys.argv[1:]); h=lambda z:{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}; assert h(a)==h(b); print(len(h(a)))',originalPath,path],{encoding:'utf8',timeout:15000}).trim();
      service.pptx.close('owner',id);const fresh=await service.refresh('owner',file.ref),reopened=await service.pptx.open('owner',{id:randomUUID(),ref:file.ref,baseHash:fresh.revision.hash});
      expect(reopened.state.info.slides.map(slide=>slide.id)).toEqual(['256','257']);expect(reopened.state.info.slides[0].notes).toBe('SLIDE_ONE_NOTES');expect(reopened.state.dirty).toBe(false);
      console.log(JSON.stringify({pages:rendered.pages,pdfHash:rendered.hash,originalAndClonePixelHash:firstPng,independentZipXmlRead:true,restoredPartCount:Number(equal),structureSavedHash:saved.receipt.revision!.hash,restoredSavedHash:fresh.revision.hash}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },90000);
  it('renders and saves real inserted text and all preset shapes, then undoes their exact source parts',async()=>{
    const worker=join(build,'pptx-objects.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);
    const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX objects',projectId:'objects'}],resolver={sources:()=>sources};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'objects.pptx');writeFileSync(path,original);
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'objects'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'objects.pptx'}),id=randomUUID(),draftId=randomUUID();
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const edit=async(action:PptxAction)=>{state=await service.pptx.edit('owner',{id,version:state.version,action});return state;};
      await edit({type:'insert-element',slideId:'256',kind:'text'});const textId=state.info.slides[0].elements!.at(-1)!.id;
      await edit({type:'element-text',slideId:'256',elementId:textId,text:'NATIVE_OBJECT 中文😀'});
      await edit({type:'element-transform',slideId:'256',elementId:textId,patch:{x:25,y:25,width:350,height:55,rotation:7.5}});
      await edit({type:'element-layer',slideId:'256',elementId:textId,direction:'back'});await edit({type:'element-layer',slideId:'256',elementId:textId,direction:'front'});
      const shapeIds:string[]=[];
      for(const [index,shape] of PPTX_SHAPES.entries()){
        await edit({type:'insert-element',slideId:'256',kind:'shape',shape});const elementId=state.info.slides[0].elements!.at(-1)!.id;shapeIds.push(elementId);
        await edit({type:'element-transform',slideId:'256',elementId,patch:{x:10+(index%6)*110,y:130+Math.floor(index/6)*100,width:80,...(shape==='line'?{}:{height:60})}});
      }
      const requestId=randomUUID(),rendered=await service.pptx.render('owner',{id,version:state.version,requestId});expect(rendered.pages).toBe(2);
      const pdf=join(fixture,'objects.pdf');writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,requestId,0,rendered.bytes),'base64'));
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;
      if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'pptx-objects.pdf'),readFileSync(pdf));execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-l','1','-singlefile','-scale-to','1200','-png',pdf,join(evidence,'pptx-objects-page1')],{timeout:15000});}
      // Layout-order extraction interleaves overlapping rotated text with the
      // original title. Content-stream order checks characters independently;
      // actual appearance remains a separate raster/App acceptance boundary.
      const extracted=execFileSync('/opt/homebrew/bin/pdftotext',['-raw',pdf,'-'],{encoding:'utf8',timeout:15000}).replace(/\s/g,'');expect(extracted).toContain('NATIVE_OBJECT');expect(extracted).toContain('中文');expect(extracted).toContain('OTHER_SLIDE');
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');state=saved.state;
      const independent=JSON.parse(execFileSync('python3',['-c',[
        'import json,sys,hashlib',
        'from zipfile import ZipFile',
        'from xml.etree import ElementTree as E',
        'P="{http://schemas.openxmlformats.org/presentationml/2006/main}"; A="{http://schemas.openxmlformats.org/drawingml/2006/main}"',
        'with ZipFile(sys.argv[1]) as z, ZipFile(sys.argv[2]) as original:',
        ' name="ppt/slides/slide1.xml"; root=E.fromstring(z.read(name)); shapes=[]',
        ' assert set(z.namelist())==set(original.namelist())',
        ' assert all(z.read(n)==original.read(n) for n in z.namelist() if n!=name)',
        ' ids=[n.get("id") for n in root.iter(P+"cNvPr")]; assert len(ids)==len(set(ids))',
        ' for shape in root.iter(P+"sp"):',
        '  props=shape.find(P+"nvSpPr/"+P+"cNvPr"); geom=shape.find(P+"spPr/"+A+"prstGeom"); transform=shape.find(P+"spPr/"+A+"xfrm")',
        '  shapes.append({"id":props.get("id"),"text":"".join(n.text or "" for n in shape.iter(A+"t")),"preset":geom.get("prst") if geom is not None else None,"rotation":transform.get("rot","0") if transform is not None else None})',
        ' print(json.dumps(shapes,ensure_ascii=False))',
      ].join('\n'),path,originalPath],{encoding:'utf8',timeout:15000})) as Array<{id:string;text:string;preset:string;rotation:string}>;
      expect(independent.find(shape=>shape.id===textId)).toMatchObject({text:'NATIVE_OBJECT 中文😀',preset:'rect',rotation:'450000'});
      for(const [index,shape] of PPTX_SHAPES.entries())expect(independent.find(row=>row.id===shapeIds[index])?.preset).toBe(PPTX_PRESETS[shape]);
      const committedVersion=state.version;while(state.canUndo)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});
      const restored=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(restored.receipt.state).toBe('saved');
      execFileSync('python3',['-c','import sys; from zipfile import ZipFile; a,b=(ZipFile(p) for p in sys.argv[1:]); assert set(a.namelist())==set(b.namelist()); assert all(a.read(n)==b.read(n) for n in a.namelist())',originalPath,path],{timeout:15000});
      console.log(JSON.stringify({insertedShapes:shapeIds.length,text:'NATIVE_OBJECT 中文😀',committedVersion,pdfHash:rendered.hash,pages:rendered.pages,savedHash:saved.receipt.revision!.hash,restoredHash:restored.receipt.revision!.hash,independentZipXmlRead:true,originalPartsRestored:true}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },90000);
  it('materializes inherited placeholder geometry without changing native pixels or shared layout/master parts',async()=>{
    const original=await OfficePackage.read(readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'))),model=new OfficePagesModel(original),title=model.info.slides[0].elements!.find(item=>item.text==='MASTER_TITLE')!;
    expect(title.boxSource).toBe('master');const x=title.box!.x;
    const moved=editPptx(original,{type:'element-transform',slideId:'256',elementId:title.id,patch:{x:x+1}}).packageData;
    const materialized=editPptx(moved,{type:'element-transform',slideId:'256',elementId:title.id,patch:{x}}).packageData;
    expect(new OfficePagesModel(materialized).info.slides[0].elements!.find(item=>item.id===title.id)).toMatchObject({boxSource:'local',box:title.box});
    const hashes=original.hashes();for(const name of original.names())if(name!=='ppt/slides/slide1.xml')expect(materialized.hashes()[name],name).toBe(hashes[name]);
    const images:string[]=[],projections:Array<{name:string;hash:string}>=[];
    for(const [name,file] of [['original',original],['materialized',materialized]] as const){
      const result=await engine.render(await file.bytes(),'pptx',new AbortController().signal),pdf=join(fixture,`${name}.pdf`),png=join(fixture,name);writeFileSync(pdf,result.bytes);expect(result.pages).toBe(2);
      execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-l','1','-singlefile','-scale-to','1000','-png',pdf,png],{timeout:15000});
      const pixels=readFileSync(`${png}.png`);images.push(checksum(pixels));projections.push({name,hash:result.hash});
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,`pptx-inherited-${name}.png`),pixels);}
    }
    expect(images[1]).toBe(images[0]);
    console.log(JSON.stringify({source:'master',target:'local',sharedPartsUnchanged:true,pixelHash:images[0],pdfs:projections,sourceBox:title.box}));
  },90000);
  it('compares nested group hit geometry with independently rasterized native colored shapes',async()=>{
    const original=await OfficePackage.read(readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')));
    const part='ppt/slides/slide1.xml',doc=new OfficeXml(original.read(part)),tree=pptxShapeTree(doc),ns=doc.root.uri,drawing=drawingNamespace(ns);
    const emu=(value:number)=>Math.round(value*EMU_PER_POINT);
    const transform=(x:number,y:number,w:number,h:number,rotation:number,flip:string,child?:number[])=>`<a:xfrm rot="${rotation*60000}" ${flip}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/>${child?`<a:chOff x="${emu(child[0])}" y="${emu(child[1])}"/><a:chExt cx="${emu(child[2])}" cy="${emu(child[3])}"/>`:''}</a:xfrm>`;
    const shape=`<p:sp><p:nvSpPr><p:cNvPr id="503" name="Native geometry target"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(30,40,40,20,25,'')}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="12AB34"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
    const group=(id:number,xfrm:string,content:string)=>`<p:grpSp xmlns:p="${ns}" xmlns:a="${drawing}"><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm}</p:grpSpPr>${content}</p:grpSp>`;
    const groups=group(501,transform(150,40,400,300,20,'flipH="1"',[0,0,400,300]),group(502,transform(60,90,200,100,15,'flipV="1"',[20,30,100,100]),shape));
    const edits=pptxDrawingNodes(tree).filter(row=>row.parent===tree).map(({node})=>({start:node.start,end:node.end,value:''}));edits.push({start:tree.closeStart,end:tree.closeStart,value:groups});
    const file=original.patch(new Map([[part,doc.edit(edits)]]),{changed:[part],added:[],removed:[]}),box=new OfficePagesModel(file).info.slides[0].elements!.find(element=>element.id==='503')!.pageBox!;
    expect(box).toBeTruthy();const result=await engine.render(await file.bytes(),'pptx',new AbortController().signal),pdf=join(fixture,'group-geometry.pdf'),output=join(fixture,'group-geometry');writeFileSync(pdf,result.bytes);
    execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-l','1','-singlefile','-r','96',pdf,output],{timeout:15000});
    const ppm=readFileSync(`${output}.ppm`),header=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0,100).toString('ascii'))!;expect(header).toBeTruthy();const width=Number(header[1]),height=Number(header[2]),offset=header[0].length;
    let left=width,top=height,right=0,bottom=0,count=0,sumX=0,sumY=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=offset+(y*width+x)*3;if(Math.abs(ppm[p]-18)>2||Math.abs(ppm[p+1]-171)>2||Math.abs(ppm[p+2]-52)>2)continue;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);sumX+=x+0.5;sumY+=y+0.5;count++;}
    const scale=4/3,angle=box.rotation*Math.PI/180,extentX=(Math.abs(box.width*Math.cos(angle))+Math.abs(box.height*Math.sin(angle)))/2,extentY=(Math.abs(box.width*Math.sin(angle))+Math.abs(box.height*Math.cos(angle)))/2,cx=box.x+box.width/2,cy=box.y+box.height/2;
    const actual={left,top,right:right+1,bottom:bottom+1,cx:sumX/count,cy:sumY/count},expected={left:(cx-extentX)*scale,top:(cy-extentY)*scale,right:(cx+extentX)*scale,bottom:(cy+extentY)*scale,cx:cx*scale,cy:cy*scale};
    console.log(JSON.stringify({kind:'native-group-geometry',pdfHash:result.hash,pageBox:box,coloredPixels:count,actual,expected}));
    const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'pptx-group-geometry.pdf'),result.bytes);execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-l','1','-singlefile','-r','96','-png',pdf,join(evidence,'pptx-group-geometry')],{timeout:15000});}
    expect(count).toBeGreaterThan(1000);for(const key of Object.keys(expected) as Array<keyof typeof expected>)expect(Math.abs(actual[key]-expected[key]),key).toBeLessThan(2);
  },90000);
  it('renders real text formatting and paragraph lists while independent OOXML reading preserves all other parts',async()=>{
    const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=await OfficePackage.read(readFileSync(originalPath));
    let file=editPptx(original,{type:'insert-element',slideId:'256',kind:'text'}).packageData;
    const elementId=new OfficePagesModel(file).info.slides[0].elements!.at(-1)!.id;
    file=editPptx(file,{type:'element-text',slideId:'256',elementId,text:'FORMAT_NATIVE\nSecond line 中文'}).packageData;
    file=editPptx(file,{type:'element-transform',slideId:'256',elementId,patch:{x:75,y:260,width:520,height:120}}).packageData;
    file=editPptx(file,{type:'element-format',slideId:'256',elementId,patch:{font:{family:'Arial',points:24,bold:true,italic:true,underline:true,strike:true,color:'#c01020'},align:'center',list:'number'}}).packageData;
    const path=join(fixture,'text-format.pptx');writeFileSync(path,await file.bytes());
    const independent=JSON.parse(execFileSync('python3',['-c',[
      'import sys,json; from zipfile import ZipFile; from xml.etree import ElementTree as E',
      'a,b=(ZipFile(p) for p in sys.argv[1:3]); assert set(a.namelist())==set(b.namelist())',
      'assert all(a.read(n)==b.read(n) for n in a.namelist() if n!="ppt/slides/slide1.xml")',
      'P="{http://schemas.openxmlformats.org/presentationml/2006/main}"; A="{http://schemas.openxmlformats.org/drawingml/2006/main}"',
      'root=E.fromstring(b.read("ppt/slides/slide1.xml")); shape=next(s for s in root.iter(P+"sp") if any(n.get("id")==sys.argv[3] for n in s.iter(P+"cNvPr")))',
      'body=shape.find(P+"txBody"); paragraphs=body.findall(A+"p"); assert len(paragraphs)==2',
      'for p in paragraphs:',
      ' pr=p.find(A+"pPr"); assert pr.get("algn")=="ctr" and pr.find(A+"buAutoNum").get("type")=="arabicPeriod"',
      ' for rpr in [pr.find(A+"defRPr"),p.find(A+"r/"+A+"rPr"),p.find(A+"endParaRPr")]:',
      '  assert rpr.get("sz")=="2400" and rpr.get("b")=="1" and rpr.get("i")=="1" and rpr.get("u")=="sng" and rpr.get("strike")=="sngStrike"',
      '  assert rpr.find(A+"latin").get("typeface")=="Arial"',
      '  assert rpr.find(A+"ea") is None and rpr.find(A+"cs") is None',
      '  assert rpr.find(A+"solidFill/"+A+"srgbClr").get("val")=="C01020"',
      'print(json.dumps({"text":"\\n".join("".join(t.text or "" for t in p.iter(A+"t")) for p in paragraphs),"formatVerified":True,"otherPartsUnchanged":True},ensure_ascii=False))',
    ].join('\n'),originalPath,path,elementId],{encoding:'utf8',timeout:15000}));expect(independent).toEqual({text:'FORMAT_NATIVE\nSecond line 中文',formatVerified:true,otherPartsUnchanged:true});
    const rendered=await engine.render(readFileSync(path),'pptx',new AbortController().signal),pdf=join(fixture,'text-format.pdf');writeFileSync(pdf,rendered.bytes);expect(rendered.pages).toBe(2);
    const text=execFileSync('/opt/homebrew/bin/pdftotext',['-raw',pdf,'-'],{encoding:'utf8',timeout:15000});expect(text).toContain('FORMAT_NATIVE');expect(text).toContain('Second line 中文');
    const positioned=execFileSync('/opt/homebrew/bin/pdftohtml',['-xml','-i','-stdout',pdf],{encoding:'utf8',timeout:15000,stdio:['pipe','pipe','ignore']});
    const fontEvidence=JSON.parse(execFileSync('python3',['-c',[
      'import sys,json; from xml.etree import ElementTree as E',
      'root=E.fromstring(sys.stdin.read()); fonts={n.get("id"):n.get("family") for n in root.iter("fontspec")}',
      'runs=[("".join(n.itertext()),fonts[n.get("font")]) for n in root.iter("text")]',
      'latin=next(face for text,face in runs if "FORMAT_NATIVE" in text)',
      'cjk=next(face for text,face in runs if text=="中文")',
      'assert cjk!=latin',
      'print(json.dumps({"latin":latin,"cjk":cjk,"distinctCjkGlyphMapping":True}))',
    ].join('\n')],{input:positioned,encoding:'utf8',timeout:15000}));
    const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'pptx-text-format.pdf'),rendered.bytes);writeFileSync(join(evidence,'pptx-text-format.pptx'),readFileSync(path));execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-l','1','-singlefile','-r','96','-png',pdf,join(evidence,'pptx-text-format')],{timeout:15000});}
    console.log(JSON.stringify({kind:'native-text-format',pdfHash:rendered.hash,pptxHash:checksum(readFileSync(path)),pages:rendered.pages,independent,fontEvidence}));
  },90000);
  it('renders source appearance with independent XML and pixel checks, and records the whole-object opacity capability probe',async()=>{
    const original=await OfficePackage.read(readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'))),part='ppt/slides/slide1.xml';
    const baseDoc=new OfficeXml(original.read(part)),tree=pptxShapeTree(baseDoc);
    let file=original.patch(new Map([[part,baseDoc.edit(pptxDrawingNodes(tree).filter(row=>row.parent===tree).map(({node})=>({start:node.start,end:node.end,value:''})))]]),{changed:[part],added:[],removed:[]});
    file=editPptx(file,{type:'background',slideId:'256',color:'#ffffff'}).packageData;
    file=editPptx(file,{type:'insert-element',slideId:'256',kind:'shape'}).packageData;
    const elementId=new OfficePagesModel(file).info.slides[0].elements!.at(-1)!.id;
    for(const action of [
      {type:'element-text',slideId:'256',elementId,text:''},
      {type:'element-transform',slideId:'256',elementId,patch:{x:75,y:100,width:200,height:100}},
      {type:'element-appearance',slideId:'256',elementId,patch:{fill:'#cc2200',border:true,borderStyle:'dashed',shadow:true}},
    ] satisfies PptxAction[])file=editPptx(file,action).packageData;
    const noShadow=editPptx(file,{type:'element-appearance',slideId:'256',elementId,patch:{shadow:false}}).packageData;
    // Isolated research candidate: no production opacity action is enabled by
    // the presence of a valid OOXML effect. Its actual pixels decide support.
    const doc=new OfficeXml(noShadow.read(part)),shape=pptxDrawingNodes(pptxShapeTree(doc))[0].node,props=children(shape,'spPr')[0],effects=children(props,'effectLst',drawingNamespace(doc.root.uri))[0];
    const alpha=noShadow.patch(new Map([[part,doc.edit([{start:effects.start,end:effects.end,value:`<a:effectDag xmlns:a="${drawingNamespace(doc.root.uri)}" type="tree"><a:alphaModFix amt="50000"/></a:effectDag>`}])]]),{changed:[part],added:[],removed:[]});
    const probes:Record<string,{pdfHash:string;centre:number[];lower:number[];borderPixels:number}>={},evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;
    for(const [name,candidate] of [['shadow',file],['no-shadow',noShadow],['alpha-dag-probe',alpha]] as const){
      const bytes=await candidate.bytes(),rendered=await engine.render(bytes,'pptx',new AbortController().signal),pdf=join(fixture,`${name}.pdf`),ppm=join(fixture,`${name}.ppm`);writeFileSync(pdf,rendered.bytes);
      execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-l','1','-singlefile','-r','96',pdf,join(fixture,name)],{timeout:15000});
      const pixels=JSON.parse(execFileSync('python3',['-c',[
        'import sys,json; data=open(sys.argv[1],"rb").read(); header=data.split(b"\\n",3); assert header[0]==b"P6" and header[2]==b"255"',
        'w,h=map(int,header[1].split()); raw=header[3]',
        'def pixel(x,y): return list(raw[(y*w+x)*3:(y*w+x)*3+3])',
        'border=sum(1 for y in range(131,270) for x in range(97,370) if all(abs(a-b)<8 for a,b in zip(pixel(x,y),[85,123,115])))',
        'print(json.dumps({"centre":pixel(210,200),"lower":pixel(210,272),"borderPixels":border}))',
      ].join('\n'),ppm],{encoding:'utf8',timeout:15000}));
      probes[name]={pdfHash:rendered.hash,...pixels};
      if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,`pptx-appearance-${name}.pdf`),rendered.bytes);writeFileSync(join(evidence,`pptx-appearance-${name}.pptx`),bytes);execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-l','1','-singlefile','-r','96','-png',pdf,join(evidence,`pptx-appearance-${name}`)],{timeout:15000});}
    }
    expect(probes.shadow.centre).toEqual([204,34,0]);expect(probes.shadow.borderPixels).toBeGreaterThan(300);
    expect(probes['no-shadow'].centre).toEqual(probes.shadow.centre);expect(probes['no-shadow'].lower).toEqual([255,255,255]);expect(probes.shadow.lower.every(value=>value<250)).toBe(true);
    const path=join(fixture,'appearance.pptx');writeFileSync(path,await file.bytes());
    const independent=JSON.parse(execFileSync('python3',['-c',[
      'import sys,json; from zipfile import ZipFile; from xml.etree import ElementTree as E',
      'P="{http://schemas.openxmlformats.org/presentationml/2006/main}"; A="{http://schemas.openxmlformats.org/drawingml/2006/main}"',
      'with ZipFile(sys.argv[1]) as z: root=E.fromstring(z.read("ppt/slides/slide1.xml"))',
      'props=root.find(".//"+P+"sp/"+P+"spPr"); assert props.find(A+"solidFill/"+A+"srgbClr").get("val")=="CC2200"',
      'line=props.find(A+"ln"); assert line.get("w")=="19050" and line.find(A+"prstDash").get("val")=="dash"',
      'shadow=props.find(A+"effectLst/"+A+"outerShdw"); assert shadow.get("dist")=="57150" and shadow.find(A+"srgbClr/"+A+"alpha").get("val")=="20000"',
      'print(json.dumps({"fillBorderShadow":True}))',
    ].join('\n'),path],{encoding:'utf8',timeout:15000}));
    for(const name of original.names())if(name!==part)expect(file.hashes()[name],name).toBe(original.hashes()[name]);
    const pixel=probes['alpha-dag-probe'].centre,wholeObjectOpacitySupported=Math.abs(pixel[0]-230)<4&&Math.abs(pixel[1]-145)<4&&Math.abs(pixel[2]-128)<4;
    console.log(JSON.stringify({kind:'native-appearance',probes,independent,otherPartsUnchanged:true,wholeObjectOpacitySupported,opacityScope:'research-only effectDag/alphaModFix; never a production capability claim'}));
  },120000);
  it('edits and inserts real DrawingML tables through Worker/native save, then restores original parts',async()=>{
    const worker=join(build,'pptx-tables.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX tables',projectId:'tables'}],resolver={sources:()=>sources};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'tables.pptx');writeFileSync(path,original);
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'tables'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'tables.pptx'}),id=randomUUID(),draftId=randomUUID();
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});const originalTable=state.info.slides[0].elements!.find(element=>element.kind==='table')!.id;
      const edit=async(action:PptxAction)=>{state=await service.pptx.edit('owner',{id,version:state.version,action});};
      await edit({type:'table-cell',slideId:'256',elementId:originalTable,row:2,column:1,text:'TABLE_CELL_NATIVE 中文'});
      await edit({type:'table-flags',slideId:'256',elementId:originalTable,patch:{headerRow:false,headerColumn:true}});
      await edit({type:'insert-element',slideId:'256',kind:'table'});const inserted=state.info.slides[0].elements!.at(-1)!.id;
      await edit({type:'table-cell',slideId:'256',elementId:inserted,row:1,column:0,text:'NEW_TABLE'});
      await edit({type:'element-transform',slideId:'256',elementId:inserted,patch:{x:190,y:245,width:350,height:130}});
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',[
        'import sys,json; from zipfile import ZipFile; from xml.etree import ElementTree as E',
        'a,b=(ZipFile(p) for p in sys.argv[1:3]); assert set(a.namelist())==set(b.namelist()); assert all(a.read(n)==b.read(n) for n in a.namelist() if n!="ppt/slides/slide1.xml")',
        'A="{http://schemas.openxmlformats.org/drawingml/2006/main}"; root=E.fromstring(b.read("ppt/slides/slide1.xml")); tables=list(root.iter(A+"tbl")); assert len(tables)==2',
        'cell=tables[0].findall(A+"tr")[2].findall(A+"tc")[1]; assert "".join(n.text or "" for n in cell.iter(A+"t"))=="TABLE_CELL_NATIVE 中文"',
        'props=tables[0].find(A+"tblPr"); assert props.get("firstRow")=="0" and props.get("firstCol")=="1"',
        'new=tables[1]; assert len(new.findall(A+"tr"))==3 and len(new.find(A+"tblGrid").findall(A+"gridCol"))==2; assert any(n.text=="NEW_TABLE" for n in new.iter(A+"t"))',
        'assert sum(int(n.get("w")) for n in new.find(A+"tblGrid"))==350*12700; assert sum(int(n.get("h")) for n in new.findall(A+"tr"))==130*12700',
        'print(json.dumps({"tables":len(tables),"cellAndFlagsVerified":True,"gridResized":[350,130],"otherPartsUnchanged":True}))',
      ].join('\n'),originalPath,path],{encoding:'utf8',timeout:15000}));
      const requestId=randomUUID(),rendered=await service.pptx.render('owner',{id,version:state.version,requestId});expect(rendered.pages).toBe(2);
      expect(rendered.tableLayout?.reduce((sum,table)=>sum+table.cells.length,0)).toBe(12);expect(rendered.tableLayoutError).toBeUndefined();
      const pdf=join(fixture,'tables.pdf');writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,requestId,0,rendered.bytes),'base64'));
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'pptx-table-model.pdf'),readFileSync(pdf));writeFileSync(join(evidence,'pptx-table-model.pptx'),readFileSync(path));execFileSync('/opt/homebrew/bin/pdftoppm',['-f','1','-l','1','-singlefile','-r','96','-png',pdf,join(evidence,'pptx-table-model')],{timeout:15000});}
      const text=execFileSync('/opt/homebrew/bin/pdftotext',['-raw',pdf,'-'],{encoding:'utf8',timeout:15000});expect(text).toContain('TABLE_CELL_NATIVE');expect(text).toContain('NEW_TABLE');expect(text).toContain('中文');
      const recoveryId=randomUUID(),pending=[{slideId:'256',elementId:inserted,cell:{row:0,column:0},text:'候选\ud800'},{slideId:'256',elementId:inserted,cell:{row:0,column:1},text:'另一格'},{slideId:'256',text:'独立备注'}];
      await service.pptx.checkpoint('owner',{id,version:state.version,draftId:recoveryId,bufferVersion:10,pending});
      const verify=randomUUID(),fresh=await service.refresh('owner',file.ref),reopened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});expect(reopened.state.info.slides[0].elements!.find(element=>element.id===originalTable)!.table!.cells[2][1].text).toBe('TABLE_CELL_NATIVE 中文');
      const restored=await service.pptx.restore('owner',{id:verify,version:reopened.state.version,draftId:recoveryId});expect(pptxPendingInputs(restored.pending)).toEqual(pending);service.pptx.close('owner',verify);
      for(let i=0;i<5;i++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});
      await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});
      execFileSync('python3',['-c','import sys,hashlib; from zipfile import ZipFile; h=lambda z:{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}; a,b=(ZipFile(p) for p in sys.argv[1:]); assert h(a)==h(b)',originalPath,path],{timeout:15000});
      console.log(JSON.stringify({kind:'native-table-model',savedHash:saved.receipt.revision!.hash,pdfHash:rendered.hash,pages:rendered.pages,layoutCells:rendered.tableLayout!.reduce((sum,table)=>sum+table.cells.length,0),independent,reopened:true,recoveredTargets:pending.length,originalPartsRestored:true}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },90000);
  it('resizes automatic table rows from the same-version native measurement and saves only the intended source grid',async()=>{
    const worker=join(build,'pptx-measured-rows.cjs'),require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({entryPoints:[resolve('src/main/core/files/office/pptx-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
    const project=join(fixture,'project');mkdirSync(project);const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'Measured table',projectId:'measured'}],resolver={sources:()=>sources};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:runtime},undefined,worker);
    const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'measured.pptx');writeFileSync(path,original);
    try{
      const root=(await service.openScope('owner',{kind:'project',projectId:'measured'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'measured.pptx'}),id=randomUUID(),draftId=randomUUID();
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});const element=state.info.slides[0].elements!.find(element=>element.table)!;
      expect(element.table!.heights).toEqual([0,0,0]);const before=await service.pptx.render('owner',{id,version:0,requestId:randomUUID()});expect(before.tableLayoutError).toBeUndefined();
      state=await service.pptx.edit('owner',{id,version:0,action:{type:'element-transform',slideId:'256',elementId:element.id,patch:{height:100}}});
      const heights=state.info.slides[0].elements!.find(row=>row.id===element.id)!.table!.heights;expect(heights.every(height=>height>0)).toBe(true);expect(heights.reduce((a,b)=>a+b,0)).toBeCloseTo(100,6);
      const saved=await service.pptx.save('owner',{id,version:1,draftId,bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      execFileSync('python3',['-c',[
        'import sys; from zipfile import ZipFile; from xml.etree import ElementTree as E',
        'a,b=(ZipFile(p) for p in sys.argv[1:]); assert set(a.namelist())==set(b.namelist()); assert all(a.read(n)==b.read(n) for n in a.namelist() if n!="ppt/slides/slide1.xml")',
        'A="{http://schemas.openxmlformats.org/drawingml/2006/main}"; tables=[list(E.fromstring(z.read("ppt/slides/slide1.xml")).iter(A+"tbl"))[0] for z in [a,b]]',
        'assert sum(int(row.get("h")) for row in tables[1].findall(A+"tr"))==1270000; assert [E.tostring(c) for c in tables[0].iter(A+"tc")]==[E.tostring(c) for c in tables[1].iter(A+"tc")]',
      ].join('\n'),originalPath,path],{timeout:15000});
      const after=await service.pptx.render('owner',{id,version:1,requestId:randomUUID()});expect(after.tableLayoutError).toBeUndefined();const cells=after.tableLayout!.find(row=>row.elementId===element.id)!.cells,ys=cells.flatMap(cell=>cell.points.map(point=>point[1])),actualHeight=Math.max(...ys)-Math.min(...ys);expect(Math.abs(actualHeight-100)).toBeLessThan(.15);
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'pptx-measured-rows.pptx'),readFileSync(path));writeFileSync(join(evidence,'pptx-measured-rows.pdf'),Buffer.from(service.pptx.chunk('owner',id,after.id,0,after.bytes),'base64'));writeFileSync(join(evidence,'pptx-measured-rows.json'),JSON.stringify({heights,actualHeight,before:before.tableLayout,after:after.tableLayout},null,2));}
      state=await service.pptx.history('owner',{id,version:1,direction:'undo'});await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});
      execFileSync('python3',['-c','import sys,hashlib; from zipfile import ZipFile; h=lambda z:{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}; a,b=(ZipFile(p) for p in sys.argv[1:]); assert h(a)==h(b)',originalPath,path],{timeout:15000});
      console.log(JSON.stringify({kind:'native-table-measured-resize',savedHash:saved.receipt.revision!.hash,pdfHash:after.hash,sourceHeights:heights,actualHeight,otherPartsAndCellBodiesUnchanged:true,originalPartsRestored:true}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();}
  },120000);
  it('measures auto-height, expanded, blank, merged and hidden table cells through the isolated native SVG route',async()=>{
    const original=await OfficePackage.read(readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'))),originalHashes=original.hashes();
    let source=original;const originalTable=new OfficePagesModel(source).info.slides[0].elements!.find(element=>element.kind==='table')!.id;
    source=editPptx(source,{type:'table-cell',slideId:'256',elementId:originalTable,row:0,column:0,text:''}).packageData;
    const part='ppt/slides/slide1.xml',doc=new OfficeXml(source.read(part)),drawing=drawingNamespace(doc.root.uri),table=pptxDrawingNodes(pptxShapeTree(doc)).find(row=>children(children(row.node,'graphic',drawing)[0]??row.node,'graphicData',drawing).some(data=>children(data,'tbl',drawing).length))!.node;
    const tbl=children(children(children(table,'graphic',drawing)[0],'graphicData',drawing)[0],'tbl',drawing)[0],rows=children(tbl,'tr',drawing),anchor=children(rows[1],'tc',drawing)[0],covered=children(rows[2],'tc',drawing)[0];
    source=source.patch(new Map([[part,doc.edit([doc.setAttribute(anchor,'rowSpan','2'),doc.setAttribute(covered,'vMerge','1')])]]),{changed:[part],added:[],removed:[]});
    source=editPptx(source,{type:'insert-element',slideId:'256',kind:'table'}).packageData;const added=new OfficePagesModel(source).info.slides[0].elements!.at(-1)!;
    source=editPptx(source,{type:'table-cell',slideId:'256',elementId:added.id,row:1,column:0,text:'line one\nline two\nline three\nline four'}).packageData;
    source=editPptx(source,{type:'insert-element',slideId:'257',kind:'table'}).packageData;source=editPptx(source,{type:'hidden',slideId:'257',hidden:true}).packageData;
    const model=new OfficePagesModel(source),marked=pptxTableLayoutSource(model);expect(marked.markers.size).toBe(17);
    const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;
    if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'pptx-table-layout-source.pptx'),await source.bytes());writeFileSync(join(evidence,'pptx-table-layout-private.pptx'),await marked.packageData.bytes());writeFileSync(join(evidence,'pptx-table-layout-markers.json'),JSON.stringify([...marked.markers],null,2));}
    const visibleReference=editPptx(source,{type:'hidden',slideId:'257',hidden:false}).packageData;
    const before=await engine.renderTableLayout(await visibleReference.bytes(),new AbortController().signal),after=await engine.renderTableLayout(await marked.packageData.bytes(),new AbortController().signal);
    if(evidence){writeFileSync(join(evidence,'pptx-table-layout-original.svg'),before.bytes);writeFileSync(join(evidence,'pptx-table-layout-private.svg'),after.bytes);}
    const originalSVG=join(fixture,'unmarked.svg'),markedSVG=join(fixture,'marked.svg');writeFileSync(originalSVG,before.bytes);writeFileSync(markedSVG,after.bytes);
    execFileSync('python3',['-c','import sys; from xml.etree import ElementTree as E; S="{http://www.w3.org/2000/svg}"; texts=lambda p:[E.tostring(n) for n in E.parse(p).getroot().iter(S+"text") if n.get("class")=="SVGTextShape"]; assert texts(sys.argv[1])==texts(sys.argv[2])',originalSVG,markedSVG],{timeout:15000});
    const layout=readPptxTableLayout(after.bytes,marked),height=(cell:typeof layout[number]['cells'][number])=>Math.hypot(cell.points[3][0]-cell.points[0][0],cell.points[3][1]-cell.points[0][1]);
    expect(layout.reduce((sum,table)=>sum+table.cells.length,0)).toBe(17);expect(layout.some(table=>table.slideId==='257')).toBe(true);
    const first=layout.find(table=>table.slideId==='256'&&table.elementId===originalTable)!,expanded=layout.find(table=>table.slideId==='256'&&table.elementId===added.id)!;
    expect(height(first.cells.find(cell=>cell.row===0&&cell.column===0)!)).toBeGreaterThan(10);expect(height(first.cells.find(cell=>cell.row===1&&cell.column===0)!)).toBeGreaterThan(height(first.cells.find(cell=>cell.row===1&&cell.column===1)!)*1.8);
    expect(first.cells.some(cell=>cell.row===2&&cell.column===0)).toBe(false);expect(height(expanded.cells.find(cell=>cell.row===1&&cell.column===0)!)).toBeGreaterThan(added.table!.heights[1]*2);
    expect(original.hashes()).toEqual(originalHashes);expect(new OfficePagesModel(source).info.slides[1].hidden).toBe(true);expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
    const result={kind:'native-table-layout',sourceHash:checksum(await source.bytes()),originalSVGHash:before.hash,markedSVGHash:after.hash,cellCount:17,textPositionsUnchanged:true,originalPartsUnchanged:true,layout};
    if(evidence)writeFileSync(join(evidence,'pptx-table-layout.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({...result,layout:undefined}));
  },120000);
  it('enforces process wall/RSS budgets and cancellation without retaining a running job',async()=>{
    for(const extra of [{testWallMs:1},{testRssBytes:1}]){
      const input=await request(await docxFixture(),'docx',extra);
      try {await expect(broker.request(input,{timeoutMs:15000})).rejects.toThrow('testWallMs' in extra?'TIMEOUT':'TOO_LARGE');}finally{await workspaces.clean(input.job);}
    }
    const abort=new AbortController(),input=await request(await docxFixture(),'docx',{testStopAt:'office-render-running'});let started=0;
    try {await expect(broker.request(input,{signal:abort.signal,timeoutMs:15000,onTestStop:()=>{started=Date.now();abort.abort();}})).rejects.toThrow('CANCELLED');expect(Date.now()-started).toBeLessThan(5000);}finally{await workspaces.clean(input.job);}
    expect(broker.activeProcesses).toBe(0);expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
  },40000);
  it('keeps a malformed input failure distinct from a successful PDF and permits a valid retry',async()=>{
    const input=await request(Buffer.from('PK\x03\x04invalid package'),'docx');
    try {const result=await broker.request<OfficeRenderNativeResult>(input,{timeoutMs:30000});expect(result.state).toBe('failed');}finally{await workspaces.clean(input.job);}
    expect((await engine.render(await docxFixture(),'docx',new AbortController().signal)).pages).toBe(1);
  },60000);
  it('blocks real outside read/write/exec, TCP and unrelated UNIX sockets with the rendering profile',async()=>{
    const secret=join(fixture,'outside-secret'),written=join(fixture,'outside-write'),unix=join(fixture,'other.sock');writeFileSync(secret,'synthetic secret');
    let tcpConnections=0,unixConnections=0;const tcp=createServer(socket=>{tcpConnections++;socket.destroy();}),local=createServer(socket=>{unixConnections++;socket.destroy();});
    await new Promise<void>(resolve=>tcp.listen(0,'127.0.0.1',resolve));await new Promise<void>(resolve=>local.listen(unix,resolve));
    try {
      const port=(tcp.address() as {port:number}).port,source=join(fixture,'canary.cpp'),executable=join(fixture,'canary');
      writeFileSync(source,`
#include <CoreGraphics/CoreGraphics.h>
#include <CoreFoundation/CoreFoundation.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <arpa/inet.h>
#include <spawn.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstdio>
#include <cstring>
#include <string>
static int bad(const char *name){fprintf(stderr,"Sandbox canary unexpectedly allowed %s\\n",name);return 71;}
int main(){
 int fd=open(${JSON.stringify(secret)},O_RDONLY);if(fd>=0){close(fd);return bad("outside read");}
 fd=open(${JSON.stringify(written)},O_CREAT|O_WRONLY,0600);if(fd>=0){close(fd);return bad("outside write");}
 fd=open(${JSON.stringify(join(runtime,'LibreOffice.app/Contents/MacOS/soffice'))},O_WRONLY);if(fd>=0){close(fd);return bad("runtime write");}
 pid_t child;char command[]="/usr/bin/touch",target[]=${JSON.stringify(written)};char *args[]={command,target,nullptr},*env[]={nullptr};
 if(posix_spawn(&child,command,nullptr,nullptr,args,env)==0){waitpid(child,nullptr,0);return bad("other executable");}
 fd=socket(AF_INET,SOCK_STREAM,0);if(fd>=0){sockaddr_in address{};address.sin_family=AF_INET;address.sin_port=htons(${port});inet_pton(AF_INET,"127.0.0.1",&address.sin_addr);int connected=connect(fd,(sockaddr*)&address,sizeof(address));close(fd);if(connected==0)return bad("TCP");}
 fd=socket(AF_UNIX,SOCK_STREAM,0);if(fd>=0){sockaddr_un address{};address.sun_family=AF_UNIX;strcpy(address.sun_path,${JSON.stringify(unix)});int connected=connect(fd,(sockaddr*)&address,sizeof(address));close(fd);if(connected==0)return bad("unrelated UNIX socket");}
 FILE *config=fopen("home/profile/user/registrymodifications.xcu","r");if(!config)return 72;char settings[4096]{};fread(settings,1,sizeof(settings)-1,config);fclose(config);if(!strstr(settings,"DisableMacrosExecution")||!strstr(settings,"<value>true</value>"))return 73;
 char directory[4096];if(!getcwd(directory,sizeof(directory)))return 74;std::string path=std::string(directory)+"/out/source.pdf";
 CFURLRef url=CFURLCreateFromFileSystemRepresentation(nullptr,(const UInt8*)path.data(),path.size(),false);CGRect page=CGRectMake(0,0,200,200);CGContextRef pdf=CGPDFContextCreateWithURL(url,&page,nullptr);CFRelease(url);if(!pdf)return 75;
 CGPDFContextBeginPage(pdf,nullptr);CGContextSetRGBFillColor(pdf,0,0,0,1);CGContextFillRect(pdf,CGRectMake(10,10,30,30));CGPDFContextEndPage(pdf);CGPDFContextClose(pdf);CGContextRelease(pdf);puts("all confinement canaries denied");return 0;
}
`);
      execFileSync('xcrun',['clang++','-std=c++17','-framework','CoreGraphics','-framework','CoreFoundation',source,'-o',executable]);
      const info=statSync(executable,{bigint:true}),input=await request(await docxFixture(),'docx',{testRenderer:{path:executable,identity:{device:String(info.dev),inode:String(info.ino)},hash:checksum(readFileSync(executable))}});
      try {const result=await broker.request<OfficeRenderNativeResult>(input,{timeoutMs:30000});expect(result.state,result.diagnostic).toBe('ready');expect(result.diagnostic).toContain('all confinement canaries denied');}finally{await workspaces.clean(input.job);}
      expect(tcpConnections).toBe(0);expect(unixConnections).toBe(0);expect(existsSync(written)).toBe(false);expect(readFileSync(secret,'utf8')).toBe('synthetic secret');expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
    } finally {await Promise.all([new Promise<void>(resolve=>tcp.close(()=>resolve())),new Promise<void>(resolve=>local.close(()=>resolve()))]);}
  },45000);
});
