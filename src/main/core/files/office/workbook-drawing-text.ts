import {posix} from 'node:path';
import {FileError} from '@shared/files';
import {workbookTextEditSchema,type WorkbookTextEdit} from '@shared/file-workbook-drawing';
import {OfficePackage} from './package';
import {OfficeWorkbook} from './workbook';
import {OfficeXml,attribute,children,descendants,xmlEscape,copyOfficeNode,type XmlEdit} from './xml';
import {OFFICE_REL,STRICT_REL,relationshipKind,relationshipPart} from './relationships';
import {officePrefix} from './worksheet-edits';
import {encodeOfficeString} from './xstring';

/** Only replace this owned, directly anchored text box's text body. Clone a
 * shared drawing at the same relative base before redirecting its worksheet.
 * Text identities are worksheet-scoped, so a clone does not orphan live input. */
export function editWorkbookDrawingText(file:OfficePackage,input:WorkbookTextEdit):OfficePackage{
  const action=workbookTextEditSchema.parse(input),model=new OfficeWorkbook(file),sheet=model.info.sheets.find(value=>value.id===action.sheetId);
  if(!sheet)throw new FileError('CHANGED','工作表已不存在');
  if(model.info.kind!=='xlsx'||model.info.signed)throw new FileError('UNSUPPORTED','此工作簿不能编辑文本框，原件保留');
  if(sheet.protected)throw new FileError('PERMISSION','工作表受保护，不能编辑文本框');
  const object=model.window(action.sheetId,0,0,1,1).objects?.find(value=>value.id===action.objectId);
  if(object?.kind!=='shape'||!object.shape?.textBox)throw new FileError('CHANGED','文本框已不存在或不是可编辑的文字对象');
  if(object.shape.text===action.text)return file;
  const graph=model.graph,drawingPart=object.source.part,doc=new OfficeXml(file.read(drawingPart));
  const prop=descendants(doc.root,'cNvPr',doc.root.uri).filter(value=>attribute(value,'id')===object.source.id);
  if(prop.length!==1)throw new FileError('UNSUPPORTED','文本框标识不唯一，原对象保留');
  const node=doc.root.children.flatMap(anchor=>children(anchor,'sp',doc.root.uri)).find(value=>descendants(value,'cNvPr',doc.root.uri).includes(prop[0])),body=node&&children(node,'txBody',doc.root.uri)[0];
  if(!node||!body)throw new FileError('UNSUPPORTED','文本框结构尚未适配，原对象保留');
  const uri=doc.root.uri.includes('purl.oclc.org')?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main';
  const paragraphs=children(body,'p',uri),bodyProps=children(body,'bodyPr',uri),styles=children(body,'lstStyle',uri);
  if(body.children.some(value=>value.uri!==uri||!['p','bodyPr','lstStyle'].includes(value.local))||bodyProps.length!==1||styles.length>1||paragraphs.some(p=>p.children.some(value=>value.uri!==uri||!['pPr','r','br','endParaRPr'].includes(value.local))))throw new FileError('UNSUPPORTED','此文本框包含尚未适配的文字结构，原内容保留');
  const runProps=paragraphs.flatMap(p=>children(p,'r',uri)).map(r=>children(r,'rPr',uri)[0]).filter(Boolean),pProps=paragraphs.map(p=>children(p,'pPr',uri)[0]).filter(Boolean);
  // Keep a uniform existing style. Do not silently flatten mixed rich runs.
  if(new Set(runProps.map(value=>doc.slice(value))).size>1||new Set(pProps.map(value=>doc.slice(value))).size>1)throw new FileError('UNSUPPORTED','混合文字样式暂不支持整框改写，原内容保留');
  const tag='a:',pStyle=pProps[0]?copyOfficeNode(doc,pProps[0]):'',rStyle=runProps[0]?copyOfficeNode(doc,runProps[0]):'';
  const lines=action.text.split('\n').map(line=>`<${tag}p xmlns:${tag.slice(0,-1)}="${uri}">${pStyle}<${tag}r>${rStyle}<${tag}t xml:space="preserve">${xmlEscape(encodeOfficeString(line))}</${tag}t></${tag}r></${tag}p>`).join('');
  const next=doc.edit([doc.replaceContent(body,doc.slice(bodyProps[0])+(styles[0]?doc.slice(styles[0]):'')+lines)]),changes=new Map<string,Uint8Array>();
  const declaring=[...graph.bySource].filter(([,rels])=>rels.some(rel=>rel.part===drawingPart&&relationshipKind(rel.type,'drawing')));
  if(declaring.length>1){
    const entry=children(children(new OfficeXml(file.read(graph.mainPart)).root,'sheets')[0],'sheet').find(value=>attribute(value,'sheetId')===sheet.id)!;
    const sheetPart=graph.target(graph.mainPart,(attribute(entry,'id',OFFICE_REL)??attribute(entry,'id',STRICT_REL))!),sheetXml=new OfficeXml(file.read(sheetPart)),declaration=children(sheetXml.root,'drawing')[0],rid=attribute(declaration,'id',OFFICE_REL)??attribute(declaration,'id',STRICT_REL),relPart=relationshipPart(sheetPart),rels=new OfficeXml(file.read(relPart));
    const relation=children(rels.root,'Relationship').find(value=>attribute(value,'Id')===rid&&attribute(value,'TargetMode')!=='External');if(!relation)throw new FileError('CHANGED','文本框来源关系已变化');
    const key=(name:string)=>decodeURIComponent(name).toLowerCase(),names=new Set(file.names().map(key));let index=1,target:string;do{target=posix.join(posix.dirname(drawingPart),`willyou-text-${index++}.xml`);}while(names.has(key(target))||names.has(key(relationshipPart(target))));
    changes.set(target,next);const oldRels=relationshipPart(drawingPart);if(file.has(oldRels))changes.set(relationshipPart(target),file.read(oldRels));
    changes.set(relPart,rels.edit([rels.setAttribute(relation,'Target',posix.relative(posix.dirname(sheetPart),target))]));
    const types=new OfficeXml(file.read('[Content_Types].xml')),registration=`<${officePrefix(types.root)}Override PartName="/${xmlEscape(target)}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,edit:XmlEdit=types.root.selfClosing?types.replaceContent(types.root,registration):{start:types.root.closeStart,end:types.root.closeStart,value:registration};changes.set('[Content_Types].xml',types.edit([edit]));
  }else changes.set(drawingPart,next);
  const output=file.patch(changes,{changed:[...changes.keys()].filter(part=>file.has(part)),added:[...changes.keys()].filter(part=>!file.has(part)),removed:[]});new OfficeWorkbook(output);return output;
}
