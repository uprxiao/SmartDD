import { OfficeXml, children, type XmlEdit } from './xml';
import { officePrefix } from './worksheet-edits';

/** calcPr has a schema-ordered slot before custom views and pivot metadata. */
export function markOfficeCalculationDirty(book:OfficeXml):XmlEdit[] {
  const calc=children(book.root,'calcPr')[0];
  if (calc) return [book.setAttribute(calc,'fullCalcOnLoad','1'),book.setAttribute(calc,'forceFullCalc','1')];
  const following=new Set(['oleSize','customWorkbookViews','pivotCaches','smartTagPr','smartTagTypes','webPublishing','fileRecoveryPr','webPublishObjects','extLst']);
  const at=book.root.children.find(node=>node.uri === book.root.uri && following.has(node.local))?.start ?? book.root.closeStart;
  return [{start:at,end:at,value:`<${officePrefix(book.root)}calcPr fullCalcOnLoad="1" forceFullCalc="1"/>`}];
}
