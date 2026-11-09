import { FileError } from '@shared/files';
import { OfficeXml,children,copyOfficeNode,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';

/** Notes edits preserve unchanged paragraphs and individual run properties.
 * Complex fields/soft breaks stay explicit adapter gaps, not flattened text. */
export function editPptxTextBody(doc:OfficeXml,body:OfficeXmlNode,value:string,drawing:string,label='备注'):XmlEdit[]{
  const paragraphs=children(body,'p',drawing),next=value.replace(/\r\n?/g,'\n').split('\n');
  // Include visible fields and soft breaks when deciding whether a paragraph
  // changed. Otherwise clearing a field-only paragraph looks like a no-op and
  // a multi-cell action can silently leave it behind after clearing others.
  const text=(p:OfficeXmlNode)=>p.children.filter(node=>node.uri===drawing).map(node=>node.local==='br'?'\n':['r','fld'].includes(node.local)?children(node,'t')[0]?.text??'':'').join('');
  const valid=(p:OfficeXmlNode)=>{
    if(p.children.some(node=>node.uri!==drawing||!['pPr','r','endParaRPr'].includes(node.local)))throw new FileError('UNSUPPORTED',`${label}包含域、软换行或未知段落对象，当前修改尚未应用`);
    for(const run of children(p,'r'))if(children(run,'t').length!==1||run.children.some(node=>node.uri!==drawing||!['rPr','t'].includes(node.local)))throw new FileError('UNSUPPORTED',`${label}包含未知文本对象，当前修改尚未应用`);
  };
  const original=paragraphs.map(text);if(original.join('\n')===next.join('\n'))return [];
  // Unchanged suffix paragraphs retain their XML when inserting/removing lines.
  let first=0,last=0;while(first<Math.min(original.length,next.length)&&original[first]===next[first])first++;
  while(last<Math.min(original.length-first,next.length-first)&&original[original.length-last-1]===next[next.length-last-1])last++;
  const oldMiddle=paragraphs.slice(first,paragraphs.length-last),newMiddle=next.slice(first,next.length-last),edits:XmlEdit[]=[];
  oldMiddle.forEach(valid);
  const paragraph=(line:string,template?:OfficeXmlNode)=>{
    const pPr=template&&children(template,'pPr')[0],end=template&&children(template,'endParaRPr')[0],firstRun=template&&children(template,'r')[0],rPr=firstRun&&children(firstRun,'rPr')[0];
    return `<a:p xmlns:a="${drawing}">${pPr?copyOfficeNode(doc,pPr):''}${line?`<a:r>${rPr?copyOfficeNode(doc,rPr):''}<a:t xml:space="preserve">${xmlEscape(line)}</a:t></a:r>`:''}${end?copyOfficeNode(doc,end):''}</a:p>`;
  };
  const shared=Math.min(oldMiddle.length,newMiddle.length);
  for(let index=0;index<shared;index++){
    const p=oldMiddle[index],before=text(p),after=newMiddle[index];if(before===after)continue;
    const runs=children(p,'r'),texts=runs.map(run=>children(run,'t')[0]);
    if(!texts.length){
      // An empty original paragraph keeps its pPr/endParaRPr and attributes.
      const at=children(p,'endParaRPr')[0]?.start??p.closeStart;
      const addition=`<a:r xmlns:a="${drawing}"><a:t xml:space="preserve">${xmlEscape(after)}</a:t></a:r>`;
      edits.push(p.selfClosing?doc.replaceContent(p,addition):{start:at,end:at,value:addition});continue;
    }
    let prefix=0,suffix=0;
    while(prefix<Math.min(before.length,after.length)&&before[prefix]===after[prefix])prefix++;
    // Do not split a surrogate pair at an insertion boundary.
    if(prefix>0&&/[\uD800-\uDBFF]/.test(before[prefix-1]))prefix--;
    while(suffix<Math.min(before.length-prefix,after.length-prefix)&&before[before.length-suffix-1]===after[after.length-suffix-1])suffix++;
    if(suffix>0&&/[\uDC00-\uDFFF]/.test(before[before.length-suffix]))suffix--;
    const start=prefix,end=before.length-suffix,insertion=after.slice(prefix,after.length-suffix);let offset=0,inserted=false;
    for(let run=0;run<texts.length;run++){
      const node=texts[run],a=offset,b=offset+node.text.length;offset=b;
      const left=node.text.slice(0,Math.max(0,Math.min(node.text.length,start-a))),right=node.text.slice(Math.max(0,Math.min(node.text.length,end-a)));
      const contains=!inserted&&(start<b||run===texts.length-1),middle=contains?insertion:'';if(contains)inserted=true;
      // A run outside the changed interval is copied byte for byte.
      const candidate=b<=start&&!contains?node.text:a>=end&&!contains?node.text:left+middle+right;
      if(candidate!==node.text)edits.push(doc.replaceContent(node,xmlEscape(candidate)));
    }
  }
  for(const node of oldMiddle.slice(shared))edits.push({start:node.start,end:node.end,value:''});
  if(newMiddle.length>shared){
    const at=paragraphs[first+shared]?.start??body.closeStart,template=paragraphs[Math.max(0,first+shared-1)]??paragraphs[0];
    const extra=newMiddle.slice(shared).map(line=>paragraph(line,template)).join('');
    edits.push(body.selfClosing?doc.replaceContent(body,extra):{start:at,end:at,value:extra});
  }
  return edits;
}
