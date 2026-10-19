// Synthetic test fixture. This is not a production chart writer.
import { OfficePackage } from './package';
import { OFFICE_REL } from './relationships';

export function modernChartFixture(file:OfficePackage,type:'funnel'|'histogram'|'waterfall'|'treemap'){
  const legacy='http://schemas.openxmlformats.org/drawingml/2006/chart',cx='http://schemas.microsoft.com/office/drawing/2014/chartex';
  const chart=file.read('ppt/charts/chart1.xml').toString(),embedded=/r:id="([^"]+)"/.exec(chart)![1];
  const dimension=type==='treemap'?'size':'val',layout=type==='histogram'?'clusteredColumn':type;
  const parts=new Map<string,Uint8Array>([
    ['ppt/slides/slide1.xml',Buffer.from(file.read('ppt/slides/slide1.xml').toString().replaceAll(legacy,cx))],
    ['ppt/slides/_rels/slide1.xml.rels',Buffer.from(file.read('ppt/slides/_rels/slide1.xml.rels').toString().replace(`${OFFICE_REL}/chart"`,'http://schemas.microsoft.com/office/2014/relationships/chartEx"'))],
    ['[Content_Types].xml',Buffer.from(file.read('[Content_Types].xml').toString().replace('application/vnd.openxmlformats-officedocument.drawingml.chart+xml','application/vnd.ms-office.chartex+xml'))],
    ['ppt/charts/chart1.xml',Buffer.from(`<cx:chartSpace xmlns:cx="${cx}" xmlns:r="${OFFICE_REL}"><cx:chartData><cx:externalData r:id="${embedded}"/><cx:data id="0"><cx:numDim type="${dimension}"><cx:f>Sheet1!$B$2:$B$3</cx:f><cx:lvl ptCount="2"><cx:pt idx="0">9</cx:pt><cx:pt idx="1">4</cx:pt></cx:lvl></cx:numDim></cx:data></cx:chartData><cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="${layout}"><cx:dataId val="0"/>${type==='histogram'?'<cx:layoutPr><cx:binning intervalClosed="r"/></cx:layoutPr>':''}</cx:series></cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>`)],
  ]);
  return file.patch(parts,{changed:[...parts.keys()],added:[],removed:[]});
}
