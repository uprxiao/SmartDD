export function fixture() {
  const manifest = {
    schema: 'willyou-plugin/v0-draft2', id: 'demo-tracker', version: '0.1.0', hostApi: 1,
    displayName: 'Demo Tracker', description: 'Synthetic P1 plugin', permissions: ['network'],
    providers: [{id: 'tracker-api', displayName: 'Tracker', config: {type: 'object', additionalProperties: false, properties: {baseUrl: {type: 'string'}}}, summaryFields: ['baseUrl']}],
    capabilities: {'demo-tracker.items.list': {title: 'List', permission: 'demo-tracker.read', semantics: 'read', retry: 'safe-read', slots: ['tracker-api'], input: 'schemas/input.json', output: 'schemas/output.json'}},
    runtime: {type: 'process', entry: 'runtime/main.mjs', protocol: 'jsonrpc-stdio/1'}, skills: [],
    ui: {panels: [{id: 'items', title: 'Items', kind: 'list', source: {capability: 'demo-tracker.items.list', items: 'items'}, rowKey: 'id', columns: [{field: 'id', title: 'ID'}, {field: 'title', title: 'Title'}]}]},
  };
  const files = new Map<string, Buffer>([
    ['runtime/main.mjs', Buffer.from('// Synthetic plugin')],
    ['schemas/input.json', Buffer.from(JSON.stringify({type: 'object', additionalProperties: false, properties: {}}))],
    ['schemas/output.json', Buffer.from(JSON.stringify({type: 'object', required: ['items'], properties: {items: {type: 'array', items: {type: 'object', required: ['id', 'title'], properties: {id: {type: 'string'}, title: {type: 'string'}}}}}}))],
  ]);
  const bundle = () => new Map([...files, ['.willyou-plugin/plugin.json', Buffer.from(JSON.stringify(manifest))] as [string, Buffer]]);
  return {manifest, files, bundle};
}

