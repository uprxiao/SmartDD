import { FileError } from '@shared/files';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeXml,attribute,children } from './xml';
import { finishOfficeMutation } from './mutation';
import { patchOfficeSheetDependencies } from './sheet-dependencies';

/** Exact dependency patch; POI's setSheetName normalizes structured references
 * in the reviewed fixture, so its rewritten formula strings are never copied. */
export function renameOfficeSheet(file:OfficePackage,sheetId:string,name:string) {
  const model=new OfficeWorkbook(file),sheet=model.info.sheets.find(sheet=>sheet.id === sheetId),fold=(value:string)=>value.toLocaleLowerCase('en-US');
  if(!sheet)throw new FileError('CHANGED','工作表已不存在');
  if(!name || name.length>31 || /[\x00-\x1f\x7f\\/?*\[\]:\ufffe\uffff\ud800-\udfff]/u.test(name) || name.startsWith("'") || name.endsWith("'")) throw new FileError('INVALID_INPUT','工作表名称需为 1–31 个字符，不能包含非法字符或以单引号开头、结尾');
  if(model.info.sheets.some(value=>value.id !== sheetId && fold(value.name) === fold(name)))throw new FileError('INVALID_INPUT','已有同名工作表');
  if(sheet.name === name)return {packageData:file,sheetId,plan:{changed:[],added:[],removed:[]}};
  const change={oldName:sheet.name,newName:name,sheets:model.info.sheets.map(sheet=>sheet.name)};
  const changes=patchOfficeSheetDependencies(file,change);
  const updated=new OfficeXml(changes.get(model.graph.mainPart) ?? file.read(model.graph.mainPart)),updatedNode=children(children(updated.root,'sheets')[0],'sheet').find(node=>attribute(node,'sheetId') === sheetId)!;
  changes.set(model.graph.mainPart,updated.edit([updated.setAttribute(updatedNode,'name',name)]));
  const result=finishOfficeMutation(file,changes);
  return {packageData:result.packageData,sheetId,plan:{changed:result.changedParts,added:[],removed:result.removedParts}};
}
