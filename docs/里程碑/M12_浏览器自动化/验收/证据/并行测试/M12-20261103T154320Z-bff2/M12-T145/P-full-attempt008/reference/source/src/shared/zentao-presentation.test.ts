import {describe,expect,it} from 'vitest';
import {parseZentaoPresentation,zentaoDisplayFields,zentaoValueText} from './zentao-presentation';

const language={bug:{project:'所属项目',pri:'优先级',priList:['','P0','P1','P2'],severityList:{3:'较大'},typeList:{codeerror:'代码错误'},statusList:{active:'激活'}},story:{priList:{3:'客户定义的需求优先级'}}};
describe('ZenTao display semantics from the current server',()=>{
 it('uses customized numeric choices, including PHP lists encoded as JSON arrays',()=>{
  const presentation=parseZentaoPresentation(language,'bug')!;
  const rows=zentaoDisplayFields({pri:'3',severity:'3',type:'codeerror',status:'active'},presentation);
  expect(rows.map(row=>row.text)).toEqual(['P2','较大','代码错误','激活']);
  expect(zentaoDisplayFields({pri:'3'},parseZentaoPresentation(language,'story')!)[0].text).toBe('客户定义的需求优先级');
 });
 it('uses supplied relation names, preserves IDs, and unfolds version object arrays',()=>{
  const source={project:'1521',projectName:'示例项目',product:'96',productName:'示例产品',module:'7773',moduleTitle:'测试模块',openedBuild:[{id:'1579',title:'dev-beta'}]},before=JSON.stringify(source);
  const rows=zentaoDisplayFields(source,parseZentaoPresentation(language,'bug')!);
  expect(rows.map(row=>row.text)).toEqual(['示例项目（#1521）','示例产品（#96）','测试模块（#7773）','dev-beta']);
  expect(rows.map(row=>row.key)).not.toContain('projectName');expect(JSON.stringify(source)).toBe(before);
  expect(JSON.stringify(rows)).not.toContain('[object Object]');
 });
 it('retains unknown codes and raw values when metadata cannot explain them',()=>{
  expect(zentaoDisplayFields({pri:'3'})[0].text).toBe('3');
  expect(zentaoDisplayFields({status:'custom-later'},parseZentaoPresentation(language,'bug')!)[0].text).toBe('custom-later');
  expect(zentaoDisplayFields({project:'1521',projectName:''})[0].text).toBe('1521');
 });
 it('formats empty versions, named people and structured extension fields without string coercion',()=>{
  expect(zentaoValueText([])).toBe('—');expect(zentaoValueText([{realname:'张三'},{title:'版本B'}])).toBe('张三、版本B');
  expect(zentaoValueText({custom:[1,2]})).toBe('{"custom":[1,2]}');
 });
 it('rejects unusable dictionaries and excludes nested objects from enum choices',()=>{
  expect(parseZentaoPresentation({story:language.story},'bug')).toBeNull();
  expect(parseZentaoPresentation({bug:{statusList:{active:{html:'not a label'},closed:'已关闭'}}},'bug')?.choices.status).toEqual({closed:'已关闭'});
 });
});
