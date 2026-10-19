import { FileError } from '@shared/files';
import type { OfficePackage } from './package';
import { OfficeRelationships } from './relationships';
import { OfficeXml,attribute,children,descendants,xmlEscape,type XmlEdit,type OfficeXmlNode } from './xml';
import { rewriteOfficeSheetReferences,type OfficeSheetReferenceChange } from './sheet-references';
import {CONTROL_NS,EXCEL_NS} from './checkbox';

const formulaNamespaces=new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main','http://schemas.openxmlformats.org/drawingml/2006/chart','http://purl.oclc.org/ooxml/drawingml/chart','http://schemas.microsoft.com/office/excel/2006/main']);
const formulaNames=new Set(['f','definedName','formula','formula1','formula2','calculatedColumnFormula','totalsRowFormula']);

/** Updates the registered dependency fields, never an engine's whole document.
 * The supplied package already contains the final sheet identities/order. */
export function patchOfficeSheetDependencies(file:OfficePackage,change:OfficeSheetReferenceChange):Map<string,Uint8Array|null> {
  const graph=new OfficeRelationships(file),changes=new Map<string,Uint8Array|null>();
  for(const part of file.names()) {
    const type=graph.contentTypes.get(part) ?? '';
    if(part !== graph.mainPart && !/\.(worksheet|table|chart|pivotCacheDefinition|controlproperties)\+xml$/.test(type) && type!=='application/vnd.openxmlformats-officedocument.vmlDrawing')continue;
    const doc=new OfficeXml(file.read(part)),stack:{node:OfficeXmlNode;parent?:OfficeXmlNode}[]=[{node:doc.root}],edits:XmlEdit[]=[],removedCaches=new Set<OfficeXmlNode>();
    while(stack.length) {
      const {node,parent}=stack.pop()!;stack.push(...node.children.map(child=>({node:child,parent:node})));
      if(node.uri===CONTROL_NS && node.local==='formControlPr')for(const key of ['fmlaLink','fmlaRange','fmlaGroup','fmlaTxbx']) {
        const value=attribute(node,key);if(value){const text=rewriteOfficeSheetReferences(value,change);if(text!==value)edits.push(doc.setAttribute(node,key,text));}
      }
      if(node.uri===EXCEL_NS && ['FmlaLink','FmlaRange','FmlaGroup','FmlaTxbx'].includes(node.local) && node.text){const text=rewriteOfficeSheetReferences(node.text,change);if(text!==node.text)edits.push(doc.replaceContent(node,xmlEscape(text)));}
      if(formulaNames.has(node.local) && node.text) {
        if(!formulaNamespaces.has(node.uri)) throw new FileError('UNSUPPORTED','工作簿含尚未适配的公式扩展，原件和草稿仍保留');
        if(node.local === 'f' && !['normal','shared','array'].includes(attribute(node,'t') ?? 'normal')) throw new FileError('UNSUPPORTED','此公式存储类型尚未接入工作表依赖修改');
        const text=rewriteOfficeSheetReferences(node.text,change);
        if(text !== node.text) {
          edits.push(doc.replaceContent(node,xmlEscape(text)));
          // A deleted reference must not retain an apparently valid chart value.
          if(change.newName === null && parent && /\/chart$/.test(node.uri)) for(const cache of [...children(parent,'numCache'),...children(parent,'strCache')])removedCaches.add(cache);
        }
      }
      if(node.local === 'hyperlink' && formulaNamespaces.has(node.uri)) {
        const location=attribute(node,'location');if(location){const text=rewriteOfficeSheetReferences(location,change);if(text !== location)edits.push(doc.setAttribute(node,'location',text));}
      }
      if(node.local === 'worksheetSource' && formulaNamespaces.has(node.uri) && attribute(node,'sheet')?.toLocaleLowerCase('en-US') === change.oldName.toLocaleLowerCase('en-US')) {
        if(change.newName === null)throw new FileError('UNSUPPORTED','仍有数据透视缓存引用该工作表，删除依赖适配尚未完成；原件和草稿仍保留');
        edits.push(doc.setAttribute(node,'sheet',change.newName));
      }
    }
    if(descendants(doc.root,'f').some(node=>attribute(node,'t') === 'dataTable'))throw new FileError('UNSUPPORTED','数据表公式的工作表依赖尚未接入，原件和草稿仍保留');
    for(const cache of removedCaches)edits.push({start:cache.start,end:cache.end,value:''});
    if(edits.length)changes.set(part,doc.edit(edits));
  }
  return changes;
}
