import { FileError } from '@shared/files';
import { OFFICE_LIMITS } from '@shared/file-office';
import type { PptxTableLayout,PptxTablePoint } from '@shared/file-pptx-table';
import { OfficePagesModel } from './pages-model';
import { OfficePackage } from './package';
import { OFFICE_REL,STRICT_REL } from './relationships';
import { OfficeXml,attribute,children,type OfficeXmlNode,type XmlEdit } from './xml';
import { drawingNamespace,pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';
import { pptxTableNode } from './pptx-table';

interface Marker {slideId:string;elementId:string;row:number;column:number}
export interface PptxTableLayoutSource {packageData:OfficePackage;markers:Map<string,Marker>;width:number;height:number}
const fillKinds=new Set(['solidFill','noFill','gradFill','blipFill','pattFill','grpFill']);
const SVG='http://www.w3.org/2000/svg';
const bad=(message:string):never=>{throw new FileError('UNSUPPORTED',`表格排版位置无法确认：${message}`);};

/** Only a disposable rendering clone receives opaque identity fills. Never
 * put this package into source history, recovery, or a save candidate. */
export function pptxTableLayoutSource(model:OfficePagesModel):PptxTableLayoutSource{
  if(model.info.kind!=='pptx')throw new FileError('UNSUPPORTED','表格布局只接受演示文稿');
  const main=new OfficeXml(model.packageData.read(model.graph.mainPart)),entries=children(children(main.root,'sldIdLst')[0],'sldId'),markers=new Map<string,Marker>(),replacements=new Map<string,Buffer>();
  for(const entry of entries){
    const slideId=attribute(entry,'id')!,slide=model.info.slides.find(slide=>slide.id===slideId)!;
    const targets=slide.elements?.filter(element=>element.table&&!element.hidden);if(!targets?.length)continue;
    const part=model.graph.target(model.graph.mainPart,(attribute(entry,'id',OFFICE_REL)??attribute(entry,'id',STRICT_REL))!),doc=new OfficeXml(model.packageData.read(part)),drawing=drawingNamespace(doc.root.uri),nodes=pptxDrawingNodes(pptxShapeTree(doc)),edits:XmlEdit[]=[];
    // SVG's all-page export omits hidden slides, while our PDF preview includes
    // them. Expose them only in this disposable measurement clone.
    if(slide.hidden)edits.push(doc.setAttribute(doc.root,'show','1'));
    for(const element of targets){
      const node=nodes.find(row=>pptxShapeId(row.node)===element.id)!.node,table=pptxTableNode(node,drawing)!;
      for(const [row,tr] of children(table,'tr',drawing).entries())for(const [column,tc] of children(tr,'tc',drawing).entries()){
        const cell=element.table!.cells[row][column];if(cell.horizontalMerge||cell.verticalMerge)continue;
        if(markers.size>=65536)throw new FileError('TOO_LARGE','表格定位单元格超过预算');
        const color=(0x010000+markers.size+1).toString(16).padStart(6,'0');markers.set(color,{slideId,elementId:element.id,row,column});
        const props=children(tc,'tcPr',drawing)[0],fill=`<a:solidFill xmlns:a="${drawing}"><a:srgbClr val="${color.toUpperCase()}"/></a:solidFill>`;
        if(!props){const at=children(tc,'extLst',drawing)[0]?.start??tc.closeStart;edits.push({start:at,end:at,value:`<a:tcPr xmlns:a="${drawing}">${fill}</a:tcPr>`});continue;}
        const old=props.children.filter(child=>child.uri===drawing&&fillKinds.has(child.local));
        if(old.length){edits.push({start:old[0].start,end:old[0].end,value:fill},...old.slice(1).map(child=>({start:child.start,end:child.end,value:''})));}
        else if(props.selfClosing)edits.push(doc.replaceContent(props,fill));
        else{const at=props.children.find(child=>child.uri===drawing&&['headers','extLst'].includes(child.local))?.start??props.closeStart;edits.push({start:at,end:at,value:fill});}
      }
    }
    if(edits.length)replacements.set(part,doc.edit(edits));
  }
  return {packageData:replacements.size?model.packageData.patch(replacements,{changed:[...replacements.keys()],added:[],removed:[]}):model.packageData,markers,width:model.info.width!,height:model.info.height!};
}

/** The fixed SVG export supplies polygons, including auto-height cells. It is
 * parsed in the document Worker and never inserted into a browser or executed.
 * Strip only the exporter’s exact inert external declaration; all other DTDs
 * and entities remain rejected by the existing strict SAX parser. */
export function readPptxTableLayout(bytes:Uint8Array,source:Pick<PptxTableLayoutSource,'markers'|'width'|'height'>):PptxTableLayout[]{
  if(bytes.byteLength>OFFICE_LIMITS.partBytes)throw new FileError('TOO_LARGE','表格布局投影超过解析预算');
  let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new FileError('INVALID_INPUT','表格布局编码无效');}
  raw=raw.replace(/^(\s*<\?xml[^?]*\?>\s*)<!DOCTYPE svg PUBLIC "-\/\/W3C\/\/DTD SVG 1\.1\/\/EN" "http:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd">/,'$1');
  const doc=new OfficeXml(Buffer.from(raw)),root=doc.root;if(root.uri!==SVG||root.local!=='svg')bad('不是原生 SVG 输出');
  const view=(attribute(root,'viewBox')??'').trim().split(/\s+/).map(Number);
  if(view.length!==4||view.some(value=>!Number.isFinite(value))||view[0]!==0||view[1]!==0||view[2]<=0||view[3]<=0)bad('画布坐标无效');
  const scaleX=source.width/view[2],scaleY=source.height/view[3];
  if(!Number.isFinite(scaleX)||!Number.isFinite(scaleY)||scaleX<=0||scaleY<=0||Math.abs(scaleX/scaleY-1)>.001)bad('画布纵横比改变');
  const found=new Map<string,PptxTableLayout>(),seen=new Set<string>();
  const walk=(node:OfficeXmlNode,inTable:boolean,transformed:boolean)=>{
    const table=inTable||node.uri===SVG&&node.local==='g'&&attribute(node,'class')==='com.sun.star.drawing.TableShape';
    const transform=transformed||Boolean(attribute(node,'transform'));
    if(table&&node.uri===SVG&&node.local==='path'){
      const rgb=/^rgb\((\d+),(\d+),(\d+)\)$/.exec(attribute(node,'fill')??'');
      if(rgb&&rgb.slice(1).every(value=>Number(value)<=255)){
        const color=rgb.slice(1).map(value=>Number(value).toString(16).padStart(2,'0')).join(''),marker=source.markers.get(color);
        if(marker){
          if(seen.has(color))bad('单元格标记重复');if(transform)bad('投影包含未适配的坐标变换');
          const d=attribute(node,'d')??'';
          // Only the fixed exporter’s closed four-sided cell path is accepted.
          const number='[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)',pair=`(${number})[, ]+(${number})`;
          const pattern=new RegExp(`^\\s*M\\s*${pair}\\s+L\\s*${pair}\\s+${pair}\\s+${pair}\\s+${pair}\\s+Z\\s*$`),match=pattern.exec(d);
          if(!match)bad('单元格边界格式不明确');
          const values=match!.slice(1).map(Number);if(values.some(value=>!Number.isFinite(value)||Math.abs(value)>100000000)||values[0]!==values[8]||values[1]!==values[9])bad('单元格边界没有闭合');
          const points=Array.from({length:4},(_,i)=>[values[i*2]*scaleX,values[i*2+1]*scaleY] as PptxTablePoint) as [PptxTablePoint,PptxTablePoint,PptxTablePoint,PptxTablePoint];
          if(points.some(point=>point.some(value=>!Number.isFinite(value)||Math.abs(value)>1000000)))bad('单元格坐标超出预算');
          const [a,b,c,e]=points,cross=(b[0]-a[0])*(e[1]-a[1])-(b[1]-a[1])*(e[0]-a[0]);
          if(Math.abs(cross)<.000001||Math.abs(c[0]-(b[0]+e[0]-a[0]))>.1||Math.abs(c[1]-(b[1]+e[1]-a[1]))>.1)bad('单元格不是可定位的四边形');
          const key=`${marker.slideId}/${marker.elementId}`,layout=found.get(key)??{slideId:marker.slideId,elementId:marker.elementId,cells:[]};
          layout.cells.push({row:marker.row,column:marker.column,points});found.set(key,layout);seen.add(color);
        }
      }
    }
    for(const child of node.children)walk(child,table,transform);
  };
  walk(root,false,false);if(seen.size!==source.markers.size)bad('存在未定位的单元格');
  const result=[...found.values()];if(Buffer.byteLength(JSON.stringify(result))>2*1024*1024)throw new FileError('TOO_LARGE','表格布局元数据超过预算');return result;
}
