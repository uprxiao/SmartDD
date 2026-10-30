import { FileError } from '@shared/files';
import type { PptxChartOptions } from '@shared/file-pptx-chart';
import { OfficeXml,attribute,children,descendants,type OfficeXmlNode,type XmlEdit } from './xml';
import type { ModernChartSource } from './pptx-chartex-data';
import { modernChartGeometry,type HistogramLayout } from './pptx-chartex-geometry';
import { CHARTEX } from './preview-capabilities';
import { MODERN_DRAWING,MODERN_GRID_COLOR } from './pptx-chartex-create';

const fail=(message:string):never=>{throw new FileError('UNSUPPORTED',`此图表预览尚未接入：${message}。原图表保留。`);};
function only(node:OfficeXmlNode,names:string[],attrs:string[]=[],ns=node.uri){
  if(node.children.some(child=>child.uri!==ns||!names.includes(child.local))||Object.values(node.attributes).some(attr=>attr.name!=='xmlns'&&attr.prefix!=='xmlns'&&(attr.uri!==''||!attrs.includes(attr.local))))fail('包含尚未适配的格式或布局');
}
function one(node:OfficeXmlNode,name:string,ns=node.uri){const found=children(node,name,ns);if(found.length!==1)fail(`${name} 来源缺失或重复`);return found[0];}
const boolean=(value:string|undefined)=>{if(value===undefined||value==='0'||value==='false')return false;if(value==='1'||value==='true')return true;return fail('显示设置无效');};
function rgb(fill:OfficeXmlNode){only(fill,['srgbClr'],[],MODERN_DRAWING);const color=one(fill,'srgbClr',MODERN_DRAWING);only(color,[],['val']);const raw=attribute(color,'val');if(!raw||!/^[0-9a-f]{6}$/i.test(raw))fail('颜色不是明确的 RGB');return raw!.toUpperCase();}
function line(prop:OfficeXmlNode){
  only(prop,['ln'],[],MODERN_DRAWING);const node=one(prop,'ln',MODERN_DRAWING);only(node,['solidFill'],['w'],MODERN_DRAWING);
  const width=Number(attribute(node,'w')??'12700');if(!Number.isInteger(width)||width<0||width>20116800)fail('线宽无效');
  return {color:rgb(one(node,'solidFill',MODERN_DRAWING)),width};
}
function pointColor(node:OfficeXmlNode){
  only(node,['spPr'],['idx']);const prop=one(node,'spPr');only(prop,['solidFill','ln'],[],MODERN_DRAWING);
  const stroke=one(prop,'ln',MODERN_DRAWING);only(stroke,['noFill'],[],MODERN_DRAWING);only(one(stroke,'noFill',MODERN_DRAWING),[],[]);
  return rgb(one(prop,'solidFill',MODERN_DRAWING));
}
function chartFont(root:OfficeXmlNode){
  const tx=one(root,'txPr');only(tx,['bodyPr','lstStyle','p'],[],MODERN_DRAWING);only(one(tx,'bodyPr',MODERN_DRAWING),[]);only(one(tx,'lstStyle',MODERN_DRAWING),[]);
  const p=one(tx,'p',MODERN_DRAWING);only(p,['pPr']);const props=one(p,'pPr');only(props,['defRPr']);const run=one(props,'defRPr');only(run,['solidFill','latin'],['sz']);
  const latin=one(run,'latin');only(latin,[],['typeface']);const family=attribute(latin,'typeface'),size=Number(attribute(run,'sz'));
  if(!family||family.length>256||!Number.isInteger(size)||size<100||size>40000)fail('文字样式尚未明确');
  return {family:family!,size,color:rgb(one(run,'solidFill'))};
}
/** Parses only source features whose complete display semantics are handled.
 * Unknown titles, theme/style parts, rich labels and hierarchy are preserved by
 * refusing projection, never silently stripped from a successful preview. */
export function modernChartDisplay(source:ModernChartSource){
  const {doc,chart,plot,chartPlot,data,type,values}=source;
  only(doc.root,['chartData','chart','spPr','txPr']);only(chart,['plotArea','legend']);only(plot,['plotAreaRegion','axis']);
  const font=chartFont(doc.root);
  const background=one(doc.root,'spPr');only(background,['noFill','ln'],[],MODERN_DRAWING);only(one(background,'noFill',MODERN_DRAWING),[],[]);
  const bgLine=one(background,'ln',MODERN_DRAWING);only(bgLine,['noFill'],[],MODERN_DRAWING);only(one(bgLine,'noFill',MODERN_DRAWING),[],[]);
  only(one(plot,'plotAreaRegion'),['series']);only(chartPlot,['dataPt','dataId','layoutPr','axisId'],['layoutId']);
  const layout=one(chartPlot,'layoutPr');only(layout,type==='histogram'?['aggregation','binning']:[]);
  only(data,['numDim','strDim'],['id']);const categories=children(data,'strDim'),binned=type==='histogram'&&children(layout,'binning').length===1;
  if(categories.length>1||!categories.length&&!binned)fail('分类维度尚未适配');
  let labels=values.map(String),categoryFormula:string|undefined;
  if(categories.length){
    const category=categories[0];only(category,['f','lvl'],['type']);if(attribute(category,'type')!=='cat')fail('分类维度尚未适配');
    const level=one(category,'lvl');only(level,['pt'],['ptCount']);const points=children(level,'pt');
    if(Number(attribute(level,'ptCount'))!==values.length||points.length!==values.length)fail('分类与数据数量不一致');
    labels=points.map((node,index)=>{only(node,[],['idx']);if(attribute(node,'idx')!==String(index)||!node.text||node.text.length>256)fail('分类数据稀疏、缺失或过长');return node.text;});
    categoryFormula=one(category,'f').text;
  }
  let histogram:HistogramLayout|undefined;
  if(type==='histogram'){
    if(layout.children.length!==1)fail('直方图分组规则不明确');
    const grouping=layout.children[0];
    if(grouping.local==='aggregation'){only(grouping,[]);histogram={kind:'category',categories:labels};}
    else{
      only(grouping,['binCount'],['intervalClosed']);const count=one(grouping,'binCount');only(count,[]);
      const closed=attribute(grouping,'intervalClosed');if(closed!=='l'&&closed!=='r')fail('直方图分箱边界未明确');
      histogram={kind:'bins',count:Number(count.text),closed:closed as 'l'|'r'};
    }
  }
  const rectangles=modernChartGeometry(type,values,labels,histogram),styles=children(chartPlot,'dataPt');
  if(styles.length!==(type==='histogram'?rectangles.length:values.length))fail('逐点格式尚未明确');
  const colors=styles.map((node,index)=>{if(attribute(node,'idx')!==String(index))fail('逐点格式编号不连续');return pointColor(node);});
  const references=children(chartPlot,'axisId').map(node=>{only(node,[]);return node.text;}),axes=children(plot,'axis');
  if(references.length!==2||new Set(references).size!==2||references.some(id=>!/^\d+$/.test(id)||Number(id)>4294967295)||axes.length!==2||new Set(axes.map(node=>attribute(node,'id'))).size!==2)fail('坐标轴引用尚未适配');
  const parsed=axes.map(axis=>{
    only(axis,['catScaling','valScaling','majorGridlines','spPr'],['id','hidden']);if(!references.includes(attribute(axis,'id')??''))fail('坐标轴引用不一致');
    const cat=children(axis,'catScaling'),val=children(axis,'valScaling');if(cat.length+val.length!==1)fail('坐标轴维度不明确');
    const scaling=cat[0]??val[0];only(scaling,[],cat.length?['gapWidth']:[]);
    if(cat.length&&Number(attribute(scaling,'gapWidth'))!==(type==='histogram'?(binned?0:2/190):30/190))fail('自定义分类间距尚未适配');
    const grids=children(axis,'majorGridlines');if(grids.length>1||cat.length&&grids.length)fail('此网格线布局尚未适配');
    const grid=grids[0];if(grid)only(grid,['spPr']);
    return {node:axis,horizontal:cat.length===1,hidden:boolean(attribute(axis,'hidden')),line:line(one(axis,'spPr')),grid:grid?line(one(grid,'spPr')):undefined};
  });
  if(parsed.filter(row=>row.horizontal).length!==1)fail('坐标轴维度重复');
  const legends=children(chart,'legend');if(legends.length>1)fail('图例重复');
  if(legends[0]){only(legends[0],[],['pos','align','overlay']);if(attribute(legends[0],'pos')!=='b'||attribute(legends[0],'align')!=='ctr'||boolean(attribute(legends[0],'overlay')))fail('自定义图例位置尚未适配');}
  // A related style/color definition can alter even apparently explicit
  // defaults. The caller additionally checks the chart relationship closure.
  return {font,labels,categoryFormula,colors,histogram,rectangles,axes:parsed,legend:legends.length===1,options:{hasAxes:true,axes:parsed.every(row=>!row.hidden),gridLines:parsed.some(row=>row.grid),legend:legends.length===1}};
}

export function editModernChartOptions(source:ModernChartSource,patch:PptxChartOptions):Buffer{
  const display=modernChartDisplay(source),{doc}=source,edits:XmlEdit[]=[],prefix=(node:OfficeXmlNode)=>node.name.includes(':')?node.name.slice(0,node.name.indexOf(':')+1):'';
  if(patch.axes!==undefined)for(const axis of display.axes)if(axis.hidden===patch.axes)edits.push(doc.setAttribute(axis.node,'hidden',patch.axes?'0':'1'));
  if(patch.gridLines!==undefined)for(const axis of display.axes.filter(row=>!row.horizontal)){
    const old=children(axis.node,'majorGridlines')[0];
    if(!patch.gridLines&&old)edits.push({start:old.start,end:old.end,value:''});
    if(patch.gridLines&&!old){const p=prefix(axis.node),at=one(axis.node,'spPr').start;edits.push({start:at,end:at,value:`<${p}majorGridlines><${p}spPr><a:ln xmlns:a="${MODERN_DRAWING}" w="12700"><a:solidFill><a:srgbClr val="${MODERN_GRID_COLOR}"/></a:solidFill></a:ln></${p}spPr></${p}majorGridlines>`});}
  }
  if(patch.legend!==undefined){const old=children(source.chart,'legend')[0];if(!patch.legend&&old)edits.push({start:old.start,end:old.end,value:''});else if(patch.legend&&!old){const at=source.chart.closeStart;edits.push({start:at,end:at,value:`<${prefix(source.chart)}legend pos="b" align="ctr" overlay="0"/>`});}}
  return doc.edit(edits);
}
