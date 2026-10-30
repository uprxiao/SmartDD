import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {FileError} from '@shared/files';
import type {OfficeRange,OfficePartPlan} from '@shared/file-office';
import {PPTX_BASIC_CHARTS,type PptxBasicChart} from '@shared/file-pptx-chart';
import {WORKBOOK_SHAPES,workbookTextFrameSchema,type WorkbookShape} from '@shared/file-workbook-drawing';
import type {PptxImageInput} from '@shared/file-pptx-image';
import {OfficePackage} from './package';
import {OfficeWorkbook,officeCellAddress} from './workbook';
import {OfficeXml,attribute,children,descendants,xmlEscape,type OfficeXmlNode,type XmlEdit} from './xml';
import {OFFICE_REL,STRICT_REL,OPC_REL,relationshipKind,relationshipPart} from './relationships';
import {officePrefix} from './worksheet-edits';
import {checkOfficeRange} from './range';
import {basicChartPlot,basicChartSeries,basicChartAxes} from './pptx-chart-create';
import {pptxImageBytes,pptxImageReceiptSchema,type PptxImageReceipt} from './pptx-image';
import {validatePptxImageContainer} from './pptx-image-container';
import {encodeOfficeString} from './xstring';

/** Internal mutation input. Public IPC validation and native decoding belong to
 * the owning service; this module also checks every value before creating XML. */
export type WorkbookDrawingInsert={sheetId:string;range:OfficeRange}&(
  {kind:'shape';shape:WorkbookShape}|
  {kind:'chart';chartType:PptxBasicChart}|
  {kind:'image';image:PptxImageInput}|{kind:'text';frame:{x:number;y:number;width:number;height:number};autoSize:boolean}
);
const XDR='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',DRAW='http://schemas.openxmlformats.org/drawingml/2006/main',CHART='http://schemas.openxmlformats.org/drawingml/2006/chart';
const TYPE={drawing:'application/vnd.openxmlformats-officedocument.drawing+xml',chart:'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'};
const emu=(pixels:number)=>Math.round(pixels*9525);
const text=(value:string)=>xmlEscape(encodeOfficeString(value));
const append=(doc:OfficeXml,node:OfficeXmlNode,value:string):XmlEdit=>node.selfClosing?doc.replaceContent(node,value):{start:node.closeStart,end:node.closeStart,value};
const unsupported=(message:string):never=>{throw new FileError('UNSUPPORTED',message);};
const invalid=(message:string):never=>{throw new FileError('INVALID_INPUT',message);};
const absolute=(row:number,column:number)=>officeCellAddress(row,column).replace(/^([A-Z]+)(\d+)$/,'$$$1$$$2');

/** Chart sources are the real selected worksheet cells, never seeded demo data.
 * Two or more columns use the first as categories/X; subsequent numeric columns
 * are separate series. A single column uses row numbers as categories. */
export function workbookChartData(model:OfficeWorkbook,sheetId:string,range:OfficeRange,type:PptxBasicChart){
  checkOfficeRange(range);
  if(!(PPTX_BASIC_CHARTS as readonly string[]).includes(type))invalid('图表类型无效');
  const sheet=model.info.sheets.find(value=>value.id===sheetId);if(!sheet)throw new FileError('CHANGED','工作表已不存在');
  const categoryColumn=range.firstColumn,last=range.lastColumn,firstValue=last===categoryColumn?categoryColumn:categoryColumn+1;
  if(last-firstValue+1>16 || range.lastRow-range.firstRow+1>1000)throw new FileError('TOO_LARGE','图表数据最多支持 16 个系列、1000 行，请缩小选区');
  let firstRow=range.firstRow;
  const first=model.cell(sheetId,firstRow,firstValue);
  const header=first.type==='string' && firstRow<range.lastRow;
  if(header)firstRow++;
  const number=(row:number,column:number)=>{
    const cell=model.cell(sheetId,row,column),value=Number(cell.value);
    if(cell.type!=='number' || !cell.value.trim() || !Number.isFinite(value))invalid('图表数值区域需要有限数值，请检查当前选区');
    return value;
  };
  const rows=Array.from({length:range.lastRow-firstRow+1},(_,i)=>firstRow+i);
  const categories=rows.map(row=>last===categoryColumn?String(row+1):model.cell(sheetId,row,categoryColumn).value);
  const x=type==='scatter'?rows.map((row,i)=>last===categoryColumn?i+1:number(row,categoryColumn)):undefined;
  const source=(column:number)=>`'${sheet.name.replaceAll("'","''")}'!${absolute(firstRow,column)}:${absolute(range.lastRow,column)}`;
  const series=Array.from({length:last-firstValue+1},(_,i)=>{
    const column=firstValue+i,values=rows.map(row=>number(row,column));
    if(type==='pie' && (values.some(value=>value<0) || !values.some(value=>value>0)))invalid('饼图需要非负且至少一个大于零的数值');
    return {name:header?model.cell(sheetId,range.firstRow,column).value:officeCellAddress(firstRow,column).replace(/\d+$/,''),values,formula:source(column),titleFormula:header?`'${sheet.name.replaceAll("'","''")}'!${absolute(range.firstRow,column)}`:undefined};
  });
  return {categories,x,categoryFormula:last===categoryColumn?undefined:source(categoryColumn),series};
}

function chartXml(model:OfficeWorkbook,action:Extract<WorkbookDrawingInsert,{kind:'chart'}>,chartNS:string,drawingNS:string){
  const data=workbookChartData(model,action.sheetId,action.range,action.chartType),count=data.categories.length;
  const literal=(tag:string,values:readonly(string|number)[])=>`<c:${tag}><c:ptCount val="${values.length}"/>${values.map((v,i)=>`<c:pt idx="${i}"><c:v>${text(String(v))}</c:v></c:pt>`).join('')}</c:${tag}>`;
  const series=data.series.map((value,i)=>{
    const title=value.titleFormula?`<c:strRef><c:f>${text(value.titleFormula)}</c:f>${literal('strCache',[value.name])}</c:strRef>`:`<c:v>${text(value.name)}</c:v>`;
    const metadata=`<c:idx val="${i}"/><c:order val="${i}"/><c:tx>${title}</c:tx>`;
    const x=action.chartType==='scatter'?`<c:xVal>${data.categoryFormula?`<c:numRef><c:f>${text(data.categoryFormula)}</c:f>${literal('numCache',data.x!)}</c:numRef>`:literal('numLit',data.x!)}</c:xVal>`:`<c:cat>${data.categoryFormula?`<c:strRef><c:f>${text(data.categoryFormula)}</c:f>${literal('strCache',data.categories)}</c:strRef>`:literal('strLit',data.categories)}</c:cat>`;
    const yTag=action.chartType==='scatter'?'yVal':'val',y=`<c:${yTag}><c:numRef><c:f>${text(value.formula)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${count}"/>${value.values.map((v,index)=>`<c:pt idx="${index}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:${yTag}>`;
    return basicChartSeries(action.chartType,metadata,x,y,'c:',drawingNS);
  }).join('');
  return `<c:chartSpace xmlns:c="${chartNS}" xmlns:a="${drawingNS}"><c:chart><c:plotArea><c:layout/>${basicChartPlot(action.chartType,series,['101','102'])}${basicChartAxes(action.chartType,['101','102'],true)}</c:plotArea><c:legend><c:legendPos val="r"/><c:layout/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}

/** Append to an exclusive drawing; clone a shared drawing before changing it.
 * Clones keep their relative base directory and only the selected sheet moves.
 * Existing XML nodes, media and unrelated parts retain their original bytes. */
export function insertWorkbookDrawing(file:OfficePackage,action:WorkbookDrawingInsert,imageReceipt?:PptxImageReceipt):{packageData:OfficePackage;plan:OfficePartPlan;object:{part:string;id:string}}{
  const model=new OfficeWorkbook(file),range=checkOfficeRange(action.range),sheet=model.info.sheets.find(value=>value.id===action.sheetId);
  if(!sheet)throw new FileError('CHANGED','工作表已不存在');
  if(model.info.kind!=='xlsx')unsupported('此工作簿类型暂不支持插入对象，原件保留');
  if(sheet.protected)throw new FileError('PERMISSION','工作表受保护，不能插入对象');
  if(!['shape','chart','image','text'].includes(action.kind))invalid('插入对象类型无效');
  if(action.kind==='shape' && !(WORKBOOK_SHAPES as readonly string[]).includes(action.shape))invalid('形状类型无效');
  const graph=model.graph,entry=children(children(new OfficeXml(file.read(graph.mainPart)).root,'sheets')[0],'sheet').find(node=>attribute(node,'sheetId')===sheet.id);
  if(!entry)throw new FileError('CHANGED','工作表来源已不存在');
  const relNS=entry.uri.includes('purl.oclc.org')?STRICT_REL:OFFICE_REL;
  const sheetPart=graph.target(graph.mainPart,(attribute(entry,'id',OFFICE_REL)??attribute(entry,'id',STRICT_REL))!);
  const xml=new OfficeXml(file.read(sheetPart)),declarations=children(xml.root,'drawing');
  if(declarations.length>1 || descendants(xml.root,'drawing').length!==declarations.length)unsupported('此工作表的绘图来源尚未适配，原对象保留');
  const old=declarations[0],oldRelation=old&&graph.forPart(sheetPart).find(row=>row.id===(attribute(old,'id',OFFICE_REL)??attribute(old,'id',STRICT_REL)));
  if(old && (!oldRelation?.part || oldRelation.external || !relationshipKind(oldRelation.type,'drawing')))unsupported('绘图来源关系无效，原对象保留');
  const xdr=relNS===STRICT_REL?'http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing':XDR,drawingNS=relNS===STRICT_REL?'http://purl.oclc.org/ooxml/drawingml/main':DRAW,chartNS=relNS===STRICT_REL?'http://purl.oclc.org/ooxml/drawingml/chart':CHART;
  const drawing=new OfficeXml(oldRelation?.part?file.read(oldRelation.part):Buffer.from(`<xdr:wsDr xmlns:xdr="${xdr}"/>`));
  if(drawing.root.local!=='wsDr' || drawing.root.uri!==xdr)unsupported('此绘图命名空间尚未适配，原对象保留');
  const properties=descendants(drawing.root,'cNvPr',xdr),usedIds=new Set(properties.map(node=>attribute(node,'id')));
  if(properties.length>=512)throw new FileError('TOO_LARGE','工作表绘图对象超过 512 个');
  let id=1;while(usedIds.has(String(id)))id++;
  const key=(name:string)=>decodeURIComponent(name).toLowerCase(),names=new Set(file.names().map(key)),allocate=(folder:string,base:string,ext:string)=>{let n=1,name:string;do{name=posix.join(folder,`${base}${n++}.${ext}`);}while(names.has(key(name))||names.has(key(relationshipPart(name))));names.add(key(name));return name;};
  const shared=oldRelation?.part&&[...graph.bySource].some(([source,rows])=>source!==sheetPart&&rows.some(row=>row.part===oldRelation.part));
  const drawingPart=oldRelation?.part&&!shared?oldRelation.part:allocate(oldRelation?.part?posix.dirname(oldRelation.part):posix.join(posix.dirname(graph.mainPart),'drawings'),'willyou-drawing-','xml'),drawingRelPart=relationshipPart(drawingPart);
  const oldRels=oldRelation?.part&&relationshipPart(oldRelation.part),drawingRels=new OfficeXml(oldRels&&file.has(oldRels)?file.read(oldRels):Buffer.from(`<Relationships xmlns="${OPC_REL}"/>`));
  const sheetRelPart=relationshipPart(sheetPart),sheetRels=new OfficeXml(file.has(sheetRelPart)?file.read(sheetRelPart):Buffer.from(`<Relationships xmlns="${OPC_REL}"/>`));
  const relation=(doc:OfficeXml,source:string,target:string,kind:string)=>{const used=new Set(children(doc.root,'Relationship').map(node=>attribute(node,'Id')));let n=1;while(used.has(`rIdWillYou${n}`))n++;const rid=`rIdWillYou${n}`;return {rid,bytes:doc.edit([append(doc,doc.root,`<${officePrefix(doc.root)}Relationship Id="${rid}" Type="${relNS}/${kind}" Target="${xmlEscape(posix.relative(posix.dirname(source),target))}"/>`)])};};
  const changes=new Map<string,Uint8Array>(),types:{part:string;mime:string}[]=[{part:drawingPart,mime:TYPE.drawing}];
  let width=320,height=180,content:string;
  const nv=(kind:string,name:string)=>`<xdr:nv${kind}Pr><xdr:cNvPr id="${id}" name="${name} ${id}"/><xdr:cNv${kind}Pr/></xdr:nv${kind}Pr>`;
  if(action.kind==='shape'){
    const geometry=action.shape==='lineInv'?'line':action.shape,arrow=action.shape==='lineInv'?'<a:headEnd type="triangle"/>':'';
    content=`<xdr:sp>${nv('Sp','Shape')}<xdr:spPr><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="14806E"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="106C61"/></a:solidFill>${arrow}</a:ln></xdr:spPr><xdr:txBody><a:bodyPr/><a:lstStyle/><a:p/></xdr:txBody></xdr:sp>`;
  }else if(action.kind==='chart'){
    const part=allocate(posix.join(posix.dirname(graph.mainPart),'charts'),'willyou-chart-','xml'),value=chartXml(model,action,chartNS,drawingNS),rel=relation(drawingRels,drawingPart,part,'chart');
    changes.set(part,Buffer.from(value));changes.set(drawingRelPart,rel.bytes);types.push({part,mime:TYPE.chart});
    content=`<xdr:graphicFrame macro="">${nv('GraphicFrame','Chart')}<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${chartNS}"><c:chart xmlns:c="${chartNS}" xmlns:r="${relNS}" r:id="${rel.rid}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
  }else if(action.kind==='text'){
    const frame=workbookTextFrameSchema.parse(action.frame);width=frame.width;height=frame.height;
    content=`<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="Text box ${id}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr wrap="square">${action.autoSize?'<a:spAutoFit/>':'<a:noAutofit/>'}</a:bodyPr><a:lstStyle/><a:p/></xdr:txBody></xdr:sp>`;
  }else{
    if(!imageReceipt)throw new FileError('UNTRUSTED','图片尚未通过本机解码验证');
    const receipt=pptxImageReceiptSchema.parse(imageReceipt),bytes=pptxImageBytes(action.image),size=validatePptxImageContainer(bytes,action.image.mime);
    if(receipt.hash!==createHash('sha256').update(bytes).digest('hex')||size.width!==receipt.width||size.height!==receipt.height)throw new FileError('UNTRUSTED','图片与本机解码回执不一致');
    const factor=Math.min(1,640/receipt.width,480/receipt.height);width=Math.max(1,Math.round(receipt.width*factor));height=Math.max(1,Math.round(receipt.height*factor));
    const part=allocate(posix.join(posix.dirname(graph.mainPart),'media'),'willyou-image-',action.image.mime==='image/png'?'png':'jpg'),rel=relation(drawingRels,drawingPart,part,'image');
    changes.set(part,bytes);changes.set(drawingRelPart,rel.bytes);types.push({part,mime:action.image.mime});
    content=`<xdr:pic>${nv('Pic','Picture')}<xdr:blipFill><a:blip xmlns:r="${relNS}" r:embed="${rel.rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
  }
  const marker=`<xdr:from><xdr:col>${range.firstColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${range.firstRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`;
  const value=action.kind==='text'?`<xdr:absoluteAnchor xmlns:xdr="${xdr}" xmlns:a="${drawingNS}"><xdr:pos x="${emu(action.frame.x)}" y="${emu(action.frame.y)}"/><xdr:ext cx="${emu(width)}" cy="${emu(height)}"/>${content}<xdr:clientData/></xdr:absoluteAnchor>`:`<xdr:oneCellAnchor xmlns:xdr="${xdr}" xmlns:a="${drawingNS}">${marker}<xdr:ext cx="${emu(width)}" cy="${emu(height)}"/>${content}<xdr:clientData/></xdr:oneCellAnchor>`;
  const ext=children(drawing.root,'extLst')[0],at=ext?.start??drawing.root.closeStart;
  changes.set(drawingPart,drawing.edit([drawing.root.selfClosing?drawing.replaceContent(drawing.root,value):{start:at,end:at,value}]));
  if(!changes.has(drawingRelPart)&&oldRels&&oldRels!==drawingRelPart&&file.has(oldRels))changes.set(drawingRelPart,file.read(oldRels));
  if(drawingPart!==oldRelation?.part){
  const sheetRel=relation(sheetRels,sheetPart,drawingPart,'drawing');changes.set(sheetRelPart,sheetRel.bytes);
  let sheetEdit:XmlEdit;
  if(old){const key=Object.values(old.attributes).find(item=>item.local==='id'&&[OFFICE_REL,STRICT_REL].includes(item.uri));if(!key)invalid('绘图关系标识缺失');sheetEdit=xml.setAttribute(old,key!.name,sheetRel.rid);}
  else{const later=new Set(['legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst']),offset=xml.root.children.find(node=>later.has(node.local))?.start??xml.root.closeStart,tag=`<${officePrefix(xml.root)}drawing xmlns:r="${relNS}" r:id="${sheetRel.rid}"/>`;sheetEdit=xml.root.selfClosing?xml.replaceContent(xml.root,tag):{start:offset,end:offset,value:tag};}
  changes.set(sheetPart,xml.edit([sheetEdit]));
  }
  const contentTypes=new OfficeXml(file.read('[Content_Types].xml')),prefix=officePrefix(contentTypes.root);
  let registrations=types.filter(row=>!file.has(row.part)).map(row=>`<${prefix}Override PartName="/${xmlEscape(row.part)}" ContentType="${row.mime}"/>`).join('');
  if(!children(contentTypes.root,'Default').some(node=>attribute(node,'Extension')?.toLowerCase()==='rels'))registrations+=`<${prefix}Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`;
  if(registrations)changes.set('[Content_Types].xml',contentTypes.edit([append(contentTypes,contentTypes.root,registrations)]));
  const plan:OfficePartPlan={changed:[...changes.keys()].filter(part=>file.has(part)),added:[...changes.keys()].filter(part=>!file.has(part)),removed:[]};
  const packageData=file.patch(changes,plan);new OfficeWorkbook(packageData);
  return {packageData,plan,object:{part:drawingPart,id:String(id)}};
}
