import {createHash} from 'node:crypto';
import type {OfficeFloatingVector} from '@shared/file-office';
import {WORKBOOK_SHAPES} from '@shared/file-workbook-drawing';
import {FileError} from '@shared/files';
import type {OfficePackage} from './package';
import {OFFICE_REL,STRICT_REL,relationshipKind,type OfficeRelationships} from './relationships';
import {OfficeXml,attribute,children,descendants,type OfficeXmlNode} from './xml';
import {officeDrawingAnchor} from './drawing-images';
import {decodeOfficeString} from './xstring';

const DRAW='http://schemas.openxmlformats.org/drawingml/2006/main',CHART='http://schemas.openxmlformats.org/drawingml/2006/chart';
const fail=():never=>{throw new FileError('UNSUPPORTED','此绘图结构尚未适配，原对象保留');};
const one=(node:OfficeXmlNode,name:string,uri=node.uri)=>{const values=children(node,name,uri);return values.length===1?values[0]:fail();};
const chartNames={barChart:'bar',lineChart:'line',pieChart:'pie',areaChart:'area',scatterChart:'scatter'} as const;
function chartData(doc:OfficeXml):NonNullable<OfficeFloatingVector['chart']>{
  const root=doc.root;if(root.local!=='chartSpace'||![CHART,'http://purl.oclc.org/ooxml/drawingml/chart'].includes(root.uri))fail();
  const plot=one(one(root,'chart'),'plotArea'),plots=plot.children.filter(node=>node.local.endsWith('Chart'));
  if(plots.length!==1||!Object.hasOwn(chartNames,plots[0].local))fail();
  const type=chartNames[plots[0].local as keyof typeof chartNames],series=children(plots[0],'ser');if(!series.length||series.length>16)fail();
  const points=(parent:OfficeXmlNode,numeric:boolean):(string|null)[]=>{
    const formula=parent.children.length===1&&parent.children[0].local.endsWith('Ref')?children(parent.children[0],'f')[0]:undefined;if(formula?.text.includes('#REF!'))fail();
    const cache=parent.children.length===1&&parent.children[0].local.endsWith('Ref')?one(parent.children[0],numeric?'numCache':'strCache'):one(parent,numeric?'numLit':'strLit');
    const count=Number(attribute(one(cache,'ptCount'),'val')),values=children(cache,'pt');
    if(!Number.isInteger(count)||count<1||count>1000||values.length>count)fail();const output=Array<string|null>(count).fill(numeric?null:'');const used=new Set<number>();
    for(const point of values){const raw=attribute(point,'idx'),index=Number(raw);if(!raw||!/^\d+$/.test(raw)||!Number.isInteger(index)||index<0||index>=count||used.has(index))fail();used.add(index);const value=decodeOfficeString(one(point,'v').text);if(value.length>4096||numeric&&(!value.trim()||!Number.isFinite(Number(value))))fail();output[index]=value;}return output;
  };
  const numeric=(value:string|null)=>value===null?null:Number(value);
  const name=(node:OfficeXmlNode,index:number)=>{const tx=children(node,'tx')[0];if(!tx)return String(index+1);const direct=children(tx,'v')[0];return (direct?decodeOfficeString(direct.text):points(tx,false)[0])?.slice(0,256)||String(index+1);};
  const yTag=type==='scatter'?'yVal':'val',data=series.map((node,index)=>({name:name(node,index),values:points(one(node,yTag),true).map(numeric)}));
  if(data.some(value=>value.values.length!==data[0].values.length)||data[0].values.length*data.length>16000)fail();
  if(type==='pie'&&data.some(series=>series.values.some(value=>value!==null&&value<0)))fail();
  const categories=type==='scatter'?points(one(series[0],'xVal'),true):points(one(series[0],'cat'),false);if(categories.length!==data[0].values.length)fail();
  if(series.slice(1).some(node=>JSON.stringify(points(one(node,type==='scatter'?'xVal':'cat'),type==='scatter'))!==JSON.stringify(categories)))fail();
  return {type,categories:categories.map(value=>value??''),series:data,...(type==='scatter'?{x:categories.map(numeric)}:{})};
}

/** Project finite local DrawingML vectors. Unknown graphs/effects keep the
 * existing retained-content warning; no links, scripts or provider are run. */
export function officeDrawingVectors(file:OfficePackage,graph:OfficeRelationships,sheetPart:string,sheet:OfficeXml):OfficeFloatingVector[]{
  const result:OfficeFloatingVector[]=[];let totalPoints=0;
  for(const declaration of children(sheet.root,'drawing')){
    const rid=attribute(declaration,'id',OFFICE_REL)??attribute(declaration,'id',STRICT_REL),relation=graph.forPart(sheetPart).find(row=>row.id===rid);
    if(!relation?.part||relation.external||!relationshipKind(relation.type,'drawing'))continue;
    try{
      const root=new OfficeXml(file.read(relation.part)).root;
      if(root.local!=='wsDr'||!['http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing'].includes(root.uri))continue;
      const ids=descendants(root,'cNvPr',root.uri).map(node=>attribute(node,'id'));
      for(const anchor of root.children.filter(node=>['oneCellAnchor','twoCellAnchor','absoluteAnchor'].includes(node.local)))for(const node of anchor.children.filter(node=>node.uri===root.uri&&['sp','graphicFrame'].includes(node.local))){
        if(result.length>=512)return result;
        try{
          const prop=one(one(node,node.local==='sp'?'nvSpPr':'nvGraphicFramePr'),'cNvPr'),id=attribute(prop,'id');if(!id||!/^\d+$/.test(id)||ids.filter(value=>value===id).length!==1)continue;
          const uri=root.uri.includes('purl.oclc.org')?'http://purl.oclc.org/ooxml/drawingml/main':DRAW;
          const item:OfficeFloatingVector={id:createHash('sha256').update(JSON.stringify([relation.part,id])).digest('hex'),kind:node.local==='sp'?'shape':'chart',name:(attribute(prop,'name')??'').slice(0,256),source:{part:relation.part,id},anchor:officeDrawingAnchor(anchor)};
          if(node.local==='sp'){
            const properties=one(node,'spPr'),geometry=attribute(one(properties,'prstGeom',uri),'prst'),transform=children(properties,'xfrm',uri)[0];
            if(!geometry||!(WORKBOOK_SHAPES as readonly string[]).includes(geometry)||transform&&['rot','flipH','flipV'].some(key=>!['0','false',undefined].includes(attribute(transform,key))))continue;
            if(properties.children.some(value=>value.uri!==uri||!['xfrm','prstGeom','solidFill','noFill','ln'].includes(value.local)))continue;
            const colour=(parent:OfficeXmlNode|undefined,fallback:string)=>{const fill=parent&&children(parent,'solidFill',uri)[0],rgb=fill&&children(fill,'srgbClr',uri)[0],value=rgb&&attribute(rgb,'val');return value&&/^[a-f0-9]{6}$/i.test(value)?'#'+value:fallback;};
            const line=children(properties,'ln',uri)[0];
            const nonVisual=children(one(node,'nvSpPr'),'cNvSpPr')[0],textBox=!!nonVisual&&['1','true'].includes(attribute(nonVisual,'txBox')??''),body=children(node,'txBody')[0];
            if(textBox){if(children(sheet.root,'drawing').length!==1)continue;item.id=createHash('sha256').update(JSON.stringify([sheetPart,id,'text'])).digest('hex');}
            const value=body?children(body,'p',uri).map(p=>p.children.map(run=>run.local==='br'?'\n':descendants(run,'t',uri).map(t=>decodeOfficeString(t.text)).join('')).join('')).join('\n'):'';
            item.shape={geometry,arrow:!!line&&children(line,'headEnd',uri).some(value=>attribute(value,'type')==='triangle'),fill:colour(properties,'transparent'),stroke:line&&children(line,'noFill',uri).length?'transparent':colour(line,'#106c61'),text:value.slice(0,32767),...(textBox?{textBox:true}:{})};
          }else{
            const data=one(one(node,'graphic',uri),'graphicData',uri),ref=data.children.find(value=>value.local==='chart');if(!ref)continue;
            const chartId=attribute(ref,'id',OFFICE_REL)??attribute(ref,'id',STRICT_REL),target=graph.forPart(relation.part).find(value=>value.id===chartId);
            if(!target?.part||target.external||!relationshipKind(target.type,'chart'))continue;
            item.chart=chartData(new OfficeXml(file.read(target.part)));totalPoints+=item.chart.series.reduce((count,value)=>count+value.values.length,0);if(totalPoints>32000)continue;
          }
          result.push(item);
        }catch(error){if(!(error instanceof FileError))throw error;}
      }
    }catch(error){if(!(error instanceof FileError))throw error;}
  }
  return result;
}
