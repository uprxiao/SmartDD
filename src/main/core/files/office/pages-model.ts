import { FileError } from '@shared/files';
import type { OfficePagesInfo,OfficeSlideInfo } from '@shared/file-office-pages';
import { OfficePackage } from './package';
import { OfficeRelationships,OFFICE_REL,STRICT_REL,relationshipKind } from './relationships';
import { OfficeXml,attribute,children,descendants,type OfficeXmlNode } from './xml';
import { pptxElements } from './pptx-elements';
import { PptxGeometryResolver } from './pptx-geometry';
import { pptxChartInfo } from './pptx-chart';
import { unsupportedOfficeCharts } from './preview-capabilities';

const P='http://schemas.openxmlformats.org/presentationml/2006/main',PS='http://purl.oclc.org/ooxml/presentationml/main';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',WS='http://purl.oclc.org/ooxml/wordprocessingml/main';
const A='http://schemas.openxmlformats.org/drawingml/2006/main',AS='http://purl.oclc.org/ooxml/drawingml/main';
const invalid=(message:string):never=>{throw new FileError('INVALID_INPUT',message);};
const bool=(value:string|undefined,fallback:boolean)=>value===undefined?fallback:value==='1'||value==='true'?true:value==='0'||value==='false'?false:invalid('Office 布尔属性无效');
const rid=(node:OfficeXmlNode)=>attribute(node,'id',OFFICE_REL)??attribute(node,'id',STRICT_REL)??invalid('幻灯片关系编号缺失');
function text(node:OfficeXmlNode,drawing:string):string {
  return descendants(node,'p',drawing).map(p=>{
    const out:string[]=[];
    const walk=(n:OfficeXmlNode)=>{if(n.uri===drawing && n.local==='t')out.push(n.text);else if(n.uri===drawing && n.local==='br')out.push('\n');else for(const child of n.children)walk(child);};walk(p);return out.join('');
  }).join('\n');
}

/** Validates every declared XML part before native layout. Package identities,
 * slide order and notes come from source OOXML, never inferred from PDF pages. */
export class OfficePagesModel {
  readonly info:OfficePagesInfo;
  readonly graph:OfficeRelationships;
  constructor(readonly packageData:OfficePackage){
    const graph=this.graph=new OfficeRelationships(packageData);
    if(graph.kind!=='docx' && graph.kind!=='pptx')throw new FileError('UNSUPPORTED','此入口只接受 DOCX 和 PPTX 文档');
    const xml=new Map<string,OfficeXml>();
    for(const name of packageData.names())if(/\.(?:xml|rels)$/i.test(name)||/(?:\+xml|\/xml)$/.test(graph.contentTypes.get(name)??''))xml.set(name,new OfficeXml(packageData.read(name)));
    const read=(name:string)=>xml.get(name)??invalid(`Office XML 部件类型无效：${name}`);
    const unsupportedCharts=unsupportedOfficeCharts(graph,read),previewSupport=unsupportedCharts.length?{unsupportedCharts}:{};
    const main=read(graph.mainPart).root,externalLinks=[...graph.bySource.values()].flat().filter(row=>row.external).length;
    if(graph.kind==='docx'){
      if(main.local!=='document'||![W,WS].includes(main.uri)||children(main,'body').length!==1)invalid('DOCX 正文结构无效');
      const hasRevisions=[...xml.values()].some(doc=>[W,WS].includes(doc.root.uri)&&['ins','del','moveFrom','moveTo'].some(name=>descendants(doc.root,name,doc.root.uri).length>0));
      this.info={kind:'docx',signed:graph.signed,externalLinks,hasRevisions,slides:[],...previewSupport};return;
    }
    if(main.local!=='presentation'||![P,PS].includes(main.uri))invalid('PPTX 演示文稿结构无效');
    const ns=main.uri,drawing=ns===P?A:AS,lists=children(main,'sldIdLst');
    if(lists.length>1)invalid('幻灯片列表重复');
    const entries=lists[0]?children(lists[0],'sldId'):[];
    if(!entries.length)throw new FileError('UNSUPPORTED','演示文稿没有可预览的幻灯片');
    if(entries.length>2000)throw new FileError('TOO_LARGE','演示文稿超过 2000 页');
    const size=children(main,'sldSz')[0],width=Number(size&&attribute(size,'cx')),height=Number(size&&attribute(size,'cy'));
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>51206400||height>51206400)invalid('幻灯片画布尺寸无效');
    const ids=new Set<string>(),parts=new Set<string>(),geometry=new PptxGeometryResolver(graph,read);let characters=0;
    const slides:OfficeSlideInfo[]=entries.map((entry,index)=>{
      const id=attribute(entry,'id')??'',relation=graph.forPart(graph.mainPart).find(row=>row.id===rid(entry));
      if(!/^\d+$/.test(id)||Number(id)<256||Number(id)>2147483647||ids.has(id)||!relation?.part||relation.external||!relationshipKind(relation.type,'slide'))invalid('幻灯片身份或关系无效');
      ids.add(id);const part=relation!.part!;if(parts.has(part))invalid('多张幻灯片指向同一内容');parts.add(part);
      const slide=read(part).root;if(slide.uri!==ns||slide.local!=='sld')invalid('幻灯片内容类型不匹配');
      const shapeTree=children(children(slide,'cSld')[0]??slide,'spTree')[0];if(!shapeTree)invalid('幻灯片对象树缺失');
      const shapes=descendants(shapeTree!,'sp',ns);
      const titleShape=shapes.find(shape=>descendants(shape,'ph',ns).some(ph=>['title','ctrTitle'].includes(attribute(ph,'type')??'')));
      const title=(titleShape?text(titleShape,drawing):'').trim().slice(0,256)||`幻灯片 ${index+1}`;
      const noteRelations=graph.forPart(part).filter(row=>relationshipKind(row.type,'notesSlide'));
      if(noteRelations.length>1||noteRelations.some(row=>row.external||!row.part))invalid('幻灯片备注关系无效');
      let notes='';
      if(noteRelations[0]){
        const note=read(noteRelations[0].part!).root;if(note.uri!==ns||note.local!=='notes')invalid('幻灯片备注类型无效');
        notes=descendants(note,'sp',ns).filter(shape=>{
          const ph=descendants(shape,'ph',ns)[0];return !ph||['body','obj'].includes(attribute(ph,'type')??'obj');
        }).map(shape=>text(shape,drawing)).filter(Boolean).join('\n');
      }
      characters+=title.length+notes.length;if(characters>2*1024*1024)throw new FileError('TOO_LARGE','幻灯片标题与备注超过预览预算');
      const common=children(slide,'cSld')[0],bg=common&&children(common,'bg')[0],background=bg&&children(bg,'bgPr')[0];
      const fill=background&&children(background,'solidFill',drawing)[0],color=fill&&children(fill,'srgbClr',drawing)[0],rgb=color&&attribute(color,'val');
      return {id,title,notes,hidden:!bool(attribute(slide,'show'),true),elements:pptxElements(read(part),(node,parent)=>geometry.resolve(part,node,parent),node=>pptxChartInfo(graph,part,node,read)),...(color&&!color.children.length&&rgb&&/^[a-f0-9]{6}$/i.test(rgb)?{background:`#${rgb.toLowerCase()}`}:{})};
    });
    this.info={kind:'pptx',signed:graph.signed,externalLinks,hasRevisions:false,slides,width:width/12700,height:height/12700,...previewSupport};
    if(Buffer.byteLength(JSON.stringify(this.info))>2*1024*1024)throw new FileError('TOO_LARGE','幻灯片对象与文字元数据超过预览预算');
  }
}
