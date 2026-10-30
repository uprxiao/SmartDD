import {FileError} from '@shared/files';
import {OfficePackage} from './package';
import {OfficeWorkbook,officeRange} from './workbook';
import {OfficeXml,children,attribute,xmlEscape,type OfficeXmlNode,type XmlEdit} from './xml';
import {relationshipKind} from './relationships';
import {officePrefix} from './worksheet-edits';
import {encodeOfficeString} from './xstring';

/** Refresh only finite local references whose actual worksheet values changed.
 * No source open rewrites caches, and an unrelated edit cannot normalise an old
 * chart. Unknown/external references and every non-cache byte remain retained. */
export function refreshWorkbookChartCaches(before:OfficeWorkbook,file:OfficePackage):OfficePackage{
  if(file===before.packageData)return file;
  if(![...before.graph.bySource.values()].some(rows=>rows.some(row=>relationshipKind(row.type,'chart'))))return file;
  const after=new OfficeWorkbook(file),parts=new Set([...after.graph.bySource.values()].flatMap(rows=>rows.filter(row=>!row.external&&row.part&&relationshipKind(row.type,'chart')).map(row=>row.part!)));
  const changes=new Map<string,Uint8Array>(),memo=new Map<string,{type:string;value:string}[]|undefined>();let budget=0;
  const values=(formula:string)=>{
    if(memo.has(formula))return memo.get(formula);
    const match=/^(?:'((?:[^']|'')+)'|([^'!\[\]]+))!(\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}(?::\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6})?)$/.exec(formula);if(!match)return;
    const name=(match[1]?.replaceAll("''","'")??match[2]).toLocaleLowerCase('en-US'),sheet=after.info.sheets.find(value=>value.name.toLocaleLowerCase('en-US')===name);if(!sheet)return;
    let range:ReturnType<typeof officeRange>;try{range=officeRange(match[3]);}catch(error){if(error instanceof FileError)return;throw error;}if(range.firstColumn!==range.lastColumn||range.lastRow-range.firstRow>=1000)return;
    const previous=before.info.sheets.find(value=>value.id===sheet.id);if(!previous)return;
    budget+=range.lastRow-range.firstRow+1;if(budget>32000)throw new FileError('TOO_LARGE','本次图表引用更新超过 32000 点预算，修改尚未应用');
    const read=(book:OfficeWorkbook)=>Array.from({length:range.lastRow-range.firstRow+1},(_,i)=>{const cell=book.cell(sheet.id,range.firstRow+i,range.firstColumn);return{type:cell.type,value:cell.value};});
    const old=read(before),next=read(after),changed=old.some((cell,i)=>cell.type!==next[i].type||cell.value!==next[i].value)?next:undefined;memo.set(formula,changed);return changed;
  };
  for(const part of parts){
    const doc=new OfficeXml(file.read(part)),ns=doc.root.uri;if(doc.root.local!=='chartSpace'||!['http://schemas.openxmlformats.org/drawingml/2006/chart','http://purl.oclc.org/ooxml/drawingml/chart'].includes(ns))continue;
    const chart=children(doc.root,'chart')[0],plot=chart&&children(chart,'plotArea')[0];if(!plot)continue;
    const plots=plot.children.filter(node=>node.local.endsWith('Chart'));if(plots.length!==1||!['barChart','lineChart','pieChart','areaChart','scatterChart'].includes(plots[0].local))continue;
    const series=children(plots[0],'ser');if(series.length>16)continue;const edits:XmlEdit[]=[];
    const refresh=(ref:OfficeXmlNode)=>{
      const numeric=ref.local==='numRef',formulas=children(ref,'f'),caches=children(ref,numeric?'numCache':'strCache');if(formulas.length!==1||caches.length!==1)return;
      const cache=caches[0];if(cache.children.some(node=>node.uri!==ns||!['formatCode','ptCount','pt','extLst'].includes(node.local)))return;
      const data=values(formulas[0].text);if(!data)return;
      const prefix=officePrefix(cache),format=children(cache,'formatCode').map(node=>doc.slice(node)).join(''),ext=children(cache,'extLst').map(node=>doc.slice(node)).join('');
      const points=data.map((cell,index)=>{
        if(numeric&&(cell.type!=='number'||!cell.value.trim()||!Number.isFinite(Number(cell.value))))return '';
        const value=numeric?String(Number(cell.value)):encodeOfficeString(cell.value);
        return `<${prefix}pt idx="${index}"><${prefix}v>${xmlEscape(value)}</${prefix}v></${prefix}pt>`;
      }).join('');
      const content=`${format}<${prefix}ptCount val="${data.length}"/>${points}${ext}`;
      edits.push(doc.replaceContent(cache,content));
    };
    for(const item of series)for(const tag of ['tx','cat','val','xVal','yVal'])for(const container of children(item,tag))for(const ref of container.children)if(ref.uri===ns&&['strRef','numRef'].includes(ref.local))refresh(ref);
    if(edits.length){const next=doc.edit(edits);if(!next.equals(file.read(part)))changes.set(part,next);}
  }
  return changes.size?file.patch(changes,{changed:[...changes.keys()],added:[],removed:[]}):file;
}
