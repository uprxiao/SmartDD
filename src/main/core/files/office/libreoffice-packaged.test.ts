import { describe,it,expect } from 'vitest';
import { join,resolve } from 'node:path';
import { mkdtempSync,realpathSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ZipFile } from 'yazl';
import { NativeFileBroker } from '../native-broker';
import { FileHeavyJobs } from '../heavy-jobs';
import { LibreOfficeEngine } from './libreoffice-engine';
import { OfficePackage } from './package';
import { OfficeRelationships,OPC_REL,OPC_TYPES,OFFICE_REL } from './relationships';
import { OfficeXml } from './xml';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { pptxPendingInputs,type PptxAction } from '@shared/file-pptx';
import { modernChartFixture } from './pptx-chart-fixtures';

const app=process.env.SMARTDD_M9_LIBREOFFICE_APP;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

/** Runs only when explicitly given a built .app. No compiler or test broker is
 * used: enclosing seal, original vendor signature and real packaged helper. */
describe.skipIf(!app || process.platform!=='darwin')('packaged Office rendering (not App UI acceptance)',()=>{
  it('renders source modern charts with the shipped projection Worker and preserves editable charts',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-chartex-preview-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files')),resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'Modern charts',projectId:'modern'}]};
    const worker=join(app!,'Contents/Resources/app.asar/out/main/m9-pptx-document.js'),pagesWorker=join(app!,'Contents/Resources/app.asar/out/main/m9-office-pages.js'),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},pagesWorker,worker);
    const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
    try{
      const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'modern.pptx');writeFileSync(path,original);
      const root=(await service.openScope('owner',{kind:'project',projectId:'modern'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'modern.pptx'}),id=randomUUID(),draftId=randomUUID();
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash}),mutations=0;
      const edit=async(action:PptxAction)=>{const before=state.version;state=await service.pptx.edit('owner',{id,version:before,action});if(state.version!==before)mutations++;};
      const charts=[];
      for(const type of ['funnel','histogram','waterfall','treemap'] as const){
        await edit({type:'add',slideId:state.info.slides.at(-1)!.id});const slideId=state.info.slides.at(-1)!.id;
        await edit({type:'chart-insert',slideId,chartType:type});const elementId=state.info.slides.at(-1)!.elements!.at(-1)!.id;
        await edit({type:'chart-values',slideId,elementId,values:[6,3,4]});await edit({type:'chart-options',slideId,elementId,patch:{axes:true,gridLines:true,legend:true}});
        charts.push({type,slideId,elementId,page:state.info.slides.length});
      }
      const roundtrip=charts[0];await edit({type:'chart-type',slideId:roundtrip.slideId,elementId:roundtrip.elementId,chartType:'line'});
      await edit({type:'chart-values',slideId:roundtrip.slideId,elementId:roundtrip.elementId,values:[7]});
      const one=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),onePdf=join(base,'single-line.pdf'),oneStem=join(base,'single-line');writeFileSync(onePdf,Buffer.from(service.pptx.chunk('owner',id,one.id,0,one.bytes),'base64'));
      execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(roundtrip.page),'-singlefile','-r','96',onePdf,oneStem],{timeout:15000});
      const singleLinePixels=Number(execFileSync('python3',['-c',String.raw`import sys,pathlib
head,size,maximum,data=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);assert head==b'P6' and maximum==b'255';count=list(zip(data[::3],data[1::3],data[2::3])).count((20,128,110));assert count>5,count;print(count)`,oneStem+'.ppm'],{encoding:'utf8',timeout:15000}));
      const measureArea=async(label:string,expectedCount:number)=>{
        const projection=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),pdf=join(base,label+'.pdf'),stem=join(base,label);writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,projection.id,0,projection.bytes),'base64'));
        execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(roundtrip.page),'-singlefile','-r','96',pdf,stem],{timeout:15000});
        const markers=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,pathlib,json
head,size,maximum,data=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);assert head==b'P6' and maximum==b'255';w,h=map(int,size.split());rgb=list(zip(data[::3],data[1::3],data[2::3]));expected=int(sys.argv[2]);out=[]
for index,color in enumerate([(20,128,110),(195,91,85),(87,121,168),(182,133,56)]):
 remaining={i for i,value in enumerate(rgb) if value==color};groups=[]
 while remaining:
  todo=[remaining.pop()];count=0
  while todo:
   point=todo.pop();count+=1
   for nxt in [point-1,point+1,point-w,point+w]:
    if nxt in remaining and abs(point%w-nxt%w)+abs(point//w-nxt//w)==1:remaining.remove(nxt);todo.append(nxt)
  if count>5:groups.append(count)
 assert len(groups)==len(range(index,expected,4)),(color,groups,expected);out.append(groups)
print(json.dumps(out))`,stem+'.ppm',String(expectedCount)],{encoding:'utf8',timeout:15000}));
        if(evidence){writeFileSync(join(evidence,label+'.pdf'),readFileSync(pdf));execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(roundtrip.page),'-singlefile','-r','96','-png',pdf,stem],{timeout:15000});writeFileSync(join(evidence,label+'.png'),readFileSync(stem+'.png'));}
        return markers;
      };
      await edit({type:'chart-type',slideId:roundtrip.slideId,elementId:roundtrip.elementId,chartType:'area'});const singleAreaMarkers=await measureArea('single-area',1);
      const eightValues=[1,8,2,7,3,6,4,5];await edit({type:'chart-values',slideId:roundtrip.slideId,elementId:roundtrip.elementId,values:eightValues});await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});
      const resizedData=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,zipfile,io,posixpath,json,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);c='{http://schemas.openxmlformats.org/drawingml/2006/chart}';p='{http://schemas.openxmlformats.org/presentationml/2006/main}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';s='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
def rels(book,part):return {n.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),n.attrib['Target'])) for n in E.fromstring(book.read(posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')))}
entry=next(n for n in E.fromstring(z.read('ppt/presentation.xml')).iter(p+'sldId') if n.attrib['id']==sys.argv[2]);part=rels(z,'ppt/presentation.xml')[entry.attrib[r+'id']];ref=next(E.fromstring(z.read(part)).iter(c+'chart'));cp=rels(z,part)[ref.attrib[r+'id']];chart=E.fromstring(z.read(cp));series=chart.find(c+'chart/'+c+'plotArea/'+c+'areaChart/'+c+'ser');helper=chart.find(c+'chart/'+c+'plotArea/'+c+'lineChart/'+c+'ser');assert helper is not None;value=series.find(c+'val/'+c+'numRef');assert helper.find(c+'val/'+c+'numRef/'+c+'f').text==value.find(c+'f').text;assert [float(n.text) for n in helper.findall(c+'val/'+c+'numRef/'+c+'numCache/'+c+'pt/'+c+'v')]==[1,8,2,7,3,6,4,5];assert len(helper.findall(c+'dPt'))==8;values=[float(n.text) for n in value.findall(c+'numCache/'+c+'pt/'+c+'v')];assert values==[1,8,2,7,3,6,4,5];assert len(series.findall(c+'dPt'))==8
bp=rels(z,cp)[chart.find(c+'externalData').attrib[r+'id']];book=zipfile.ZipFile(io.BytesIO(z.read(bp)));name=value.find(c+'f').text.split('!')[0];sheet=next(n for n in E.fromstring(book.read('xl/workbook.xml')).iter(s+'sheet') if n.attrib['name']==name);sp=rels(book,'xl/workbook.xml')[sheet.attrib[r+'id']];cells={n.attrib['r']:float(n.find(s+'v').text) for n in E.fromstring(book.read(sp)).iter(s+'c') if n.find(s+'v') is not None};assert [cells['B'+str(i+2)] for i in range(8)]==values;assert [cells['A'+str(i+2)] for i in range(8)]==list(range(1,9));print(json.dumps({'count':8,'values':values,'actualReferencedSheet':name,'categories':list(range(1,9))}))`,path,roundtrip.slideId],{encoding:'utf8',timeout:15000}));
      if(evidence){writeFileSync(join(evidence,'resize-eight.pptx'),readFileSync(path));writeFileSync(join(evidence,'single-line.pdf'),readFileSync(onePdf));execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(roundtrip.page),'-singlefile','-r','96','-png',onePdf,oneStem],{timeout:15000});writeFileSync(join(evidence,'single-line.png'),readFileSync(oneStem+'.png'));}
      const eightAreaMarkers=await measureArea('eight-area',8);await edit({type:'chart-type',slideId:roundtrip.slideId,elementId:roundtrip.elementId,chartType:'line'});
      await edit({type:'chart-values',slideId:roundtrip.slideId,elementId:roundtrip.elementId,values:[6,3,4]});await edit({type:'chart-type',slideId:roundtrip.slideId,elementId:roundtrip.elementId,chartType:'scatter'});
      expect(state.info.slides.find(row=>row.id===roundtrip.slideId)!.elements!.find(row=>row.id===roundtrip.elementId)!.chart).toMatchObject({type:'scatter',values:[6,3,4],options:{axes:true,gridLines:true,legend:true}});
      const scatterProjection=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),scatterPdf=join(base,'scatter.pdf'),scatterStem=join(base,'scatter');writeFileSync(scatterPdf,Buffer.from(service.pptx.chunk('owner',id,scatterProjection.id,0,scatterProjection.bytes),'base64'));
      execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(roundtrip.page),'-singlefile','-r','96',scatterPdf,scatterStem],{timeout:15000});
      const scatterMarkerColors=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,pathlib,json,collections
head,size,maximum,data=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);assert head==b'P6' and maximum==b'255';pixels=collections.Counter(zip(data[::3],data[1::3],data[2::3]));counts=[pixels[color] for color in [(20,128,110),(195,91,85),(87,121,168)]];assert min(counts)>5,counts;print(json.dumps(counts))`,scatterStem+'.ppm'],{encoding:'utf8',timeout:15000}));
      if(evidence){writeFileSync(join(evidence,'scatter.pdf'),readFileSync(scatterPdf));execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(roundtrip.page),'-singlefile','-r','96','-png',scatterPdf,scatterStem],{timeout:15000});writeFileSync(join(evidence,'scatter.png'),readFileSync(scatterStem+'.png'));}
      await edit({type:'chart-type',slideId:roundtrip.slideId,elementId:roundtrip.elementId,chartType:roundtrip.type});
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,zipfile,io,posixpath,json,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);o=zipfile.ZipFile(sys.argv[2]);cx='{http://schemas.microsoft.com/office/drawing/2014/chartex}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';s='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
def rels(part):return {n.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),n.attrib['Target'])) for n in E.fromstring(z.read(posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')))}
out=[]
for part in z.namelist():
 if not(part.startswith('ppt/slides/') and part.endswith('.xml') and '/_rels/' not in part):continue
 for ref in E.fromstring(z.read(part)).iter(cx+'chart'):
  cp=rels(part)[ref.attrib[r+'id']];chart=E.fromstring(z.read(cp));values=[float(n.text) for n in chart.findall(cx+'chartData/'+cx+'data/'+cx+'numDim/'+cx+'lvl/'+cx+'pt')];assert values==[6,3,4]
  bp=rels(cp)[chart.find(cx+'chartData/'+cx+'externalData').attrib[r+'id']];book=zipfile.ZipFile(io.BytesIO(z.read(bp)));name=chart.find(cx+'chartData/'+cx+'data/'+cx+'numDim/'+cx+'f').text.split('!')[0];sheet=next(n for n in E.fromstring(book.read('xl/workbook.xml')).iter(s+'sheet') if n.attrib['name']==name);br={n.attrib['Id']:posixpath.normpath(posixpath.join('xl',n.attrib['Target'])) for n in E.fromstring(book.read('xl/_rels/workbook.xml.rels'))};cells={n.attrib['r']:float(n.find(s+'v').text) for n in E.fromstring(book.read(br[sheet.attrib[r+'id']])).iter(s+'c') if n.find(s+'v') is not None};assert [cells['B2'],cells['B3'],cells['B4']]==values
  axes=chart.findall('.//'+cx+'axis');assert len(axes)==2 and all(n.attrib['hidden']=='0' for n in axes);assert chart.find('.//'+cx+'majorGridlines') is not None and chart.find('.//'+cx+'legend') is not None
  out.append({'type':chart.find('.//'+cx+'series').attrib['layoutId'],'values':values,'options':True})
assert len(out)==4
assert all(z.read(n)==o.read(n) for n in o.namelist() if n not in ['ppt/presentation.xml','ppt/_rels/presentation.xml.rels','[Content_Types].xml'])
print(json.dumps(out))`,path,originalPath],{encoding:'utf8',timeout:15000}));
      const projection=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()}),pdf=join(base,'modern.pdf');expect(projection.pages).toBe(6);expect(projection.sourceHash).toBe(saved.receipt.revision!.hash);writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,projection.id,0,projection.bytes),'base64'));
      const measured=[];
      for(const chart of charts){
        const stem=join(base,chart.type);execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(chart.page),'-singlefile','-r','96',pdf,stem],{timeout:15000});
        const result=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,pathlib,json,collections
head,size,maximum,data=pathlib.Path(sys.argv[1]).read_bytes().split(b'\n',3);assert head==b'P6' and maximum==b'255';w,h=map(int,size.split());pixels=list(zip(data[::3],data[1::3],data[2::3]));counts=collections.Counter(pixels);out=[]
for color in [(20,128,110),(195,91,85),(87,121,168)]:
 points=[(i%w,i//w) for i,c in enumerate(pixels) if c==color];assert points;xs,ys=zip(*points);out.append({'width':max(xs)-min(xs)+1,'height':max(ys)-min(ys)+1})
dimension='width' if sys.argv[2] in ['funnel','treemap'] else 'height';scale=sum(n[dimension] for n in out)/13;error=max(abs(n[dimension]-v*scale) for n,v in zip(out,[6,3,4]));assert error<=2,(out,error)
# The treemap covers its background grid except at the plot margins.
assert counts[(156,175,171)]>100 and counts[(213,229,222)]>(20 if sys.argv[2]=='treemap' else 100)
print(json.dumps({'type':sys.argv[2],'maxErrorPixels':error,'axesPixels':counts[(156,175,171)],'gridPixels':counts[(213,229,222)]}))`,stem+'.ppm',chart.type],{encoding:'utf8',timeout:15000}));measured.push(result);
        expect(execFileSync('/opt/homebrew/bin/pdftotext',['-f',String(chart.page),'-l',String(chart.page),pdf,'-'],{encoding:'utf8',timeout:15000})).toMatch(/1\s*·\s*2\s*·\s*3/);
        if(evidence){execFileSync('/opt/homebrew/bin/pdftoppm',['-f',String(chart.page),'-singlefile','-r','96','-png',pdf,stem],{timeout:15000});writeFileSync(join(evidence,chart.type+'.png'),readFileSync(stem+'.png'));}
      }
      const fresh=await service.refresh('owner',file.ref),readonlyId=randomUUID(),readonly=await service.officePages.open('owner',{id:readonlyId,ref:file.ref,baseHash:fresh.revision.hash});expect(readonly.pages).toBe(6);expect(readonly.sourceHash).toBe(saved.receipt.revision!.hash);service.officePages.release('owner',readonlyId);
      const verify=randomUUID(),reopened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});for(const chart of charts)expect(reopened.state.info.slides.find(row=>row.id===chart.slideId)!.elements!.find(row=>row.id===chart.elementId)!.chart).toMatchObject({type:chart.type,values:[6,3,4],options:{axes:true,gridLines:true,legend:true}});
      const pending={slideId:charts[0].slideId,elementId:charts[0].elementId,chartValues:true as const,text:'6,候选,'},recoveryId=randomUUID();await service.pptx.checkpoint('owner',{id,version:state.version,draftId:recoveryId,bufferVersion:100,pending});const restored=await service.pptx.restore('owner',{id:verify,version:0,draftId:recoveryId});expect(pptxPendingInputs(restored.pending)).toEqual([pending]);service.pptx.close('owner',verify);
      if(evidence){writeFileSync(join(evidence,'modern.pptx'),readFileSync(path));writeFileSync(join(evidence,'modern.pdf'),readFileSync(pdf));}
      for(let i=0;i<mutations;i++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual((await OfficePackage.read(original)).hashes());
      if(evidence)writeFileSync(join(evidence,'chartex-preview.json'),JSON.stringify({app,workerSha256:digest(readFileSync(worker)),pagesWorkerSha256:digest(readFileSync(pagesWorker)),sourceHash:saved.receipt.revision!.hash,pdfHash:projection.hash,independent,measured,scatterMarkerColors,singleLinePixels,singleAreaMarkers,eightAreaMarkers,resizedData,resizedCounts:[1,8,3],modernBasicRoundTrip:true,readonlyPreview:true,reopened:true,pendingRecovered:true,undoMutations:mutations,allOriginalPartsRestored:true,uiAcceptance:false},null,2)+'\n');
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },240000);
  it('edits and recovers real ChartEx data with the shipped Worker while guarding the unsupported preview',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-chartex-data-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files')),resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'ChartEx data',projectId:'modern'}]};
    const worker=join(app!,'Contents/Resources/app.asar/out/main/m9-pptx-document.js'),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},undefined,worker),results=[];
    try{
      const original=await OfficePackage.read(readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'))),root=(await service.openScope('owner',{kind:'project',projectId:'modern'})).roots[0];
      for(const type of ['funnel','histogram','waterfall','treemap'] as const){
        const source=modernChartFixture(original,type),candidate=await source.bytes(),path=join(project,type+'.pptx'),before=join(base,type+'-before.pptx');writeFileSync(path,candidate);writeFileSync(before,candidate);
        const file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:type+'.pptx'}),id=randomUUID(),draftId=randomUUID();
        let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
        const element=state.info.slides[0].elements!.find(row=>row.kind==='chart')!;expect(element.chart).toMatchObject({type,values:[9,4],editableValues:true});
        await expect(service.pptx.render('owner',{id,version:0,requestId:randomUUID()})).rejects.toThrow('图表预览');
        state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'chart-values',slideId:'256',elementId:element.id,values:[15,6]}});
        const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
        const independent=JSON.parse(execFileSync('python3',['-c',String.raw`import json,zipfile,io,sys,posixpath,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);o=zipfile.ZipFile(sys.argv[2]);c='{http://schemas.microsoft.com/office/drawing/2014/chartex}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';s='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
rels=lambda part:{n.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),n.attrib['Target'])) for n in E.fromstring(z.read(posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')))}
part='ppt/slides/slide1.xml';rid=E.fromstring(z.read(part)).find('.//'+c+'chart').attrib[r+'id'];chart=rels(part)[rid];root=E.fromstring(z.read(chart));values=[float(n.text) for n in root.findall('.//'+c+'numDim/'+c+'lvl/'+c+'pt')];embedded=rels(chart)[root.find(c+'chartData/'+c+'externalData').attrib[r+'id']]
book=zipfile.ZipFile(io.BytesIO(z.read(embedded)));old=zipfile.ZipFile(io.BytesIO(o.read('ppt/embeddings/chart-data.xlsx')));sheet=E.fromstring(book.read('xl/worksheets/sheet1.xml'));cells={n.attrib['r']:n.find(s+'v').text for n in sheet.findall('.//'+s+'c') if n.find(s+'v') is not None}
assert values==[15,6] and cells['B2']=='15' and cells['B3']=='6';assert book.namelist()==old.namelist();assert all(book.read(n)==old.read(n) for n in old.namelist() if n!='xl/worksheets/sheet1.xml')
changed=[n for n in o.namelist() if z.read(n)!=o.read(n)];assert sorted(changed)==sorted(['[Content_Types].xml',part,'ppt/slides/_rels/slide1.xml.rels']);print(json.dumps({'values':values,'embeddedValues':[cells['B2'],cells['B3']],'changed':changed,'oldChartAndWorkbookPreserved':True,'otherEmbeddedPartsPreserved':True}))`,path,before],{encoding:'utf8',timeout:15000}));
        const fresh=await service.refresh('owner',file.ref),verify=randomUUID(),opened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});
        expect(opened.state.info.slides[0].elements!.find(row=>row.id===element.id)!.chart).toMatchObject({type,values:[15,6],editableValues:true});
        await expect(service.pptx.render('owner',{id:verify,version:0,requestId:randomUUID()})).rejects.toThrow('图表预览');
        const recoveryId=randomUUID(),pending={slideId:'256',elementId:element.id,chartValues:true as const,text:'15,候选,'};
        await service.pptx.checkpoint('owner',{id,version:state.version,draftId:recoveryId,bufferVersion:10,pending});
        const recovered=await service.pptx.restore('owner',{id:verify,version:0,draftId:recoveryId});expect(pptxPendingInputs(recovered.pending)).toEqual([pending]);service.pptx.close('owner',verify);
        state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});
        await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});
        expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual(source.hashes());
        results.push({type,sourceHash:digest(candidate),savedHash:saved.receipt.revision!.hash,independent,previewRefused:true,pendingRecovered:true,reopened:true,undoAllOriginalParts:true});service.pptx.close('owner',id);
      }
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'chartex-data.json'),JSON.stringify({app,results,uiAcceptance:false},null,2)+'\n');}
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },180000);
  it('preserves modern chart sources when the shipped Worker refuses a misleading native preview',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-chartex-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files')),resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'Modern charts',projectId:'modern'}]};
    const worker=join(app!,'Contents/Resources/app.asar/out/main/m9-pptx-document.js'),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},undefined,worker),results=[];
    try{
      const original=await OfficePackage.read(readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'))),root=(await service.openScope('owner',{kind:'project',projectId:'modern'})).roots[0];
      for(const type of ['funnel','histogram','waterfall','treemap'] as const){
        const candidate=await modernChartFixture(original,type).bytes(),path=join(project,type+'.pptx'),before=join(base,type+'-before.pptx');writeFileSync(path,candidate);writeFileSync(before,candidate);
        const file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:type+'.pptx'}),id=randomUUID(),opened=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});expect(opened.state.info.unsupportedCharts).toHaveLength(1);
        await expect(service.pptx.render('owner',{id,version:0,requestId:randomUUID()})).rejects.toThrow('图表预览');expect(readFileSync(path)).toEqual(candidate);
        const state=await service.pptx.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'source retained: '+type}}),saved=await service.pptx.save('owner',{id,version:state.version,draftId:randomUUID(),bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
        execFileSync('python3',['-c','import sys,zipfile; a,b=(zipfile.ZipFile(p) for p in sys.argv[1:]); names=[n for n in a.namelist() if n.startswith(("ppt/charts/","ppt/embeddings/"))]; assert names; assert all(a.read(n)==b.read(n) for n in names)',before,path],{timeout:15000});
        const fresh=await service.refresh('owner',file.ref),verify=randomUUID(),reopened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});expect(reopened.state.info.slides[0].notes).toBe('source retained: '+type);expect(reopened.state.info.unsupportedCharts).toEqual(opened.state.info.unsupportedCharts);
        results.push({type,sourceHash:digest(candidate),savedHash:saved.receipt.revision!.hash,unsupportedCharts:opened.state.info.unsupportedCharts,previewRefused:true,chartAndWorkbookPreserved:true,reopened:true});service.pptx.close('owner',verify);service.pptx.close('owner',id);
      }
      const evidence=process.env.SMARTDD_M9_OFFICE_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'chartex-guard.json'),JSON.stringify({app,results,uiAcceptance:false},null,2)+'\n');}
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },120000);
  it('inserts changes and restores chart data with the shipped Worker and native helper',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-chart-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files')),resolver={sources:()=>[{kind:'project-directory' as const,id:'dir',path:project,label:'Charts',projectId:'charts'}]};
    const worker=join(app!,'Contents/Resources/app.asar/out/main/m9-pptx-document.js'),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},undefined,worker);
    try{
      const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'chart.pptx');writeFileSync(path,original);
      const root=(await service.openScope('owner',{kind:'project',projectId:'charts'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'chart.pptx'}),id=randomUUID(),draftId=randomUUID();
      await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});let state=await service.pptx.edit('owner',{id,version:0,action:{type:'chart-insert',slideId:'256',chartType:'bar'}});const elementId=state.info.slides[0].elements!.at(-1)!.id;
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'element-transform',slideId:'256',elementId,patch:{x:50,y:240,width:250,height:140}}});
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'chart-type',slideId:'256',elementId,chartType:'scatter'}});
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'chart-values',slideId:'256',elementId,values:[8,2,6]}});
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'chart-options',slideId:'256',elementId,patch:{axes:true,gridLines:true,legend:true}}});
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',String.raw`import sys,json,zipfile,io,posixpath,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);o=zipfile.ZipFile(sys.argv[2]);p='{http://schemas.openxmlformats.org/presentationml/2006/main}';c='{http://schemas.openxmlformats.org/drawingml/2006/chart}';a='{http://schemas.openxmlformats.org/drawingml/2006/main}';r='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}';s='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
def rels(part):
 rs=posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels');return {n.attrib['Id']:posixpath.normpath(posixpath.join(posixpath.dirname(part),n.attrib['Target'])) for n in E.fromstring(z.read(rs))}
part='ppt/slides/slide1.xml';root=E.fromstring(z.read(part));shape=next(n for n in root.iter(p+'graphicFrame') if n.find('.//'+p+'cNvPr').attrib['id']==sys.argv[3]);cp=rels(part)[shape.find('.//'+c+'chart').attrib[r+'id']];chart=E.fromstring(z.read(cp));scatter=chart.find('.//'+c+'scatterChart');assert scatter is not None;assert scatter.find('.//'+c+'spPr/'+a+'ln/'+a+'noFill') is not None;assert scatter.find('.//'+c+'smooth').attrib['val']=='0';assert chart.find('.//'+c+'legend') is not None
values=[float(n.text) for n in scatter.findall('.//'+c+'yVal/'+c+'numRef/'+c+'numCache/'+c+'pt/'+c+'v')];assert values==[8,2,6];bp=rels(cp)[chart.find(c+'externalData').attrib[r+'id']];book=zipfile.ZipFile(io.BytesIO(z.read(bp)));sheet=E.fromstring(book.read('xl/worksheets/sheet1.xml'));cells={n.attrib['r']:float(n.find(s+'v').text) for n in sheet.findall('.//'+s+'c') if n.find(s+'v') is not None};assert [cells['B'+str(n)] for n in [2,3,4]]==values
assert all(z.read(n)==o.read(n) for n in o.namelist() if n not in ['[Content_Types].xml',part,'ppt/slides/_rels/slide1.xml.rels']);print(json.dumps({'values':values,'scatterWithoutConnectingLine':True,'oldPartsPreserved':True}))`,path,originalPath,elementId],{encoding:'utf8',timeout:15000}));
      const projection=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()});expect(projection.pages).toBe(2);
      const pending={slideId:'256',elementId,chartValues:true as const,text:'8,未完成,'},recoveryId=randomUUID();await service.pptx.checkpoint('owner',{id,version:state.version,draftId:recoveryId,bufferVersion:state.version+1,pending});
      const fresh=await service.refresh('owner',file.ref),verify=randomUUID(),reopened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});expect(reopened.state.info.slides[0].elements!.find(element=>element.id===elementId)!.chart).toMatchObject({type:'scatter',values:[8,2,6],options:{axes:true,gridLines:true,legend:true}});
      const restored=await service.pptx.restore('owner',{id:verify,version:0,draftId:recoveryId});expect(pptxPendingInputs(restored.pending)).toEqual([pending]);service.pptx.close('owner',verify);
      for(let i=0;i<5;i++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect((await OfficePackage.read(readFileSync(path))).hashes()).toEqual((await OfficePackage.read(original)).hashes());
      console.log(JSON.stringify({kind:'packaged-chart',app,savedHash:saved.receipt.revision!.hash,pdfHash:projection.hash,pages:projection.pages,independent,recoveredRawChartInput:true,reopened:true,originalPartsRestored:true}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },120000);
  it('saves tables, measures real cells and restores cleared content using the shipped Worker and helper',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-pptx-tables-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files')),sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX tables',projectId:'tables'}],resolver={sources:()=>sources};
    const worker=join(app!,'Contents/Resources/app.asar/out/main/m9-pptx-document.js'),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},undefined,worker);
    try{
      const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'tables.pptx');writeFileSync(path,original);
      const root=(await service.openScope('owner',{kind:'project',projectId:'tables'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'tables.pptx'}),id=randomUUID(),draftId=randomUUID();
      let {state}=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});const existing=state.info.slides[0].elements!.find(element=>element.table)!.id;
      const first=await service.pptx.render('owner',{id,version:state.version,requestId:randomUUID()});expect(first.tableLayoutError).toBeUndefined();
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'element-transform',slideId:'256',elementId:existing,patch:{height:100}}});
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'table-cell',slideId:'256',elementId:existing,row:2,column:1,text:'PACKAGED_TABLE 中文'}});
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'insert-element',slideId:'256',kind:'table'}});const inserted=state.info.slides[0].elements!.at(-1)!.id;
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'table-cell',slideId:'256',elementId:inserted,row:1,column:0,text:'NEW'}});
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'table-flags',slideId:'256',elementId:inserted,patch:{headerColumn:true}}});
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'table-clear',slideId:'256',elementId:inserted,range:{start:{row:0,column:0},end:{row:2,column:1}}}});
      const cleared=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(cleared.receipt.state).toBe('saved');
      execFileSync('python3',['-c','import sys; from zipfile import ZipFile; from xml.etree import ElementTree as E; A="{http://schemas.openxmlformats.org/drawingml/2006/main}"; z=ZipFile(sys.argv[1]); tables=list(E.fromstring(z.read("ppt/slides/slide1.xml")).iter(A+"tbl")); assert len(tables)==2; assert not "".join(n.text or "" for n in tables[1].iter(A+"t")); assert any(n.text=="PACKAGED_TABLE 中文" for n in tables[0].iter(A+"t"))',path],{timeout:15000});
      state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});
      const saved=await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',[
        'import sys,json; from zipfile import ZipFile; from xml.etree import ElementTree as E',
        'a,b=(ZipFile(p) for p in sys.argv[1:3]); assert set(a.namelist())==set(b.namelist()); assert all(a.read(n)==b.read(n) for n in a.namelist() if n!="ppt/slides/slide1.xml")',
        'A="{http://schemas.openxmlformats.org/drawingml/2006/main}"; tables=list(E.fromstring(b.read("ppt/slides/slide1.xml")).iter(A+"tbl")); assert len(tables)==2; assert any(n.text=="NEW" for n in tables[1].iter(A+"t")); assert tables[1].find(A+"tblPr").get("firstCol")=="1"; assert sum(int(row.get("h")) for row in tables[0].findall(A+"tr"))==1270000',
        'print(json.dumps({"tables":2,"clearUndoVerified":True,"otherPartsUnchanged":True}))',
      ].join('\n'),originalPath,path],{encoding:'utf8',timeout:15000}));
      const requestId=randomUUID(),projection=await service.pptx.render('owner',{id,version:state.version,requestId});expect(projection.pages).toBe(2);expect(projection.tableLayoutError).toBeUndefined();expect(projection.tableLayout!.reduce((sum,item)=>sum+item.cells.length,0)).toBe(12);
      const ys=projection.tableLayout!.find(table=>table.elementId===existing)!.cells.flatMap(cell=>cell.points.map(point=>point[1])),actualHeight=Math.max(...ys)-Math.min(...ys);expect(Math.abs(actualHeight-100)).toBeLessThan(.15);
      const pdf=join(base,'tables.pdf');writeFileSync(pdf,Buffer.from(service.pptx.chunk('owner',id,requestId,0,projection.bytes),'base64'));const text=execFileSync('/opt/homebrew/bin/pdftotext',['-raw',pdf,'-'],{encoding:'utf8',timeout:15000});expect(text).toContain('PACKAGED_TABLE');expect(text).toContain('中文');expect(text).toContain('NEW');
      const pending=[{slideId:'256',elementId:inserted,cell:{row:0,column:0},text:'候选\ud800'},{slideId:'256',elementId:inserted,cell:{row:0,column:1},text:'第二格'},{slideId:'256',text:'备注独立'}],recoveryId=randomUUID();await service.pptx.checkpoint('owner',{id,version:state.version,draftId:recoveryId,bufferVersion:state.version+1,pending});
      const verify=randomUUID(),fresh=await service.refresh('owner',file.ref),reopened=await service.pptx.open('owner',{id:verify,ref:file.ref,baseHash:fresh.revision.hash});expect(reopened.state.info.slides[0].elements!.find(element=>element.id===inserted)!.table!.cells[1][0].text).toBe('NEW');
      const restored=await service.pptx.restore('owner',{id:verify,version:0,draftId:recoveryId});expect(pptxPendingInputs(restored.pending)).toEqual(pending);service.pptx.close('owner',verify);
      for(let i=0;i<5;i++)state=await service.pptx.history('owner',{id,version:state.version,direction:'undo'});
      await service.pptx.save('owner',{id,version:state.version,draftId,bufferVersion:state.version,opId:randomUUID()});
      execFileSync('python3',['-c','import sys,hashlib; from zipfile import ZipFile; h=lambda z:{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}; a,b=(ZipFile(p) for p in sys.argv[1:]); assert h(a)==h(b)',originalPath,path],{timeout:15000});
      console.log(JSON.stringify({kind:'packaged-table',app,savedHash:saved.receipt.revision!.hash,pdfHash:projection.hash,pages:projection.pages,layoutCells:12,actualHeight,independent,recoveredTargets:pending.length,reopened:true,originalPartsRestored:true}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },120000);
  it('saves object text, formatting, appearance and geometry with the shipped Worker and recovers separate raw input targets',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-pptx-objects-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files'));
    const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX',projectId:'pptx'}],resolver={sources:()=>sources};
    const worker=join(app!,'Contents/Resources/app.asar/out/main/m9-pptx-document.js');
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},undefined,worker);
    try{
      const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'objects.pptx');writeFileSync(path,original);
      const root=(await service.openScope('owner',{kind:'project',projectId:'pptx'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'objects.pptx'}),id=randomUUID(),draftId=randomUUID();
      const opened=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});expect(opened.state.info.slides[0].elements?.find(element=>element.name==='Title 1')?.boxSource??opened.state.info.slides[0].elements?.find(element=>element.text==='MASTER_TITLE')?.boxSource).toBe('master');
      let state=await service.pptx.edit('owner',{id,version:0,action:{type:'insert-element',slideId:'256',kind:'text'}});const elementId=state.info.slides[0].elements!.at(-1)!.id;
      state=await service.pptx.edit('owner',{id,version:state.version,action:{type:'element-transform',slideId:'256',elementId,patch:{x:60,y:300,width:350,height:50,rotation:0}}});
      const pending=[{slideId:'256',elementId,text:'候选\ud800'},{slideId:'256',text:'恢复备注'}];
      await service.pptx.checkpoint('owner',{id,version:state.version,draftId,bufferVersion:3,pending});expect(readFileSync(path).equals(original)).toBe(true);
      service.pptx.close('owner',id);const next=randomUUID();await service.pptx.open('owner',{id:next,ref:file.ref,baseHash:file.revision.hash});
      const restored=await service.pptx.restore('owner',{id:next,version:0,draftId});expect(pptxPendingInputs(restored.pending)).toEqual(pending);state=restored.state;
      state=await service.pptx.edit('owner',{id:next,version:state.version,action:{type:'element-text',slideId:'256',elementId,text:'PACKAGED_OBJECT 中文😀'}});
      state=await service.pptx.edit('owner',{id:next,version:state.version,action:{type:'notes',slideId:'256',text:'PACKAGED_NOTES independent'}});
      state=await service.pptx.edit('owner',{id:next,version:state.version,action:{type:'element-format',slideId:'256',elementId,patch:{font:{family:'Arial',points:24,bold:true,underline:true,color:'#c01020'},list:'number',align:'center'}}});
      state=await service.pptx.edit('owner',{id:next,version:state.version,action:{type:'element-appearance',slideId:'256',elementId,patch:{fill:'#e1f0eb',border:true,borderStyle:'dashed',shadow:true}}});
      const saved=await service.pptx.save('owner',{id:next,version:state.version,draftId,bufferVersion:7,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',[
        'import sys,json,hashlib; from zipfile import ZipFile; from xml.etree import ElementTree as E',
        'P="{http://schemas.openxmlformats.org/presentationml/2006/main}"; A="{http://schemas.openxmlformats.org/drawingml/2006/main}"',
        'a,b=(ZipFile(p) for p in sys.argv[1:3])',
        'assert set(a.namelist())==set(b.namelist())',
        'assert all(a.read(n)==b.read(n) for n in a.namelist() if n not in ["ppt/slides/slide1.xml","ppt/notesSlides/notesSlide1.xml"])',
        'slide=E.fromstring(b.read("ppt/slides/slide1.xml")); shape=next(s for s in slide.iter(P+"sp") if any(n.get("id")==sys.argv[3] for n in s.iter(P+"cNvPr")))',
        'off=shape.find("./"+P+"spPr/"+A+"xfrm/"+A+"off")',
        'props=shape.find(P+"spPr"); assert props.find(A+"solidFill/"+A+"srgbClr").get("val")=="E1F0EB"; assert props.find(A+"ln/"+A+"prstDash").get("val")=="dash"; assert props.find(A+"effectLst/"+A+"outerShdw") is not None',
        'rpr=shape.find("./"+P+"txBody/"+A+"p/"+A+"r/"+A+"rPr"); assert rpr.get("sz")=="2400" and rpr.get("b")=="1" and rpr.get("u")=="sng"',
        'assert rpr.find(A+"latin").get("typeface")=="Arial" and rpr.find(A+"ea") is None',
        'print(json.dumps({"text":"".join(t.text or "" for t in shape.iter(A+"t")),"x":int(off.get("x")),"y":int(off.get("y")),"otherPartsUnchanged":True},ensure_ascii=False))',
      ].join('\n'),originalPath,path,elementId],{encoding:'utf8',timeout:15000}));
      expect(independent).toEqual({text:'PACKAGED_OBJECT 中文😀',x:60*12700,y:300*12700,otherPartsUnchanged:true});
      const rendered=await service.pptx.render('owner',{id:next,version:state.version,requestId:randomUUID()});expect(rendered.pages).toBe(2);
      service.pptx.close('owner',next);const fresh=await service.refresh('owner',file.ref),reopened=await service.pptx.open('owner',{id:randomUUID(),ref:file.ref,baseHash:fresh.revision.hash});
      expect(reopened.state.info.slides[0].elements?.find(element=>element.id===elementId)).toMatchObject({text:'PACKAGED_OBJECT 中文😀',appearance:{fill:'#e1f0eb',border:true,borderStyle:'dashed',shadow:true},textStyle:{family:'Arial',points:24,bold:true,underline:true,color:'#c01020',align:'center',list:'number'},box:{x:60,y:300,width:350,height:50},pageBox:{x:60,y:300,width:350,height:50}});
      expect(reopened.state.info.slides[0].notes).toBe('PACKAGED_NOTES independent');expect(reopened.state.dirty).toBe(false);
      console.log(JSON.stringify({app,worker:'app.asar/out/main/m9-pptx-document.js',sourceHash:digest(original),savedHash:fresh.revision.hash,pdfHash:rendered.hash,pages:rendered.pages,targetsRecovered:pending.length,independentZipXmlRead:true,textFormattingVerified:true,appearanceVerified:true,reopened:true}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },90000);
  it('deletes a private chart closure, preserves the rest and restores original parts with the shipped Worker',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-pptx-delete-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files'));
    const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX',projectId:'pptx'}],resolver={sources:()=>sources},worker=join(app!,'Contents/Resources/app.asar/out/main/m9-pptx-document.js');
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},undefined,worker);
    try{
      const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'delete.pptx');writeFileSync(path,original);
      const root=(await service.openScope('owner',{kind:'project',projectId:'pptx'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'delete.pptx'}),id=randomUUID(),draftId=randomUUID();
      const opened=await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash}),elementId=opened.state.info.slides[0].elements!.find(element=>element.kind==='chart')!.id;
      await service.pptx.edit('owner',{id,version:0,action:{type:'element-delete',slideId:'256',elementId}});
      const saved=await service.pptx.save('owner',{id,version:1,draftId,bufferVersion:1,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const independent=JSON.parse(execFileSync('python3',['-c',[
        'import sys,json,hashlib; from zipfile import ZipFile; from xml.etree import ElementTree as E',
        'a,b=(ZipFile(p) for p in sys.argv[1:3]); removed=set(a.namelist())-set(b.namelist()); assert removed=={"ppt/charts/chart1.xml","ppt/charts/_rels/chart1.xml.rels","ppt/embeddings/chart-data.xlsx"}',
        'changed={"ppt/slides/slide1.xml","ppt/slides/_rels/slide1.xml.rels","[Content_Types].xml"}; assert all(a.read(n)==b.read(n) for n in b.namelist() if n not in changed)',
        'P="{http://schemas.openxmlformats.org/presentationml/2006/main}"; A="{http://schemas.openxmlformats.org/drawingml/2006/main}"',
        'root=E.fromstring(b.read("ppt/slides/slide1.xml")); assert all(n.get("id")!=sys.argv[3] for n in root.iter(P+"cNvPr")); assert any(n.text=="MASTER_TITLE" for n in root.iter(A+"t"))',
        'print(json.dumps({"removed":sorted(removed),"unrelatedPartsUnchanged":True}))',
      ].join('\n'),originalPath,path,elementId],{encoding:'utf8',timeout:15000}));
      const rendered=await service.pptx.render('owner',{id,version:1,requestId:randomUUID()});expect(rendered.pages).toBe(2);
      const verifyId=randomUUID(),fresh=await service.refresh('owner',file.ref),reopened=await service.pptx.open('owner',{id:verifyId,ref:file.ref,baseHash:fresh.revision.hash});expect(reopened.state.info.slides[0].elements!.some(element=>element.id===elementId)).toBe(false);service.pptx.close('owner',verifyId);
      await service.pptx.history('owner',{id,version:1,direction:'undo'});await service.pptx.save('owner',{id,version:2,draftId,bufferVersion:2,opId:randomUUID()});
      execFileSync('python3',['-c','import sys,hashlib; from zipfile import ZipFile; h=lambda z:{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}; a,b=(ZipFile(p) for p in sys.argv[1:]); assert h(a)==h(b)',originalPath,path],{timeout:15000});
      console.log(JSON.stringify({app,worker:'app.asar/out/main/m9-pptx-document.js',sourceHash:digest(original),deletedHash:saved.receipt.revision!.hash,pdfHash:rendered.hash,pages:rendered.pages,independent,reopenedWithoutDeletedObject:true,originalPartsRestored:true}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },90000);
  it('saves structural edits and exact dependency restoration using the shipped PPTX Worker',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-pptx-structure-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files'));
    const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX',projectId:'pptx'}],resolver={sources:()=>sources};
    const worker=join(app!,'Contents/Resources/app.asar/out/main/m9-pptx-document.js');
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},undefined,worker);
    try{
      const originalPath=resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'),original=readFileSync(originalPath),path=join(project,'structure.pptx');writeFileSync(path,original);
      const root=(await service.openScope('owner',{kind:'project',projectId:'pptx'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'structure.pptx'}),id=randomUUID(),draftId=randomUUID();
      await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      const copied=await service.pptx.edit('owner',{id,version:0,action:{type:'duplicate',slideId:'256'}}),copyId=copied.info.slides[1].id;
      const added=await service.pptx.edit('owner',{id,version:1,action:{type:'add',slideId:'256'}}),newId=added.info.slides.at(-1)!.id;
      const saved=await service.pptx.save('owner',{id,version:2,draftId,bufferVersion:2,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');
      const rendered=await service.pptx.render('owner',{id,version:2,requestId:randomUUID()});expect(rendered.pages).toBe(4);
      await service.pptx.edit('owner',{id,version:2,action:{type:'delete',slideId:copyId}});await service.pptx.edit('owner',{id,version:3,action:{type:'delete',slideId:newId}});
      const restored=await service.pptx.save('owner',{id,version:4,draftId,bufferVersion:4,opId:randomUUID()});expect(restored.receipt.state).toBe('saved');
      execFileSync('python3',['-c','import sys,hashlib; from zipfile import ZipFile; h=lambda z:{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}; a,b=(ZipFile(p) for p in sys.argv[1:]); assert h(a)==h(b)',originalPath,path],{timeout:15000});
      service.pptx.close('owner',id);const fresh=await service.refresh('owner',file.ref),reopened=await service.pptx.open('owner',{id:randomUUID(),ref:file.ref,baseHash:fresh.revision.hash});
      expect(reopened.state.info.slides.map(slide=>slide.id)).toEqual(['256','257']);expect(reopened.state.dirty).toBe(false);
      expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
      console.log(JSON.stringify({app,worker:'app.asar/out/main/m9-pptx-document.js',structureSavedHash:saved.receipt.revision!.hash,restoredSavedHash:fresh.revision.hash,pdfHash:rendered.hash,pages:rendered.pages,independentOriginalPartHashesRestored:true,reopened:true}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },90000);
  it('saves and reopens edits with the shipped PPTX Worker and native helper',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-pptx-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files'));
    const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'PPTX',projectId:'pptx'}],resolver={sources:()=>sources};
    const worker=join(app!,'Contents/Resources/app.asar/out/main/m9-pptx-document.js');
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},undefined,worker);
    try{
      const original=readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')),path=join(project,'sample.pptx');writeFileSync(path,original);
      const root=(await service.openScope('owner',{kind:'project',projectId:'pptx'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'sample.pptx'}),id=randomUUID();
      await service.pptx.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});
      await service.pptx.edit('owner',{id,version:0,action:{type:'notes',slideId:'256',text:'PACKAGED_NOTES 中文😀'}});
      await service.pptx.edit('owner',{id,version:1,action:{type:'hidden',slideId:'256',hidden:true}});
      await service.pptx.edit('owner',{id,version:2,action:{type:'background',slideId:'256',color:'#1b9c7d'}});
      const saved=await service.pptx.save('owner',{id,version:3,draftId:randomUUID(),bufferVersion:3,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');expect(saved.state.dirty).toBe(false);
      const candidate=readFileSync(path);expect(digest(candidate)).toBe(saved.receipt.revision!.hash);
      const originalParts=(await OfficePackage.read(original)).hashes(),savedParts=(await OfficePackage.read(candidate)).hashes();
      for(const name of Object.keys(originalParts))if(!['ppt/slides/slide1.xml','ppt/notesSlides/notesSlide1.xml'].includes(name))expect(savedParts[name],name).toBe(originalParts[name]);
      const independent=JSON.parse(execFileSync('python3',['-c',[
        'import json,sys',
        'from zipfile import ZipFile',
        'from xml.etree import ElementTree as E',
        'A="{http://schemas.openxmlformats.org/drawingml/2006/main}"',
        'P="{http://schemas.openxmlformats.org/presentationml/2006/main}"',
        'with ZipFile(sys.argv[1]) as z:',
        ' slide=E.fromstring(z.read("ppt/slides/slide1.xml"));note=E.fromstring(z.read("ppt/notesSlides/notesSlide1.xml"))',
        ' body=next(s for s in note.iter(P+"sp") if any(ph.get("type")=="body" for ph in s.iter(P+"ph")))',
        ' print(json.dumps({"notes":"".join(t.text or "" for t in body.iter(A+"t")),"hidden":slide.get("show")=="0","color":slide.find("./"+P+"cSld/"+P+"bg/"+P+"bgPr/"+A+"solidFill/"+A+"srgbClr").get("val")},ensure_ascii=False))',
      ].join('\n'),path],{encoding:'utf8',timeout:15000}));expect(independent).toEqual({notes:'PACKAGED_NOTES 中文😀',hidden:true,color:'1B9C7D'});
      const requestId=randomUUID(),rendered=await service.pptx.render('owner',{id,version:3,requestId});expect(rendered.pages).toBe(2);
      const pdf=Buffer.from(service.pptx.chunk('owner',id,requestId,0,rendered.bytes),'base64');expect(digest(pdf)).toBe(rendered.hash);
      service.pptx.close('owner',id);const fresh=await service.refresh('owner',file.ref),reopened=await service.pptx.open('owner',{id:randomUUID(),ref:file.ref,baseHash:fresh.revision.hash});
      expect(reopened.state.info.slides[0]).toMatchObject({notes:'PACKAGED_NOTES 中文😀',hidden:true,background:'#1b9c7d'});expect(reopened.state.dirty).toBe(false);
      expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
      console.log(JSON.stringify({app,worker:'app.asar/out/main/m9-pptx-document.js',sourceHash:digest(original),savedHash:digest(candidate),pdfHash:rendered.hash,pages:rendered.pages,elapsedMs:rendered.elapsedMs,independentZipXmlRead:true,reopened:true}));
    }finally{service.closeOwner('owner');service.pptx.dispose();service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },90000);
  it('renders both formats with the shipped runtime and helper, without changing source packages',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-lo-packaged-'))),userData=join(base,'userdata');mkdirSync(userData);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files'));
    const engine=new LibreOfficeEngine(broker,{userData,directory:join(native,'libreoffice'),packagePath:app!},new FileHeavyJobs());
    try {
      const zip=new ZipFile();
      zip.addBuffer(Buffer.from(`<Types xmlns="${OPC_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),'[Content_Types].xml');
      zip.addBuffer(Buffer.from(`<Relationships xmlns="${OPC_REL}"><Relationship Id="r1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/></Relationships>`),'_rels/.rels');
      zip.addBuffer(Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>WillYou packaged DOCX 中文 😀</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'),'word/document.xml');
      zip.end();const chunks:Buffer[]=[];for await(const chunk of zip.outputStream)chunks.push(Buffer.from(chunk));
      for(const [format,bytes,pages] of [['docx',Buffer.concat(chunks),1],['pptx',readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')),2]] as const){
        const original=digest(bytes),file=await OfficePackage.read(bytes);expect(new OfficeRelationships(file).kind).toBe(format);
        for(const name of file.names().filter(name=>name.endsWith('.xml')))new OfficeXml(file.read(name));
        const result=await engine.render(bytes,format,new AbortController().signal);
        expect(result.pages).toBe(pages);expect(digest(result.bytes)).toBe(result.hash);expect(digest(bytes)).toBe(original);
        expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
        console.log(JSON.stringify({app,format,sourceHash:original,pages:result.pages,pdfBytes:result.bytes.length,pdfHash:result.hash,elapsedMs:result.elapsedMs,peakRssBytes:result.peakRssBytes}));
      }
    } finally {engine.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },120000);
  it('uses the shipped Worker and native helper through real local FileService including hidden slides',async()=>{
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-pages-packaged-'))),userData=join(base,'userdata'),project=join(base,'project');mkdirSync(userData);mkdirSync(project);
    const native=join(app!,'Contents/Resources/native'),broker=new NativeFileBroker(join(native,'willyou-files'));
    const sources=[{kind:'project-directory' as const,id:'dir',path:project,label:'Pages',projectId:'pages'}],resolver={sources:()=>sources};
    const service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver),undefined,undefined,undefined,undefined,undefined,{userData,directory:join(native,'libreoffice'),packagePath:app!},join(app!,'Contents/Resources/app.asar/out/main/m9-office-pages.js'));
    try {
      const source=await OfficePackage.read(readFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'))),part='ppt/slides/slide1.xml',xml=new OfficeXml(source.read(part));
      const hidden=source.patch(new Map([[part,xml.edit([xml.setAttribute(xml.root,'show','0')])]]),{changed:[part],added:[],removed:[]}),bytes=await hidden.bytes();
      const {writeFileSync}=await import('node:fs');writeFileSync(join(project,'hidden.pptx'),bytes);
      const root=(await service.openScope('owner',{kind:'project',projectId:'pages'})).roots[0],file=await service.open('owner',{lease:root.lease,generation:root.generation,relativePath:'hidden.pptx'}),id=randomUUID();
      const result=await service.officePages.open('owner',{id,ref:file.ref,baseHash:file.revision.hash});expect(result.pages).toBe(2);expect(result.info.slides[0].hidden).toBe(true);expect(result.info.slides[0].notes).toBe('SLIDE_ONE_NOTES');
      const pdf=Buffer.from(service.officePages.chunk('owner',id,0,result.bytes),'base64');expect(digest(pdf)).toBe(result.hash);expect(digest(readFileSync(join(project,'hidden.pptx')))).toBe(digest(bytes));
      if(process.env.SMARTDD_M9_PDFTEXT){
        const output=join(base,'projection.pdf');writeFileSync(output,pdf);
        const text=execFileSync(process.env.SMARTDD_M9_PDFTEXT,['-layout',output,'-'],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024}).split('\f');
        expect(text[0]).toContain('MASTER_TITLE');expect(text[0]).toContain('TABLE_EDITED');expect(text[0]).not.toContain('OTHER_SLIDE');
        expect(text[1]).toContain('OTHER_SLIDE');expect(text[1]).toContain('UNCHANGED_SLIDE');expect(text.join('')).not.toContain('SLIDE_ONE_NOTES');
      }
      service.closeOwner('owner');expect(service.officePages.activeDocuments).toBe(0);expect(readdirSync(join(userData,'m9-office-jobs'))).toEqual([]);
      console.log(JSON.stringify({app,worker:'app.asar/out/main/m9-office-pages.js',pages:result.pages,hidden:result.info.slides[0].hidden,pdfHash:result.hash,pdfBytes:result.bytes,elapsedMs:result.elapsedMs,sourceUnchanged:true,independentPdfTextChecked:!!process.env.SMARTDD_M9_PDFTEXT}));
    } finally {service.closeOwner('owner');service.officePages.dispose();service.office.dispose();service.tex.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});}
  },90000);
});
