import {ApplicationError} from './applications';
import {boundedJson} from './application-bridge';
import {isPluginFieldPath,type PluginPanel} from './plugins';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const invalid=(message:string):never=>{throw new ApplicationError('INVALID_RESPONSE',message);};
/** Own properties only. A declaration can never traverse prototypes or execute a getter from a non-JSON value. */
export function pluginUiField(value:unknown,path:string):unknown {
  if(!isPluginFieldPath(path))throw new ApplicationError('INVALID_PACKAGE','插件界面字段路径无效');
  let current=value;for(const key of path.split('.')){if(!object(current)||!Object.hasOwn(current,key))return undefined;const property=Object.getOwnPropertyDescriptor(current,key);if(!property||!('value'in property))return undefined;current=property.value;}
  return current;
}
/** Public host metadata for display only; never an execution or credential scope. */
export interface PluginUiConnectionSelection {
  mode:'follow'|'individual';
  connections:{slot:string;connectionId:string;name:string}[];
}
export interface PluginUiScopes {tab?:unknown;row?:unknown;value?:unknown;connection?:unknown}
/** Exact placeholders retain JSON types (notably opaque resource/reference objects). Embedded text stays plain text. */
export function resolvePluginUiTemplate(template:unknown,scopes:PluginUiScopes):unknown {
  if(!boundedJson(template))throw new ApplicationError('INVALID_PACKAGE','插件界面模板不是有界 JSON');
  const lookup=(expression:string):unknown=>{
    const dot=expression.indexOf('.'),scope=expression.slice(0,dot),path=expression.slice(dot+1);
    if(dot<1||!['tab','row','value','connection'].includes(scope)||!Object.hasOwn(scopes,scope))throw new ApplicationError('INVALID_PACKAGE','插件界面模板作用域无效');
    const value=pluginUiField(scopes[scope as keyof PluginUiScopes],path);if(value===undefined)return invalid('插件返回数据缺少界面模板所需字段');
    if(!boundedJson(value))return invalid('插件界面模板引用的值不是有界 JSON');return value;
  };
  const resolve=(value:unknown):unknown=>{
    if(typeof value==='string'){
      const exact=/^\{([^{}]+)\}$/.exec(value);if(exact)return structuredClone(lookup(exact[1]));
      return value.replace(/\{([^{}]+)\}/g,(_match,expression:string)=>{const found=lookup(expression);if(found!==null&&typeof found==='object')return invalid('结构化引用不能嵌入界面文本');return found===null?'':String(found);});
    }
    if(Array.isArray(value))return value.map(resolve);
    if(object(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolve(item)]));
    return value;
  };
  const result=resolve(template);if(!boundedJson(result))throw new ApplicationError('INVALID_PACKAGE','插件界面解析结果超过预算');return result;
}

export function pluginPanelInput(panel:PluginPanel,scopes:PluginUiScopes):Record<string,unknown> {
  const tabInput=pluginUiField(scopes.tab,'input')??{},sourceInput=resolvePluginUiTemplate(panel.source.input??{},scopes);
  if(!object(tabInput)||!object(sourceInput))throw new ApplicationError('INVALID_PACKAGE','列表输入必须为对象');return{...tabInput,...sourceInput};
}
export interface PluginListView {
  rows:readonly {key:string;value:Record<string,unknown>}[];
  nextCursor:string|null;complete:boolean;problems:readonly string[];presentation:unknown;
}
/** Missing/malformed data is an error; a partial list remains visibly partial instead of becoming fake empty success. */
export function pluginListView(panel:PluginPanel,value:unknown):PluginListView {
  if(!boundedJson(value)||!object(value))return invalid('插件列表结果不是有界 JSON 对象');
  const rows=panel.source.items?pluginUiField(value,panel.source.items):undefined;if(!Array.isArray(rows))return invalid('插件列表结果缺少行数组');
  const keys=new Set<string>(),result=rows.map(row=>{
    if(!object(row))return invalid('插件列表行不是对象');const key=pluginUiField(row,panel.rowKey);
    if((typeof key!=='string'&&typeof key!=='number')||!String(key)||keys.has(String(key)))return invalid('插件列表行标识缺失或重复');keys.add(String(key));return{key:String(key),value:row};
  });
  const cursor=panel.source.pagination?pluginUiField(value,panel.source.pagination.nextField):null;
  if(cursor!==null&&(typeof cursor!=='string'||!cursor))return invalid('插件列表分页游标无效');
  const partial=panel.source.partial,complete=partial?pluginUiField(value,partial.completeField):true;
  if(typeof complete!=='boolean')return invalid('插件列表完整性标记无效');
  const problemsField=partial?.problemsField??partial?.missingField,problems=problemsField?pluginUiField(value,problemsField):[];
  if(!Array.isArray(problems))return invalid('插件列表缺失说明无效');
  const messages=problems.map(problem=>typeof problem==='string'?problem:object(problem)&&typeof problem.code==='string'?problem.code:invalid('插件列表问题说明无效'));
  return{rows:result,nextCursor:cursor,complete,problems:messages,presentation:panel.source.presentationField?pluginUiField(value,panel.source.presentationField):undefined};
}
