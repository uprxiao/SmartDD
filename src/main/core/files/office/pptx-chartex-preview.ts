import { FileError } from '@shared/files';
import { OfficePackage } from './package';
import type { OfficePagesModel } from './pages-model';
import { OfficeRelationships,OFFICE_REL,STRICT_REL,relationshipKind } from './relationships';
import { OfficeXml,attribute,children,descendants,copyOfficeNode,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';
import { verifyModernChartWorkbook } from './pptx-chart-workbook';
import { modernChartSource } from './pptx-chartex-data';
import { modernChartDisplay } from './pptx-chartex-display';
import { CHARTEX,unsupportedOfficeCharts } from './preview-capabilities';
import { drawingNamespace,pptxBox,pptxDrawingNodes,pptxShapeTree } from './pptx-elements';

const fail=(message:string):never=>{throw new FileError('UNSUPPORTED',`此图表预览尚未接入：${message}。原图表保留。`);};
const one=(node:OfficeXmlNode,name:string,ns=node.uri)=>{const found=children(node,name,ns);if(found.length!==1)fail('对象结构缺失或重复');return found[0];};

/** This package is a disposable native layout input. Source chart parts,
 * embedded workbooks, drafts and undo/save history must never use it. */
export async function pptxChartPreviewSource(model:OfficePagesModel):Promise<OfficePackage>{
  const file=model.packageData,graph=model.graph;
  if(model.info.kind!=='pptx')throw new FileError('UNSUPPORTED','图表布局只接受演示文稿');
  if(!model.info.unsupportedCharts?.length)return file;
  const main=new OfficeXml(file.read(graph.mainPart)),entries=children(one(main.root,'sldIdLst'),'sldId'),changes=new Map<string,Buffer>(),verifiedSources=new Set<string>();
  for(const entry of entries){
    const part=graph.target(graph.mainPart,(attribute(entry,'id',OFFICE_REL)??attribute(entry,'id',STRICT_REL))!),doc=new OfficeXml(file.read(part)),tree=pptxShapeTree(doc),drawing=drawingNamespace(doc.root.uri),edits:XmlEdit[]=[];
    const ids=new Set(descendants(tree,'cNvPr',doc.root.uri).map(node=>Number(attribute(node,'id'))));let nextId=1;
    const allocate=()=>{while(ids.has(nextId))nextId++;if(nextId>4294967295)throw new FileError('TOO_LARGE','图表布局对象编号已满');ids.add(nextId);return nextId++;};
    for(const {node} of pptxDrawingNodes(tree)){
      if(node.local!=='graphicFrame')continue;
      const graphic=children(node,'graphic',drawing)[0],frame=graphic&&children(graphic,'graphicData',drawing)[0];if(!frame||attribute(frame,'uri')!==CHARTEX)continue;
      const source=modernChartSource(graph,part,frame,name=>new OfficeXml(file.read(name))),display=modernChartDisplay(source);
      if(graph.forPart(source.part).some(row=>!relationshipKind(row.type,'package')))fail('关联主题或样式尚未适配');
      const bookPart=source.embedded.part!,proof=JSON.stringify([bookPart,source.formula,source.values,display.categoryFormula,display.labels]);
      // Keep only the small proof for identical sources. Retaining every parsed
      // embedded workbook would multiply the memory budget across chart objects.
      if(!verifiedSources.has(proof)){
        await verifyModernChartWorkbook(file,source,display);
        verifiedSources.add(proof);
      }
      const transform=one(node,'xfrm'),box=pptxBox(transform,drawing);if(!box||box.width<=0||box.height<=0)fail('图表坐标未明确');
      if(transform.children.some(child=>child.uri!==drawing||!['off','ext'].includes(child.local)))fail('图表变换尚未适配');
      const common=one(node,'nvGraphicFramePr'),identity=copyOfficeNode(doc,one(common,'cNvPr')),nvPr=copyOfficeNode(doc,one(common,'nvPr'));
      const attrs=['rot','flipH','flipV'].flatMap(name=>{const value=attribute(transform,name);return value===undefined?[]:[` ${name}="${xmlEscape(value)}"`];}).join('');
      const tx=`<a:xfrm${attrs}>${copyOfficeNode(doc,one(transform,'off',drawing))}${copyOfficeNode(doc,one(transform,'ext',drawing))}<a:chOff x="0" y="0"/><a:chExt cx="2200000" cy="1300000"/></a:xfrm>`;
      const shape=(name:string,x:number,y:number,width:number,height:number,properties:string,text='')=>`<p:sp><p:nvSpPr><p:cNvPr id="${allocate()}" name="${xmlEscape(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x*10000)}" y="${Math.round(y*10000)}"/><a:ext cx="${Math.max(1,Math.round(width*10000))}" cy="${Math.max(1,Math.round(height*10000))}"/></a:xfrm>${properties}</p:spPr>${text}</p:sp>`;
      const rect=(name:string,x:number,y:number,width:number,height:number,color:string)=>shape(name,x,y,width,height,`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln>`);
      const stroke=(name:string,x:number,y:number,width:number,height:number,style:{color:string;width:number})=>shape(name,x,y,width,height,`<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="${style.width}"><a:solidFill><a:srgbClr val="${style.color}"/></a:solidFill></a:ln>`);
      const content:string[]=[];
      for(const axis of display.axes)if(axis.grid)for(const y of [25,53,81,110])content.push(stroke('Chart grid',12,y,198,0,axis.grid));
      display.rectangles.forEach((row,index)=>{if(row.width>0&&row.height>0)content.push(rect(`Chart value ${index+1}`,row.x,row.y,row.width,row.height,display.colors[row.pointIndex%display.colors.length]));});
      for(const axis of display.axes)if(!axis.hidden)content.push(stroke('Chart axis',12,axis.horizontal?112:10,axis.horizontal?198:0,axis.horizontal?0:102,axis.line));
      if(display.legend){
        const {font}=display,text=display.rectangles.map(row=>row.label).join(' · ');
        // Text is escaped source category data, never placeholder or HTML.
        const body=`<p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="${font.size}"><a:solidFill><a:srgbClr val="${font.color}"/></a:solidFill><a:latin typeface="${xmlEscape(font.family)}"/></a:rPr><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody>`;
        content.push(shape('Chart legend',12,115,198,15,'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>',body));
      }
      const group=`<p:grpSp xmlns:p="${doc.root.uri}" xmlns:a="${drawing}"><p:nvGrpSpPr>${identity}<p:cNvGrpSpPr/>${nvPr}</p:nvGrpSpPr><p:grpSpPr>${tx}</p:grpSpPr>${content.join('')}</p:grpSp>`;
      edits.push({start:node.start,end:node.end,value:group});
    }
    if(edits.length)changes.set(part,doc.edit(edits));
  }
  const candidate=changes.size?file.patch(changes,{changed:[...changes.keys()],added:[],removed:[]}):file;
  const remaining=unsupportedOfficeCharts(new OfficeRelationships(candidate),part=>new OfficeXml(candidate.read(part)));
  if(remaining.length)fail('仍有不支持的图表来源或布局');
  return candidate;
}
