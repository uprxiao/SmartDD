import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectPluginDirectory, validatePluginBundle} from '../package';

import {fixture} from './fixture';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

describe('external plugin install validation', () => {
  it('declares the actual old v2 ZenTao tools with their distinct wire contracts',()=>{
    const manifest=JSON.parse(readFileSync('plugins/zentao/package/.willyou-plugin/plugin.json','utf8'));
    for(const [name,id] of Object.entries({smartdd_zentao_work_list_v2:'zentao.object.list',smartdd_zentao_object_get_v2:'zentao.object.get',smartdd_zentao_resource_v2:'zentao.resource.read'})){
      expect(manifest.legacyToolNames[name]).toBe(id);
      expect(manifest.legacyToolContracts[name].result).toBe('application-v2');
    }
  });

  it('rejects orphaned legacy contracts, invalid schemas and duplicate projection fields',()=>{
    const f=fixture(),contract={input:'schemas/input.json',output:'schemas/output.json',result:'application-v2',dataFields:['items']};
    Object.assign(f.manifest,{legacyToolContracts:{smartdd_demo_list_v2:contract}});
    expect(()=>validatePluginBundle(f.bundle())).toThrow('对应工具名');
    Object.assign(f.manifest,{legacyToolNames:{smartdd_demo_list_v2:'demo-tracker.items.list'}});
    contract.dataFields.push('items');expect(()=>validatePluginBundle(f.bundle())).toThrow('字段重复');contract.dataFields.pop();
    contract.output='schemas/missing.json';expect(()=>validatePluginBundle(f.bundle())).toThrow('missing.json');
  });
  it('validates a complete package and binds the digest to all bytes, not directory order', () => {
    const f = fixture(), original = f.bundle(), checked = validatePluginBundle(original);
    expect(checked.manifest.id).toBe('demo-tracker');
    expect(checked.contracts.get('demo-tracker.items.list')!.input({}).valid).toBe(true);
    expect(checked.contracts.get('demo-tracker.items.list')!.output({items: [{id: '1', title: 'A'}]}).valid).toBe(true);
    expect(checked.contracts.get('demo-tracker.items.list')!.output({items: [{id: 1}]}).valid).toBe(false);
    expect(validatePluginBundle(new Map([...original].reverse())).hash).toBe(checked.hash);
    f.files.set('runtime/main.mjs', Buffer.from('// changed'));
    expect(validatePluginBundle(f.bundle()).hash).not.toBe(checked.hash);
  });
  it.each(['mail', 'browser', 'sample-kv'])('rejects reserved built-in ID %s', id => {
    const f = fixture(); f.manifest.id = id;
    expect(() => validatePluginBundle(f.bundle())).toThrow('内置');
  });
  it('rejects API incompatibility, legacy draft and incomplete structures', () => {
    const f = fixture(); f.manifest.hostApi = 2;
    expect(() => validatePluginBundle(f.bundle())).toThrow('插件接口');
    f.manifest.hostApi = 1; f.manifest.schema = 'willyou-plugin/v0-draft';
    expect(() => validatePluginBundle(f.bundle())).toThrow('声明');
    expect(() => validatePluginBundle(new Map())).toThrow('结构不完整');
  });
  it.each(['runtime/helper.node', 'runtime/HELPER.NODE', '../escape', '/absolute', 'runtime/../escape', 'runtime\\evil', 'Runtime/main.mjs'])('rejects native or ambiguous path %s', path => {
    const f = fixture(); f.files.set(path, Buffer.from('bad'));
    expect(() => validatePluginBundle(f.bundle())).toThrow();
  });
  it('rejects executable binaries even when renamed and refuses missing runtime/schema', () => {
    const f = fixture(); f.files.set('runtime/helper', Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    expect(() => validatePluginBundle(f.bundle())).toThrow('原生');
    f.files.delete('runtime/helper'); f.files.delete('schemas/input.json');
    expect(() => validatePluginBundle(f.bundle())).toThrow('schemas/input.json');
  });
  it('rejects forged capability prefixes, slots and unsafe write retry', () => {
    const f = fixture(), cap = f.manifest.capabilities['demo-tracker.items.list'];
    cap.permission = 'other.read'; expect(() => validatePluginBundle(f.bundle())).toThrow('权限');
    cap.permission = 'demo-tracker.read'; cap.slots = ['missing']; expect(() => validatePluginBundle(f.bundle())).toThrow('连接');
    cap.slots = []; cap.semantics = 'write'; expect(() => validatePluginBundle(f.bundle())).toThrow('重试');
  });
  it('rejects unknown UI fields, script-bearing declarations and missing capabilities', () => {
    const f = fixture(), panel = f.manifest.ui.panels[0];
    panel.columns[0].field = 'missing'; expect(() => validatePluginBundle(f.bundle())).toThrow('missing');
    panel.columns[0].field = 'id'; Object.assign(panel, {html: '<script>bad()</script>'});
    expect(() => validatePluginBundle(f.bundle())).toThrow('声明');
    delete (panel as unknown as Record<string, unknown>).html;
    panel.source.capability = 'demo-tracker.unknown'; expect(() => validatePluginBundle(f.bundle())).toThrow('能力');
  });
  it('rejects invalid JSON Schema and unresolved remote references without network activity', () => {
    const f = fixture(); f.files.set('schemas/input.json', Buffer.from('{"type":"invalid"}'));
    expect(() => validatePluginBundle(f.bundle())).toThrow('Schema');
    f.files.set('schemas/input.json', Buffer.from('{"$ref":"https://not-contacted.invalid/schema"}'));
    expect(() => validatePluginBundle(f.bundle())).toThrow('Schema');
  });
  it('rejects a write capability used as a declarative page data source',()=>{
    const f=fixture();Object.assign(f.manifest.capabilities['demo-tracker.items.list'],{semantics:'write',retry:'never'});
    expect(()=>validatePluginBundle(f.bundle())).toThrow('页面数据源必须为读取能力');
  });
  it('rejects missing, ambiguous and non-string declaration action targets during install inspection',()=>{
    const f=fixture();
    for(const action of[{kind:'insertTerminal',title:'Insert'},{kind:'insertTerminal',title:'Insert',payload:{}},{kind:'insertTerminal',title:'Insert',payload:{id:'{row.id}'},field:'id'},{kind:'openUrl',title:'Open'},{kind:'openUrl',title:'Open',field:'id',payload:{url:'https://example.invalid'}},{kind:'openUrl',title:'Open',payload:{url:42}},{kind:'openUrl',title:'Open',payload:{url:'https://example.invalid',extra:true}}]){
      Object.assign(f.manifest.ui.panels[0],{rowActions:[action]});expect(()=>validatePluginBundle(f.bundle())).toThrow('界面');
    }
  });
  it('compiles shared refs and checks all declared ZenTao UI field paths', () => {
    const root = 'docs/里程碑/M13_应用Skill与MCP插件化重构/技研/实验/A5_插件声明_20261110/zentao-plugin';
    // The research fixture intentionally has no runtime; supply a synthetic one without changing historical evidence.
    const files = new Map<string, Buffer>();
    const manifest = JSON.parse(readFileSync(join(root, '.willyou-plugin/plugin.json'), 'utf8'));
    files.set('.willyou-plugin/plugin.json', Buffer.from(JSON.stringify(manifest)));
    for (const path of [...manifest.schemas, ...Object.values(manifest.capabilities).flatMap((cap: any) => [cap.input, cap.output])]) files.set(path, readFileSync(join(root, path)));
    files.set('runtime/main.mjs', Buffer.from('// synthetic'));
    for (const path of Object.values(manifest.icon) as string[]) files.set(path, Buffer.from('<svg/>'));
    files.set('skills/zentao/SKILL.md', Buffer.from('---\nname: zentao\ndescription: synthetic\n---\nRead only.'));
    const checked = validatePluginBundle(files);
    expect(checked.manifest.legacyToolNames.smartdd_zentao_work_list_v1).toBe('zentao.object.list');
    manifest.ui.panels[0].details.object.actions[0].payload.reference = '{value.notDeclared}';
    files.set('.willyou-plugin/plugin.json', Buffer.from(JSON.stringify(manifest)));
    expect(() => validatePluginBundle(files)).toThrow('notDeclared');
  });
  it('never follows a source symlink or accepts a symlinked source root', () => {
    const root = mkdtempSync(join(tmpdir(), 'willyou-m13-package-')); roots.push(root);
    const source = join(root, 'source'); mkdirSync(source);
    const f = fixture();
    for (const [path, bytes] of f.bundle()) { const p = join(source, path); mkdirSync(join(p, '..'), {recursive: true}); writeFileSync(p, bytes); }
    expect(inspectPluginDirectory(source).manifest.id).toBe('demo-tracker');
    symlinkSync(join(source, 'schemas/input.json'), join(source, 'link.json'));
    expect(() => inspectPluginDirectory(source)).toThrow('链接');
    symlinkSync(source, join(root, 'alias'));
    expect(() => inspectPluginDirectory(join(root, 'alias'))).toThrow('链接');
  });
});
