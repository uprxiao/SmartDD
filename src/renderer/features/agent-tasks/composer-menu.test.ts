import { describe, expect, it } from 'vitest';
import { applyItem, commandItems, fileItems, findTrigger, skillItems } from './composer-menu';

// M14-A52 输入框 /命令、@文件、$Skill 选用（界面逻辑层）。
describe('触发词', () => {
  it('/ 只在输入开头；@ 与 $ 在行首或空白之后', () => {
    expect(findTrigger('/go', 3)).toEqual({ kind: '/', query: 'go', start: 0, end: 3 });
    expect(findTrigger('看下 /go', 6)).toBeNull();
    expect(findTrigger('看下 @src/ma', 10)).toEqual({ kind: '@', query: 'src/ma', start: 3, end: 10 });
    expect(findTrigger('a@b', 3)).toBeNull();
    expect(findTrigger('用 $pdf', 6)).toEqual({ kind: '$', query: 'pdf', start: 2, end: 6 });
    expect(findTrigger('done ', 5)).toBeNull();
  });
  it('选用只替换触发词，插入引用到草稿', () => {
    const t = findTrigger('看下 @ma 再说', 6)!;
    expect(applyItem('看下 @ma 再说', t, fileItems(['src/main.ts'])[0])).toEqual({ text: '看下 @src/main.ts  再说', caret: 16 });
  });
});
describe('菜单项', () => {
  it('命令只列宿主命令与执行器公布项', () => {
    const items = commandItems({ commands: ['goal', 'compact', 'review'], skills: [] }, '');
    expect(items.map(i => i.label)).toEqual(['/terminal', '/model', '/goal', '/compact', '/review']);
    expect(commandItems({ commands: ['/goal', '/init'], skills: [] }, 'in').map(i => i.label)).toEqual(['/init']);
  });
  it('Skill 按名称过滤', () => {
    expect(skillItems({ commands: [], skills: [{ name: 'pdf', description: 'PDF' }, { name: 'docx' }] }, 'pd')).toEqual([{ key: 's:pdf', label: '$pdf', detail: 'PDF', insert: '$pdf ' }]);
  });
  it('优先显示准确和前缀匹配，同名的纳管项与执行器项合并', () => {
    const catalog = { commands: [], skills: [
      { name: 'open-source-radar' },
      { name: 'source-driven-ui-test', description: '从源码生成测试' },
      { name: 'source' },
    ] };
    const items = skillItems(catalog, 'SOURCE', [{ name: 'source-driven-ui-test' }]);
    expect(items.map(item => item.label)).toEqual(['$source', '$source-driven-ui-test', '$open-source-radar']);
    expect(items[1]).toMatchObject({ detail: '从源码生成测试', source: 'WillYou 纳管' });
  });
  it('可查找完整纳管目录并独立选用执行器未公布的技能', () => {
    const skills = Array.from({ length: 250 }, (_, index) => ({ name: `skill-${index}` }));
    expect(skillItems({ commands: [], skills: [] }, '', skills)).toHaveLength(250);
    expect(skillItems({ commands: [], skills: [] }, 'skill-249', skills)[0]?.insert).toBe('$skill-249 ');
  });
});
