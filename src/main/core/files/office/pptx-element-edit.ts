import { FileError } from '@shared/files';
import type { PptxAction } from '@shared/file-pptx';
import { PPTX_PRESETS } from '@shared/file-pptx-elements';
import { pptxTableRangeCells } from '@shared/file-pptx-table';
import type { OfficePartPlan } from '@shared/file-office';
import { OfficePagesModel } from './pages-model';
import { OfficePackage } from './package';
import { OFFICE_REL,STRICT_REL,relationshipKind } from './relationships';
import { OfficeXml,attribute,children,descendants,copyOfficeNode,xmlEscape,type XmlEdit } from './xml';
import { EMU_PER_POINT,drawingNamespace,pptxDrawingNodes,pptxShapeId,pptxShapeTree,pptxTextContent } from './pptx-elements';
import { editPptxTextBody } from './pptx-text-edit';
import { PptxGeometryResolver } from './pptx-geometry';
import { editPptxTable,newPptxTable,resizePptxTable } from './pptx-table';
import { editPptxAppearance } from './pptx-appearance';
import { editPptxTextFormat } from './pptx-format';

type Action=Extract<PptxAction,{type:'insert-element'|'element-text'|'element-transform'|'element-layer'|'element-format'|'element-appearance'|'table-cell'|'table-clear'|'table-flags'}>;
/** Precise source patches. A PDF projection is never used to reconstruct a
 * shape, its text, or any untouched page part. */
export function editPptxElement(model:OfficePagesModel,action:Action,measuredRows?:readonly number[]):{packageData:OfficePackage;plan:OfficePartPlan}{
  const file=model.packageData,main=new OfficeXml(file.read(model.graph.mainPart)),entry=children(children(main.root,'sldIdLst')[0],'sldId').find(node=>attribute(node,'id')===action.slideId);
  if(!entry)throw new FileError('CHANGED','幻灯片已不存在');
  const part=model.graph.target(model.graph.mainPart,(attribute(entry,'id',OFFICE_REL)??attribute(entry,'id',STRICT_REL))!),doc=new OfficeXml(file.read(part)),ns=doc.root.uri,drawing=drawingNamespace(ns),tree=pptxShapeTree(doc);
  const nodes=pptxDrawingNodes(tree),edits:XmlEdit[]=[];
  if(action.type==='insert-element'){
    const ids=new Set(descendants(tree,'cNvPr',ns).map(node=>Number(attribute(node,'id'))));let id=1;for(const value of ids)id=Math.max(id,value+1);
    if(id>4294967295){id=1;while(ids.has(id))id++;}
    const count=nodes.filter(row=>row.parent===tree).length,scaleX=model.info.width!/680,scaleY=model.info.height!/450;
    const shape=action.kind==='text'?'rect':action.shape??'rect',line=shape==='line';
    const x=Math.round((90+count*12%150)*scaleX*EMU_PER_POINT),y=Math.round((95+count*18%130+(line?70:0))*scaleY*EMU_PER_POINT);
    const width=Math.max(1,Math.round((action.kind==='text'?280:200)*scaleX*EMU_PER_POINT)),height=line?0:Math.max(1,Math.round((action.kind==='text'?70:140)*scaleY*EMU_PER_POINT));
    const text=line?'':action.kind==='text'?'双击编辑文本':'形状',color='<a:solidFill><a:srgbClr val="263D3A"/></a:solidFill>';
    let object=`<p:sp xmlns:p="${ns}" xmlns:a="${drawing}"><p:nvSpPr><p:cNvPr id="${id}" name="${action.kind==='text'?'TextBox':'Shape'} ${id}"/><p:cNvSpPr${action.kind==='text'?' txBox="1"':''}/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="${PPTX_PRESETS[shape]}"><a:avLst/></a:prstGeom>${action.kind==='text'||line?'<a:noFill/>':'<a:solidFill><a:srgbClr val="D6EBE4"/></a:solidFill>'}<a:ln${line?' w="12700"':''}>${line?color:'<a:noFill/>'}</a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"/><a:lstStyle/><a:p>${text?`<a:r><a:rPr lang="zh-CN" sz="${Math.max(100,Math.round(22*scaleX*100))}">${color}</a:rPr><a:t>${xmlEscape(text)}</a:t></a:r>`:''}</a:p></p:txBody></p:sp>`;
    if(action.kind==='table'){
      const styles=model.graph.forPart(model.graph.mainPart).find(row=>relationshipKind(row.type,'tableStyles'));
      const styleDoc=styles?.part&&!styles.external?new OfficeXml(file.read(styles.part)):undefined;
      const styleId=styleDoc&&attribute(styleDoc.root,'def')||'{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
      object=newPptxTable(ns,drawing,id,x,y,width,height,Math.max(100,Math.round(22*scaleX*100)),styleId);
    }
    const at=children(tree,'extLst')[0]?.start??tree.closeStart;edits.push(tree.selfClosing?doc.replaceContent(tree,object):{start:at,end:at,value:object});
  }else{
    const target=nodes.find(({node})=>pptxShapeId(node)===String(Number(action.elementId)));if(!target)throw new FileError('CHANGED','幻灯片对象已不存在');
    const {node,parent}=target;
    if(action.type==='element-text'||action.type==='element-format'){
      if(node.local!=='sp')throw new FileError('UNSUPPORTED','此对象的文字不能作为普通文本框编辑');
      const body=children(node,'txBody',ns)[0];if(!body)throw new FileError('UNSUPPORTED','此对象没有可编辑正文');
      if(action.type==='element-format')edits.push(...editPptxTextFormat(doc,body,action.patch,drawing));
      else if(pptxTextContent(body,drawing)!==action.text.replace(/\r\n?/g,'\n'))edits.push(...editPptxTextBody(doc,body,action.text,drawing,'对象文字'));
    }else if(action.type==='table-cell'||action.type==='table-clear'||action.type==='table-flags'){
      edits.push(...editPptxTable(doc,node,action,drawing));
    }else if(action.type==='element-appearance'){
      edits.push(...editPptxAppearance(doc,node,action.patch,drawing));
    }else if(action.type==='element-transform'){
      const geometry=new PptxGeometryResolver(model.graph,name=>name===part?doc:new OfficeXml(file.read(name))).resolve(part,node,parent);
      if(!geometry)throw new FileError('UNSUPPORTED','此对象的继承位置或变换尚未适配，修改尚未应用');
      const inherited=geometry.source!=='local';
      if(inherited&&geometry.transform.children.some(child=>child.uri!==drawing||!['off','ext'].includes(child.local)))throw new FileError('UNSUPPORTED','继承变换含未知节点，修改尚未应用');
      const editor=inherited?new OfficeXml(Buffer.from(copyOfficeNode(geometry.doc,geometry.transform))):doc,transform=inherited?editor.root:geometry.transform,transformEdits:XmlEdit[]=[];
      const offset=children(transform,'off',drawing)[0],extent=children(transform,'ext',drawing)[0];
      const apply=(key:'x'|'y'|'width'|'height'|'rotation',name:string,element=transform)=>{
        const value=action.patch[key];if(value===undefined)return;const raw=Math.round(value*(key==='rotation'?60000:EMU_PER_POINT));
        if(!Number.isSafeInteger(raw)||(key==='rotation'&&(raw<-2147483648||raw>2147483647))||(['width','height'].includes(key)&&raw<1))throw new FileError('INVALID_INPUT','对象变换超出文件格式范围');
        const prior=attribute(element,name);if(prior===undefined&&key==='rotation'&&raw===0||prior!==undefined&&Number(prior)===raw)return;
        transformEdits.push(editor.setAttribute(element,name,String(raw)));
      };
      apply('x','x',offset);apply('y','y',offset);apply('width','cx',extent);apply('height','cy',extent);apply('rotation','rot');
      edits.push(...resizePptxTable(doc,node,drawing,
        action.patch.width!==undefined&&Math.round(action.patch.width*EMU_PER_POINT)!==Number(attribute(extent,'cx'))?action.patch.width:undefined,
        action.patch.height!==undefined&&(Math.round(action.patch.height*EMU_PER_POINT)!==Number(attribute(extent,'cy'))||measuredRows)?action.patch.height:undefined,measuredRows));
      if(inherited&&transformEdits.length){
        const content=new OfficeXml(editor.edit(transformEdits)).source,properties=children(node,'spPr')[0];
        if(properties)edits.push(properties.selfClosing?doc.replaceContent(properties,content):{start:properties.openEnd,end:properties.openEnd,value:content});
        else{const at=children(node,'style')[0]?.start??children(node,'txBody')[0]?.start??children(node,'extLst')[0]?.start??node.closeStart;edits.push({start:at,end:at,value:`<p:spPr xmlns:p="${ns}">${content}</p:spPr>`});}
      }else if(!inherited)edits.push(...transformEdits);
    }else{
      // Reorder within the existing parent. Group-local transforms and all
      // object identities/relationships stay untouched.
      if(parent.children.some(child=>child.uri!==ns||!['nvGrpSpPr','grpSpPr','sp','pic','graphicFrame','cxnSp','grpSp','extLst'].includes(child.local)))throw new FileError('UNSUPPORTED','对象层级包含未知绘制节点，重排尚未应用');
      const siblings=nodes.filter(row=>row.parent===parent).map(row=>row.node),index=siblings.indexOf(node);
      const next=action.direction==='front'?siblings.length-1:action.direction==='back'?0:Math.max(0,Math.min(siblings.length-1,index+(action.direction==='forward'?1:-1)));
      if(next!==index){const at=next>index?siblings[next].end:siblings[next].start;edits.push({start:node.start,end:node.end,value:''},{start:at,end:at,value:doc.source.slice(node.start,node.end)});}
    }
  }
  if(!edits.length)return {packageData:file,plan:{changed:[],added:[],removed:[]}};
  const bytes=doc.edit(edits);if(bytes.equals(file.read(part)))return {packageData:file,plan:{changed:[],added:[],removed:[]}};
  const plan:OfficePartPlan={changed:[part],added:[],removed:[]},packageData=file.patch(new Map([[part,bytes]]),plan),after=new OfficePagesModel(packageData);
  if(action.type==='element-text'&&after.info.slides.find(slide=>slide.id===action.slideId)?.elements?.find(element=>element.id===String(Number(action.elementId)))?.text!==action.text.replace(/\r\n?/g,'\n'))throw new FileError('INVALID_INPUT','对象文字候选与输入不一致，未应用修改');
  if(action.type==='table-cell'&&after.info.slides.find(slide=>slide.id===action.slideId)?.elements?.find(element=>element.id===String(Number(action.elementId)))?.table?.cells[action.row]?.[action.column]?.text!==action.text.replace(/\r\n?/g,'\n'))throw new FileError('INVALID_INPUT','表格候选文字与输入不一致，未应用修改');
  if(action.type==='table-clear'){
    const table=after.info.slides.find(slide=>slide.id===action.slideId)?.elements?.find(element=>element.id===String(Number(action.elementId)))?.table;
    if(!table||pptxTableRangeCells(table,action.range).some(cell=>cell.text!==''))throw new FileError('INVALID_INPUT','表格选区未完整清除，修改尚未应用');
  }
  return {packageData,plan};
}
