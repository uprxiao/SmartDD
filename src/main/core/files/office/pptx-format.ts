import type { PptxTextFormat,PptxTextStyle } from '@shared/file-pptx-format';
import { OfficeXml,attribute,children,copyOfficeNode,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';
import { FileError } from '@shared/files';

const colorFills=['noFill','solidFill','gradFill','blipFill','pattFill','grpFill'];
const runOrder=['ln',...colorFills,'effectLst','effectDag','highlight','uLnTx','uLn','uFillTx','uFill','latin','ea','cs','sym','hlinkClick','hlinkMouseOver','rtl','extLst'];
const paragraphOrder=['lnSpc','spcBef','spcAft','buClrTx','buClr','buSzTx','buSzPct','buSzPts','buFontTx','buFont','buNone','buAutoNum','buChar','buBlip','tabLst','defRPr','extLst'];
const alignNames={left:'l',center:'ctr',right:'r',justify:'just'} as const;

/** Replace a known choice, keeping unrelated children and their raw source.
 * No HTML/CSS serialization participates in a saved candidate. */
function childChoice(source:string,drawing:string,names:string[],value:string|undefined,order:readonly string[]):string{
  const doc=new OfficeXml(Buffer.from(source)),root=doc.root,matched=root.children.filter(node=>node.uri===drawing&&names.includes(node.local));
  const edits:XmlEdit[]=matched.map(node=>({start:node.start,end:node.end,value:''}));
  if(value){
    const position=Math.min(...names.map(name=>order.indexOf(name)).filter(index=>index>=0));
    const at=matched[0]?.start??root.children.find(node=>node.uri===drawing&&order.indexOf(node.local)>position)?.start??root.closeStart;
    if(root.selfClosing)edits.push(doc.replaceContent(root,value));else edits.push({start:at,end:at,value});
  }
  return edits.length?new OfficeXml(doc.edit(edits)).source:source;
}
const nodeXml=(doc:OfficeXml,node:OfficeXmlNode|undefined,local:string,drawing:string)=>{
  if(node)return copyOfficeNode(doc,node);
  const namespaces=new Map(Object.values(doc.root.attributes).filter(attr=>attr.name==='xmlns'||attr.prefix==='xmlns').map(attr=>[attr.name,attr.value]));namespaces.set('xmlns:a',drawing);
  return `<a:${local}${[...namespaces].map(([name,value])=>` ${name}="${xmlEscape(value)}"`).join('')}/>`;
};
function formatRun(source:string,font:NonNullable<PptxTextFormat['font']>,drawing:string):string{
  let doc=new OfficeXml(Buffer.from(source));const edits:XmlEdit[]=[];
  for(const [key,name] of [['bold','b'],['italic','i'],['underline','u'],['strike','strike'],['points','sz']] as const){
    const value=font[key];if(value===undefined)continue;
    const raw=key==='points'?String(Math.round(Number(value)*100)):key==='underline'?value?'sng':'none':key==='strike'?value?'sngStrike':'noStrike':value?'1':'0';
    if(attribute(doc.root,name)!==raw)edits.push(doc.setAttribute(doc.root,name,raw));
  }
  if(edits.length)source=new OfficeXml(doc.edit(edits)).source;
  if(font.color!==undefined)source=childChoice(source,drawing,colorFills,`<a:solidFill xmlns:a="${drawing}"><a:srgbClr val="${font.color.slice(1).toUpperCase()}"/></a:solidFill>`,runOrder);
  // The reviewed choices are Latin faces. Preserve East Asian/complex-script
  // fonts and theme fallback; forcing Arial into a:ea can produce tofu glyphs.
  if(font.family!==undefined)source=childChoice(source,drawing,['latin'],font.family===null?undefined:`<a:latin xmlns:a="${drawing}" typeface="${xmlEscape(font.family)}"/>`,runOrder);
  return source;
}
function formatParagraph(doc:OfficeXml,paragraph:OfficeXmlNode,patch:PptxTextFormat,drawing:string):string{
  const pdoc=new OfficeXml(Buffer.from(copyOfficeNode(doc,paragraph))),p=pdoc.root,properties=children(p,'pPr',drawing)[0],edits:XmlEdit[]=[];
  let ppr=nodeXml(pdoc,properties,'pPr',drawing);
  if(patch.align!==undefined){const value=new OfficeXml(Buffer.from(ppr));ppr=new OfficeXml(value.edit([value.setAttribute(value.root,'algn',alignNames[patch.align])])).source;}
  if(patch.list!==undefined){
    const content=patch.list==='none'?'<a:buNone':patch.list==='bullet'?'<a:buChar char="•"':'<a:buAutoNum type="arabicPeriod"';
    ppr=childChoice(ppr,drawing,['buNone','buAutoNum','buChar','buBlip'],`${content} xmlns:a="${drawing}"/>`,paragraphOrder);
  }
  if(patch.font){
    const value=new OfficeXml(Buffer.from(ppr)),defaults=children(value.root,'defRPr',drawing)[0];
    ppr=childChoice(ppr,drawing,['defRPr'],formatRun(nodeXml(value,defaults,'defRPr',drawing),patch.font,drawing),paragraphOrder);
    for(const run of p.children.filter(node=>node.uri===drawing&&['r','br','fld'].includes(node.local))){
      const rpr=children(run,'rPr',drawing)[0],formatted=formatRun(nodeXml(pdoc,rpr,'rPr',drawing),patch.font,drawing);
      if(rpr)edits.push({start:rpr.start,end:rpr.end,value:formatted});else edits.push(run.selfClosing?pdoc.replaceContent(run,formatted):{start:run.openEnd,end:run.openEnd,value:formatted});
    }
    const end=children(p,'endParaRPr',drawing)[0],formatted=formatRun(nodeXml(pdoc,end,'endParaRPr',drawing),patch.font,drawing);
    if(end)edits.push({start:end.start,end:end.end,value:formatted});else edits.push({start:p.closeStart,end:p.closeStart,value:formatted});
  }
  if(properties)edits.push({start:properties.start,end:properties.end,value:ppr});else edits.push({start:p.openEnd,end:p.openEnd,value:ppr});
  if(p.selfClosing)return new OfficeXml(pdoc.edit([pdoc.replaceContent(p,ppr+(patch.font?formatRun(nodeXml(pdoc,undefined,'endParaRPr',drawing),patch.font,drawing):''))])).source;
  return new OfficeXml(pdoc.edit(edits)).source;
}
export function editPptxTextFormat(doc:OfficeXml,body:OfficeXmlNode,patch:PptxTextFormat,drawing:string):XmlEdit[]{
  const paragraphs=children(body,'p',drawing);if(!paragraphs.length)throw new FileError('UNSUPPORTED','此对象没有可编辑段落');
  return paragraphs.map(paragraph=>({start:paragraph.start,end:paragraph.end,value:formatParagraph(doc,paragraph,patch,drawing)})).filter(edit=>doc.source.slice(edit.start,edit.end)!==edit.value);
}

const boolean=(value:string|undefined)=>value==='true'||value==='1'?true:value==='false'||value==='0'?false:undefined;
function readRun(node:OfficeXmlNode|undefined,drawing:string):PptxTextStyle{
  if(!node)return {};
  const values:PptxTextStyle={},size=attribute(node,'sz'),font=children(node,'latin',drawing)[0],face=font&&attribute(font,'typeface');
  if(size&&/^\d+$/.test(size)&&Number(size)>=100&&Number(size)<=400000)values.points=Number(size)/100;
  if(face!==undefined)values.family=face&&!face.startsWith('+')?face:undefined;
  for(const [key,name] of [['bold','b'],['italic','i']] as const){const value=boolean(attribute(node,name));if(value!==undefined)values[key]=value;}
  const underline=attribute(node,'u'),strike=attribute(node,'strike');if(underline)values.underline=underline!=='none';if(strike)values.strike=strike!=='noStrike';
  const fill=children(node,'solidFill',drawing)[0],color=fill&&children(fill,'srgbClr',drawing)[0],rgb=color&&attribute(color,'val');
  if(node.children.some(child=>child.uri===drawing&&colorFills.includes(child.local)))values.color=rgb&&/^[0-9a-f]{6}$/i.test(rgb)&&!color!.children.length?`#${rgb.toLowerCase()}`:undefined;
  return values;
}
/** Local cascade only. Unresolved theme/master properties stay absent, and
 * mixed runs remain marked mixed rather than appearing uniformly formatted. */
export function pptxTextStyle(body:OfficeXmlNode,drawing:string):PptxTextStyle{
  const samples:PptxTextStyle[]=[],listStyle=children(body,'lstStyle',drawing)[0];
  for(const paragraph of children(body,'p',drawing)){
    const ppr=children(paragraph,'pPr',drawing)[0],level=ppr?Number(attribute(ppr,'lvl')??0):0;
    const list=listStyle&&Number.isInteger(level)&&level>=0&&level<=8?children(listStyle,`lvl${level+1}pPr`,drawing)[0]:undefined;
    const inherited=list?children(list,'defRPr',drawing)[0]:undefined,defaults=ppr&&children(ppr,'defRPr',drawing)[0];
    const baseline={...readRun(inherited,drawing),...readRun(defaults,drawing)};
    const align=ppr&&attribute(ppr,'algn')||list&&attribute(list,'algn');for(const [label,raw] of Object.entries(alignNames))if(align===raw)baseline.align=label as PptxTextStyle['align'];
    const bullet=[ppr,list].filter(Boolean).map(node=>node!.children.find(child=>child.uri===drawing&&['buNone','buChar','buAutoNum','buBlip'].includes(child.local))).find(Boolean);
    if(bullet&&bullet.local!=='buBlip')baseline.list=bullet.local==='buNone'?'none':bullet.local==='buChar'?'bullet':'number';
    const runs=paragraph.children.filter(node=>node.uri===drawing&&['r','br','fld'].includes(node.local));
    for(const run of runs)samples.push({...baseline,...readRun(children(run,'rPr',drawing)[0],drawing)});
    if(!runs.length)samples.push({...baseline,...readRun(children(paragraph,'endParaRPr',drawing)[0],drawing)});
  }
  const result:PptxTextStyle={},mixed:string[]=[];
  for(const key of ['family','points','bold','italic','underline','strike','color','align','list'] as const){
    const first=samples[0]?.[key];if(samples.some(sample=>sample[key]!==first))mixed.push(key);else if(first!==undefined)Object.assign(result,{[key]:first});
  }
  if(mixed.length)result.mixed=mixed;return result;
}
