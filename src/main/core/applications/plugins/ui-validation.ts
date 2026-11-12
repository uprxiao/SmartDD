import {ApplicationError} from '@shared/applications';
import {isPluginFieldPath, type PluginManifest} from '@shared/plugins';
import type {JsonSchema} from './package';

const record = (value: unknown): JsonSchema | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonSchema : undefined;
export function validatePluginUi(manifest: PluginManifest, schemas: ReadonlyMap<string, JsonSchema>): void {
  const fail = (message: string): never => { throw new ApplicationError('INVALID_PACKAGE', '插件界面声明无效：' + message); };
  const refs = new Map([...schemas.values()].filter(s => typeof s.$id === 'string').map(s => [s.$id as string, s]));
  const deref = (schema: JsonSchema | undefined, seen = new Set<string>()): JsonSchema | undefined => {
    if (!schema) return undefined;
    if (typeof schema.$ref === 'string') {
      if (seen.has(schema.$ref)) return undefined;
      seen.add(schema.$ref); return deref(refs.get(schema.$ref), seen);
    }
    return schema;
  };
  const at = (schema: JsonSchema | undefined, path: string): JsonSchema | undefined => {
    let current = deref(schema);
    if (path && !isPluginFieldPath(path)) return undefined;
    for (const part of path ? path.split('.') : []) {
      current = deref(current);
      const union = current?.oneOf ?? current?.anyOf;
      if (Array.isArray(union)) current = deref(union.map(record).find(item => item?.type !== 'null'));
      current = deref(record(record(current?.properties)?.[part]));
    }
    return current;
  };
  const arrayItems = (schema: JsonSchema | undefined, path: string) => {
    const array = at(schema, path); return array?.type === 'array' ? deref(record(array.items)) : undefined;
  };
  const requireField = (schema: JsonSchema | undefined, path: string, where: string) => at(schema, path) ?? fail(`${where} 字段不存在 ${path}`);
  const template = (value: unknown, where: string, scopes: Record<string, (path: string) => boolean>): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
        const dot = match[1].indexOf('.'), scope = match[1].slice(0, dot), path = match[1].slice(dot + 1);
        if (dot < 1 || !isPluginFieldPath(path) || !scopes[scope]?.(path)) fail(`${where} 模板字段不存在 ${match[1]}`);
      }
    } else if (value && typeof value === 'object') for (const child of Object.values(value)) template(child, where, scopes);
  };
  const sourceSchemas = (capability: string) => {
    const cap = manifest.capabilities[capability];
    if (!cap) return fail(`能力不存在 ${capability}`);
    if (cap.semantics !== 'read') return fail(`页面数据源必须为读取能力 ${capability}`);
    return {input: schemas.get(cap.input), output: schemas.get(cap.output)};
  };
  const actionContract=(action:PluginManifest['ui']['panels'][number]['rowActions'][number],schema:JsonSchema|undefined,where:string)=>{
    if(action.kind==='insertTerminal'&&(!action.payload||!Object.keys(action.payload).length||action.field))fail(`${where} 插入动作需要引用 payload，不能使用 field`);
    if(action.kind==='openUrl'){
      if(Boolean(action.field)===Boolean(action.payload))fail(`${where} 打开网址须且只能声明 field 或 payload.url`);
      if(action.field&&requireField(schema,action.field,where).type!=='string')fail(`${where} 网址字段须为字符串`);
      if(action.payload&&(Object.keys(action.payload).length!==1||typeof action.payload.url!=='string'))fail(`${where} 网址 payload 只接受 url 字符串`);
    }
  };
  for (const provider of manifest.providers) for (const path of provider.summaryFields) requireField(provider.config, path, '连接摘要');
  const ids = new Set<string>();
  for (const panel of manifest.ui.panels) {
    if (ids.has(panel.id)) fail(`页面标识重复 ${panel.id}`); ids.add(panel.id);
    const where = `panel ${panel.id}`, contract = sourceSchemas(panel.source.capability);
    const items = panel.source.items ? arrayItems(contract.output, panel.source.items) : undefined;
    if (!items) fail(`${where} items 不是已声明的数组`);
    requireField(items, panel.rowKey, where);
    for (const column of panel.columns) requireField(items, column.field, where);
    const provider = panel.requires && manifest.providers.find(p => p.id === panel.requires?.projectConnection);
    if (panel.requires && !provider) fail(`${where} 连接不存在`);
    const connectionScope = (path: string) => path.startsWith('summary.') && manifest.providers.some(p => p.summaryFields.includes(path.slice(8)));
    template(panel.subtitle, where, {connection: connectionScope});
    if (new Set(panel.tabs.map(tab => tab.id)).size !== panel.tabs.length) fail(`${where} 页签重复`);
    for (const tab of panel.tabs) for (const [key, value] of Object.entries(tab.input)) {
      const property = requireField(contract.input, key, where);
      if (Array.isArray(property.enum) && !property.enum.includes(value)) fail(`${where} 页签枚举不匹配 ${key}`);
    }
    for (const [key, value] of Object.entries(panel.source.input ?? {})) {
      requireField(contract.input, key, where);
      template(value, where, {connection: connectionScope, tab: path => path === 'title' || path.startsWith('input.') && !!at(contract.input, path.slice(6))});
    }
    const pagination = panel.source.pagination;
    if (pagination) { requireField(contract.input, pagination.inputField, where); requireField(contract.output, pagination.nextField, where); }
    const checkPartial = (source: typeof panel.source, output: JsonSchema | undefined) => {
      if (source.presentationField) requireField(output, source.presentationField, where);
      if (source.partial) {
        if (requireField(output, source.partial.completeField, where).type !== 'boolean') fail(`${where} completeField 必须为 boolean`);
        for (const path of [source.partial.problemsField, source.partial.missingField]) if (path && !arrayItems(output, path)) fail(`${where} 部分结果字段不是数组 ${path}`);
      }
    };
    checkPartial(panel.source, contract.output);
    if (panel.onRowOpen && !Object.hasOwn(panel.details, panel.onRowOpen.detail)) fail(`${where} 详情不存在`);
    for (const [id, detail] of Object.entries(panel.details)) {
      const dw = `${where} detail ${id}`, dc = sourceSchemas(detail.source.capability);
      const scopes = {
        connection: connectionScope,
        tab: (path: string) => path === 'title' || path.startsWith('input.') && !!at(contract.input, path.slice(6)),
        row: (path: string) => !!at(items, path), value: (path: string) => !!at(dc.output, path),
      };
      template(detail.titleTemplate, dw, scopes);
      for (const [key, value] of Object.entries(detail.source.input ?? {})) { requireField(dc.input, key, dw); template(value, dw, {...scopes, value: () => false}); }
      checkPartial(detail.source, dc.output);
      for (const section of detail.sections) {
        requireField(dc.output, section.from, dw);
        for (const path of [section.labels, section.enums]) if (path) requireField(dc.output, path, dw);
        if (section.kind !== 'fields') {
          if (!section.read) fail(`${dw} 资源缺少读取能力`);
          const reader = sourceSchemas(section.read!);
          if (!Array.isArray(reader.input?.required) || !reader.input.required.includes('resource')) fail(`${dw} 资源能力不接受 resource`);
        }
        if (section.kind === 'resourceList') {
          const props = arrayItems(dc.output, section.from);
          if (!props || !section.nameField || !section.resourceField) fail(`${dw} 附件列表声明不完整`);
          requireField(props, section.nameField!, dw); requireField(props, section.resourceField!, dw);
        }
      }
      for (const action of detail.actions) {actionContract(action,dc.output,dw);template(action.payload, dw, scopes);}
    }
    for (const action of panel.rowActions) {
      actionContract(action,items,where);
      if (action.field) requireField(items, action.field, where);
      template(action.payload, where, {row: path => !!at(items, path), connection: connectionScope});
    }
  }
}
