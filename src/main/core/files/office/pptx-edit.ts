import { posix } from 'node:path';
import { FileError } from '@shared/files';
import { pptxActionSchema,type PptxAction } from '@shared/file-pptx';
import type { OfficePartPlan } from '@shared/file-office';
import { OfficePagesModel } from './pages-model';
import { OfficePackage } from './package';
import { OfficeXml,attribute,children,descendants,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';
import { OFFICE_REL,STRICT_REL,OPC_REL,relationshipKind,relationshipPart } from './relationships';
import { editPptxTextBody } from './pptx-text-edit';
import { editPptxSlides } from './pptx-slides';
import { deletePptxElement } from './pptx-delete-element';
import { editPptxElement } from './pptx-element-edit';
import { editPptxImage,type PptxImageReceipt } from './pptx-image';
import { insertPptxPlaceholder } from './pptx-placeholder';
import { editPptxChartOptions,changePptxChartType } from './pptx-chart';

const prefix=(node:OfficeXmlNode)=>node.name.includes(':')?node.name.slice(0,node.name.indexOf(':')+1):'';
const append=(doc:OfficeXml,node:OfficeXmlNode,xml:string):XmlEdit=>node.selfClosing?doc.replaceContent(node,xml):{start:node.closeStart,end:node.closeStart,value:xml};
const noteType='application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';
export function editPptx(file:OfficePackage,raw:PptxAction,measuredRows?:readonly number[],image?:PptxImageReceipt):{packageData:OfficePackage;plan:OfficePartPlan}{
  const action=pptxActionSchema.parse(raw),model=new OfficePagesModel(file),graph=model.graph;
  if(model.info.kind!=='pptx')throw new FileError('UNSUPPORTED','此编辑入口只接受 PPTX');
  if(model.info.signed)throw new FileError('UNSUPPORTED','此文档包含数字签名，编辑前需确认签名处理');
  const main=new OfficeXml(file.read(graph.mainPart));if(children(main.root,'modifyVerifier').length)throw new FileError('PERMISSION','演示文稿有修改保护，未改变原件');
  if(action.type==='add'||action.type==='duplicate'||action.type==='delete')return editPptxSlides(model,action);
  if(action.type==='element-delete')return deletePptxElement(model,action);
  if(action.type==='image-insert'||action.type==='image-replace')return editPptxImage(model,action,image);
  if(action.type==='image-placeholder')return insertPptxPlaceholder(model,action,image);
  if(action.type==='chart-values'||action.type==='chart-insert')throw new FileError('INVALID_INPUT','图表数据必须经内嵌工作簿异步验证后应用');
  if(action.type==='chart-options')return editPptxChartOptions(model,action.slideId,action.elementId,action.patch);
  if(action.type==='chart-type')return changePptxChartType(model,action.slideId,action.elementId,action.chartType);
  if(action.type==='insert-element'||action.type==='element-text'||action.type==='element-format'||action.type==='element-appearance'||action.type==='table-cell'||action.type==='table-clear'||action.type==='table-flags'||action.type==='element-transform'||action.type==='element-layer')return editPptxElement(model,action,measuredRows);
  const entries=children(children(main.root,'sldIdLst')[0],'sldId'),entry=entries.find(node=>attribute(node,'id')===action.slideId);
  if(!entry)throw new FileError('CHANGED','幻灯片已不存在');
  const relationId=attribute(entry,'id',OFFICE_REL)??attribute(entry,'id',STRICT_REL),part=graph.target(graph.mainPart,relationId!),slide=new OfficeXml(file.read(part)),ns=slide.root.uri;
  const strict=ns==='http://purl.oclc.org/ooxml/presentationml/main',drawing=strict?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main',relationNs=strict?STRICT_REL:OFFICE_REL;
  const changes=new Map<string,Uint8Array|null>();
  if(action.type==='hidden'){
    if(model.info.slides.find(row=>row.id===action.slideId)!.hidden!==action.hidden)changes.set(part,slide.edit([slide.setAttribute(slide.root,'show',action.hidden?'0':'1')]));
  }else if(action.type==='background'){
    const common=children(slide.root,'cSld')[0],background=common&&children(common,'bg')[0];if(!common)throw new FileError('INVALID_INPUT','幻灯片正文缺失');
    const fill=`<a:solidFill xmlns:a="${drawing}"><a:srgbClr val="${action.color.slice(1).toUpperCase()}"/></a:solidFill>`;
    const properties=background&&children(background,'bgPr')[0],reference=background&&children(background,'bgRef')[0];let edits:XmlEdit[];
    if(properties){
      const fills=properties.children.filter(node=>node.uri===drawing&&['noFill','solidFill','gradFill','blipFill','pattFill','grpFill'].includes(node.local));
      if(fills.length>1)throw new FileError('INVALID_INPUT','幻灯片背景填充重复');
      const color=fills[0]?.local==='solidFill'&&children(fills[0],'srgbClr',drawing)[0];
      if(color&&!color.children.length&&attribute(color,'val')?.toUpperCase()===action.color.slice(1).toUpperCase())return {packageData:file,plan:{changed:[],added:[],removed:[]}};
      if(fills[0])edits=[{start:fills[0].start,end:fills[0].end,value:fill}];
      else edits=[properties.selfClosing?slide.replaceContent(properties,fill):{start:properties.openEnd,end:properties.openEnd,value:fill}];
    }else if(background){
      if(!reference||background.children.length!==1)throw new FileError('UNSUPPORTED','幻灯片背景包含未知对象，修改尚未应用');
      edits=[{start:reference.start,end:reference.end,value:`<p:bgPr xmlns:p="${ns}">${fill}</p:bgPr>`}];
    }else{
      const at=children(common,'spTree')[0]?.start??common.closeStart;edits=[{start:at,end:at,value:`<p:bg xmlns:p="${ns}"><p:bgPr>${fill}</p:bgPr></p:bg>`}];
    }
    changes.set(part,slide.edit(edits));
  }else{
    const value=action.text.replace(/\r\n?/g,'\n'),current=model.info.slides.find(row=>row.id===action.slideId)!;
    if(current.notes===value)return {packageData:file,plan:{changed:[],added:[],removed:[]}};
    const notes=graph.forPart(part).find(row=>relationshipKind(row.type,'notesSlide'));
    if(notes?.part){
      if([...graph.bySource].some(([source,rows])=>source!==part&&rows.some(row=>row.part===notes.part&&relationshipKind(row.type,'notesSlide'))))throw new FileError('UNSUPPORTED','备注部件被多张幻灯片共享，需要先建立独立副本');
      const doc=new OfficeXml(file.read(notes.part)),shapes=descendants(doc.root,'sp',ns).filter(shape=>{const ph=descendants(shape,'ph',ns)[0];return !ph||['body','obj'].includes(attribute(ph,'type')??'obj');});
      if(shapes.length!==1)throw new FileError('UNSUPPORTED','备注包含多个或缺少正文对象，修改尚未应用');
      const body=children(shapes[0],'txBody',ns)[0];if(!body)throw new FileError('INVALID_INPUT','备注正文缺失');
      changes.set(notes.part,doc.edit(editPptxTextBody(doc,body,value,drawing)));
    }else{
      const occupied=new Set(file.names().map(name=>decodeURIComponent(name).toLowerCase()));let number=1,note:string;
      do{note=posix.join(posix.dirname(graph.mainPart),'notesSlides',`willyou-notes-${number++}.xml`);}while(occupied.has(note.toLowerCase())||occupied.has(relationshipPart(note).toLowerCase()));
      const paragraphs=value.split('\n').map(line=>`<a:p><a:r><a:t xml:space="preserve">${xmlEscape(line)}</a:t></a:r></a:p>`).join('');
      changes.set(note,Buffer.from(`<p:notes xmlns:p="${ns}" xmlns:a="${drawing}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`));
      const masters=graph.forPart(graph.mainPart).filter(row=>relationshipKind(row.type,'notesMaster'));
      if(masters.length>1||masters.some(row=>row.external||!row.part))throw new FileError('INVALID_INPUT','备注母版关系无效');
      changes.set(relationshipPart(note),Buffer.from(`<Relationships xmlns="${OPC_REL}"><Relationship Id="rIdSlide" Type="${relationNs}/slide" Target="${xmlEscape(posix.relative(posix.dirname(note),part))}"/>${masters[0]?`<Relationship Id="rIdMaster" Type="${relationNs}/notesMaster" Target="${xmlEscape(posix.relative(posix.dirname(note),masters[0].part!))}"/>`:''}</Relationships>`));
      const relationsName=relationshipPart(part),relations=new OfficeXml(file.has(relationsName)?file.read(relationsName):Buffer.from(`<Relationships xmlns="${OPC_REL}"/>`)),ids=new Set(graph.forPart(part).map(row=>row.id));
      number=1;while(ids.has(`rIdWillYouNotes${number}`))number++;const rid=`rIdWillYouNotes${number}`;
      changes.set(relationsName,relations.edit([append(relations,relations.root,`<${prefix(relations.root)}Relationship Id="${rid}" Type="${relationNs}/notesSlide" Target="${xmlEscape(posix.relative(posix.dirname(part),note))}"/>`)]));
      const types=new OfficeXml(file.read('[Content_Types].xml'));let registration=`<${prefix(types.root)}Override PartName="/${xmlEscape(note)}" ContentType="${noteType}"/>`;
      if(!children(types.root,'Default').some(node=>attribute(node,'Extension')?.toLowerCase()==='rels'))registration+=`<${prefix(types.root)}Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`;
      changes.set('[Content_Types].xml',types.edit([append(types,types.root,registration)]));
    }
  }
  for(const [name,bytes] of changes)if(bytes&&file.has(name)&&file.read(name).equals(Buffer.from(bytes)))changes.delete(name);
  if(!changes.size)return {packageData:file,plan:{changed:[],added:[],removed:[]}};
  const plan:OfficePartPlan={changed:[...changes.keys()].filter(name=>file.has(name)),added:[...changes.keys()].filter(name=>!file.has(name)),removed:[]},packageData=file.patch(changes,plan),after=new OfficePagesModel(packageData);
  if(action.type==='notes'&&after.info.slides.find(row=>row.id===action.slideId)?.notes!==action.text.replace(/\r\n?/g,'\n'))throw new FileError('INVALID_INPUT','备注候选文字不匹配，修改尚未应用');
  return {packageData,plan};
}
