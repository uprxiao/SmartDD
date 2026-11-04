import { describe, expect, it } from 'vitest';
import type { ApplicationCapability } from '@shared/application-capabilities';
import { libraryEntrypoints, libraryFrontMatter } from '../application-skill-template';

const capability = (id: string, semantics: 'read' | 'write', binding: ApplicationCapability['binding']) => ({ id, semantics, binding }) as unknown as ApplicationCapability;

describe('one rendered copy of an application skill serves every session', () => {
  it('lists each capability with its primary entry and, for reads only, the declared fallback', () => {
    expect(libraryEntrypoints([
      capability('zentao.object.list', 'read', { cli: { command: ['zentao', 'object', 'list'] }, fallback: { mcp: { tool: 'smartdd_zentao_work_list_v2' } } } as ApplicationCapability['binding']),
      capability('mail.draft.create', 'write', { mcp: { tool: 'smartdd_mail_draft_create_v2' } } as ApplicationCapability['binding']),
    ])).toEqual([
      { capabilityId: 'zentao.object.list', entry: 'cli', invocation: 'willyou-app zentao object list；本会话没有该命令时改用 MCP 工具 smartdd_zentao_work_list_v2' },
      { capabilityId: 'mail.draft.create', entry: 'mcp', invocation: 'MCP 工具 smartdd_mail_draft_create_v2' },
    ]);
  });
  it('renames the skill and marks it as usable only inside WillYou tasks, once', () => {
    const once = libraryFrontMatter(Buffer.from('---\nname: bug-analysis\ndescription: 读取本人 Bug。\n---\n\n# SOP\n'), 'willyou-zentao-bug-analysis').toString();
    expect(once).toContain('name: willyou-zentao-bug-analysis');
    expect(once).toContain('description: 读取本人 Bug。（仅在 WillYou 任务中使用）');
    expect(libraryFrontMatter(Buffer.from(once), 'willyou-zentao-bug-analysis').toString()).toBe(once);
    expect(once.endsWith('# SOP\n')).toBe(true);
  });
});
