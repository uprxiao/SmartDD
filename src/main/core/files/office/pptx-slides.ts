import { posix } from 'node:path';
import { FileError } from '@shared/files';
import type { PptxAction } from '@shared/file-pptx';
import type { OfficePartPlan } from '@shared/file-office';
import { OfficePagesModel } from './pages-model';
import { OfficePackage } from './package';
import { OfficeXml,attribute,children,descendants,copyOfficeNode,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';
import { OFFICE_REL,STRICT_REL,OPC_REL,relationshipKind,relationshipPart,type OfficeRelationship } from './relationships';

type Action=Extract<PptxAction,{type:'add'|'duplicate'|'delete'}>;
const P14='http://schemas.microsoft.com/office/powerpoint/2010/main';
const pref=(node:OfficeXmlNode)=>node.name.includes(':')?node.name.slice(0,node.name.indexOf(':')+1):'';
const rid=(node:OfficeXmlNode)=>attribute(node,'id',OFFICE_REL)??attribute(node,'id',STRICT_REL);
const append=(doc:OfficeXml,node:OfficeXmlNode,value:string):XmlEdit=>node.selfClosing?doc.replaceContent(node,value):{start:node.closeStart,end:node.closeStart,value};
const remove=(node:OfficeXmlNode):XmlEdit=>({start:node.start,end:node.end,value:''});
const relTarget=(source:string,target:string)=>posix.relative(posix.dirname(source),target);

/** Structure edits operate on the package relationship graph. Mutable clone
 * dependencies are independent; deletion removes only the retired closure. */
export function editPptxSlides(model:OfficePagesModel,action:Action):{packageData:OfficePackage;plan:OfficePartPlan}{
  const file=model.packageData,graph=model.graph,main=new OfficeXml(file.read(graph.mainPart)),ns=main.root.uri;
  const drawing=ns.includes('purl.oclc.org')?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main';
  const relationNs=ns.includes('purl.oclc.org')?STRICT_REL:OFFICE_REL;
  const list=children(main.root,'sldIdLst')[0],entries=children(list,'sldId'),entry=entries.find(node=>attribute(node,'id')===action.slideId);
  if(!entry)throw new FileError('CHANGED','幻灯片已不存在');
  const relationId=rid(entry)!,part=graph.target(graph.mainPart,relationId),presentationRels=relationshipPart(graph.mainPart),mainRels=new OfficeXml(file.read(presentationRels));
  const changes=new Map<string,Uint8Array|null>(),mainEdits:XmlEdit[]=[],typeEdits:XmlEdit[]=[];
  const types=new OfficeXml(file.read('[Content_Types].xml'));
  const occupied=new Set(file.names().map(name=>decodeURIComponent(name).toLowerCase()));
  const partKey=(name:string)=>decodeURIComponent(name).toLowerCase();
  const allocate=(original:string,label:string)=>{
    let index=1,name:string;
    do{name=posix.join(posix.dirname(original),`willyou-${label}-${index++}${posix.extname(original)}`);}while(occupied.has(partKey(name))||occupied.has(partKey(relationshipPart(name))));
    occupied.add(partKey(name));occupied.add(partKey(relationshipPart(name)));return name;
  };
  const addType=(name:string,type:string)=>`<${pref(types.root)}Override PartName="/${xmlEscape(name)}" ContentType="${xmlEscape(type)}"/>`;

  if(action.type==='delete'){
    if(entries.length<=1)throw new FileError('UNSUPPORTED','至少保留一张幻灯片');
    mainEdits.push(remove(entry));
    // Custom shows use relationship ids; Office 2010 sections use slide ids.
    for(const show of descendants(main.root,'custShow',ns))for(const node of descendants(show,'sld',ns))if(rid(node)===relationId)mainEdits.push(remove(node));
    for(const node of descendants(main.root,'sldId',P14))if(Number(attribute(node,'id'))===Number(action.slideId))mainEdits.push(remove(node));
    const rows=new Map(graph.bySource),withoutTarget=(items:readonly OfficeRelationship[])=>items.filter(row=>row.part!==part);
    const reachable=()=>{
      const found=new Set<string>(),stack=[''];
      while(stack.length){const name=stack.pop()!;if(found.has(name)||name===part)continue;found.add(name);const rels=relationshipPart(name);if(file.has(rels))found.add(rels);
        for(const row of rows.get(name)??[])if(!row.external&&row.part&&row.part!==part)stack.push(row.part);
      }return found;
    };
    const live=reachable();
    for(const [source,relations] of graph.bySource){
      if(!live.has(source)||!relations.some(row=>row.part===part))continue;
      const deleted=relations.filter(row=>row.part===part),relationsName=relationshipPart(source),doc=new OfficeXml(file.read(relationsName));
      let relEdits=children(doc.root,'Relationship').filter(node=>deleted.some(row=>row.id===attribute(node,'Id'))).map(remove);
      if(source===graph.mainPart){
        if(deleted.some(row=>row.id!==relationId))throw new FileError('UNSUPPORTED','演示文稿含重复或未知页关系，删除尚未应用');
      }else{
        const sourceDoc=new OfficeXml(file.read(source));
        if(sourceDoc.root.local==='notes'&&sourceDoc.root.uri===ns){
          // A shared notes part can survive deletion. Preserve its contents and
          // retarget its single back-reference to the remaining owning slide.
          const owners=[...graph.bySource].filter(([owner,links])=>owner!==part&&live.has(owner)&&links.some(link=>link.part===source&&relationshipKind(link.type,'notesSlide'))).map(([owner])=>owner);
          if(owners.length!==1||deleted.length!==1||!relationshipKind(deleted[0].type,'slide'))throw new FileError('UNSUPPORTED','共享备注的所属幻灯片不明确，删除尚未应用');
          const link=children(doc.root,'Relationship').find(node=>attribute(node,'Id')===deleted[0].id)!;
          relEdits=[doc.setAttribute(link,'Target',relTarget(source,owners[0]))];
          rows.set(source,relations.map(row=>row.id===deleted[0].id?{...row,part:owners[0],target:relTarget(source,owners[0])}:row));
        }else{
          const ids=new Set(deleted.map(row=>row.id)),edits:XmlEdit[]=[];
          const visit=(node:OfficeXmlNode)=>{
            const references=Object.values(node.attributes).filter(value=>[OFFICE_REL,STRICT_REL].includes(value.uri)&&ids.has(value.value));
            if(references.length){
              if(node.uri!==drawing||!['hlinkClick','hlinkMouseOver'].includes(node.local))throw new FileError('UNSUPPORTED','其他部件含尚未适配的页引用，删除尚未应用');
              edits.push(remove(node));return;
            }for(const child of node.children)visit(child);
          };visit(sourceDoc.root);if(edits.length)changes.set(source,sourceDoc.edit(edits));
        }
      }
      if(!rows.has(source)||rows.get(source)===relations)rows.set(source,withoutTarget(relations));
      changes.set(relationsName,doc.edit(relEdits));
    }
    const remaining=reachable(),retired=[...graph.reachable([part])].filter(name=>!remaining.has(name));
    for(const name of retired)changes.set(name,null);
    const retiredSet=new Set(retired);
    for(const node of children(types.root,'Override'))if(retiredSet.has(graph.resolve('',attribute(node,'PartName')!)))typeEdits.push(remove(node));
  }else{
    if(entries.length>=2000)throw new FileError('TOO_LARGE','演示文稿最多 2000 页');
    const used=new Set(entries.map(node=>Number(attribute(node,'id'))));let slideId=Math.max(...used)+1;
    if(slideId>2147483647){slideId=256;while(used.has(slideId))slideId++;}
    const ids=new Set(graph.forPart(graph.mainPart).map(row=>row.id));let number=1;while(ids.has(`rIdWillYouSlide${number}`))number++;const newRid=`rIdWillYouSlide${number}`;
    const newPart=allocate(part,'slide');let registration='';
    if(action.type==='add'){
      const layouts=graph.forPart(part).filter(row=>relationshipKind(row.type,'slideLayout'));
      if(layouts.length!==1||layouts[0].external||!layouts[0].part)throw new FileError('UNSUPPORTED','当前幻灯片没有可复用的布局，新增尚未应用');
      const layout=new OfficeXml(file.read(layouts[0].part!));
      if(layout.root.uri!==ns||layout.root.local!=='sldLayout')throw new FileError('INVALID_INPUT','幻灯片布局类型无效');
      let shapeId=2,placeholders='';
      for(const shape of descendants(layout.root,'sp',ns)){
        const ph=descendants(shape,'ph',ns)[0];if(!ph||['dt','ftr','hdr','sldNum'].includes(attribute(ph,'type')??''))continue;
        if(ph.children.length)throw new FileError('UNSUPPORTED','布局占位符含未知扩展，新增尚未应用');
        const id=shapeId++,properties=descendants(shape,'cNvPr',ns)[0];
        if(!properties)throw new FileError('INVALID_INPUT','布局占位符缺少对象属性');
        const name=attribute(properties,'name')??`Placeholder ${id}`;
        placeholders+=`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr/><p:nvPr>${copyOfficeNode(layout,ph)}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
      }
      changes.set(newPart,Buffer.from(`<p:sld xmlns:p="${ns}" xmlns:a="${drawing}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${placeholders}</p:spTree></p:cSld></p:sld>`));
      changes.set(relationshipPart(newPart),Buffer.from(`<Relationships xmlns="${OPC_REL}"><Relationship Id="rIdLayout" Type="${relationNs}/slideLayout" Target="${xmlEscape(relTarget(newPart,layouts[0].part!))}"/></Relationships>`));
      registration=addType(newPart,graph.contentTypes.get(part)!);
    }else{
      const copies=new Map<string,string>([[part,newPart]]),stack=[part],slideParts=new Set(entries.map(node=>graph.target(graph.mainPart,rid(node)!)));
      const immutable=['slideLayout','slideMaster','notesMaster','handoutMaster','theme','image','audio','video','media'];
      while(stack.length){
        const source=stack.pop()!;
        for(const row of graph.forPart(source)){
          if(row.external||!row.part||copies.has(row.part)||immutable.some(kind=>relationshipKind(row.type,kind))||slideParts.has(row.part))continue;
          if(row.part===graph.mainPart||row.part==='[Content_Types].xml')throw new FileError('UNSUPPORTED','幻灯片依赖指向包入口，复制尚未应用');
          copies.set(row.part,allocate(row.part,'copy'));stack.push(row.part);
        }
      }
      for(const [source,target] of copies){
        changes.set(target,file.read(source));registration+=addType(target,graph.contentTypes.get(source)!);
        const rels=relationshipPart(source);if(!file.has(rels))continue;
        const doc=new OfficeXml(file.read(rels)),edits:XmlEdit[]=[];
        for(const node of children(doc.root,'Relationship')){
          const row=graph.forPart(source).find(item=>item.id===attribute(node,'Id'))!;if(row.external||!row.part)continue;
          const fragment=row.target.includes('#')?row.target.slice(row.target.indexOf('#')):'';
          edits.push(doc.setAttribute(node,'Target',relTarget(target,copies.get(row.part)??row.part)+fragment));
        }
        changes.set(relationshipPart(target),doc.edit(edits));
      }
    }
    changes.set(presentationRels,mainRels.edit([append(mainRels,mainRels.root,`<${pref(mainRels.root)}Relationship Id="${newRid}" Type="${relationNs}/slide" Target="${xmlEscape(relTarget(graph.mainPart,newPart))}"/>`)]));
    // The approved insert toolbar appends a new page. Duplication stays next
    // to its source; both keep the selected source's layout unchanged.
    const anchor=action.type==='add'?entries.at(-1)!:entry;
    mainEdits.push({start:anchor.end,end:anchor.end,value:`<${pref(list)}sldId id="${slideId}" xmlns:r="${relationNs}" r:id="${newRid}"/>`});
    for(const node of descendants(main.root,'sldId',P14))if(Number(attribute(node,'id'))===Number(attribute(anchor,'id')))mainEdits.push({start:node.end,end:node.end,value:`<${pref(node)}sldId id="${slideId}"/>`});
    if(!children(types.root,'Default').some(node=>attribute(node,'Extension')?.toLowerCase()==='rels'))registration+=`<${pref(types.root)}Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`;
    typeEdits.push(append(types,types.root,registration));
  }
  if(mainEdits.length)changes.set(graph.mainPart,main.edit(mainEdits));
  if(typeEdits.length)changes.set('[Content_Types].xml',types.edit(typeEdits));
  for(const [name,value] of changes)if(value&&file.has(name)&&file.read(name).equals(Buffer.from(value)))changes.delete(name);
  const plan:OfficePartPlan={changed:[],added:[],removed:[]};
  for(const [name,value] of changes)(plan[value===null?'removed':file.has(name)?'changed':'added'] as string[]).push(name);
  const packageData=file.patch(changes,plan);new OfficePagesModel(packageData);return {packageData,plan};
}
