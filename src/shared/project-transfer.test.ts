import { describe, expect, it } from 'vitest';
import { initialTransferDraft, passphraseIssue, selectTransferProfiles, transferDraftSchema, transferValue, type TransferPreview } from './project-transfer';

const preview: TransferPreview = {
  token: 'preview', project: { name: 'AIS', aliases: [], description: '', rulesPath: null }, suggestedName: 'AIS（导入）',
  directories: [{ ref: 'main', label: '主目录', sourcePath: '/sender/code', isDefault: true }],
  resources: [], capabilities: [], counts: { directories: 1, databases: 0, servers: 0, profiles: 2 },
  profiles: [
    { ref: 'a', name: 'Claude', runner: 'claude', executable: '/sender/claude', env: [] },
    { ref: 'b', name: 'Codex', runner: 'codex', executable: null, env: [] },
  ],
};
describe('M8 frontend draft and validation', () => {
  it('E02 accepts exactly eight characters including spaces and checks confirmation verbatim', () => {
    expect(passphraseIssue('1234567')).toContain('8');
    expect(passphraseIssue('12345678', '12345678')).toBeNull();
    expect(passphraseIssue('        ', '        ')).toBeNull();
    expect(passphraseIssue('12345678', '12345678 ')).toContain('不一致');
    expect(passphraseIssue('😀'.repeat(8))).toBeNull();
    expect(passphraseIssue('😀'.repeat(257))).toContain('1024');
  });
  it('D02/D08 starts with a required empty local choice even if the sender path exists', () => {
    const draft = initialTransferDraft(preview);
    expect(draft.directories).toEqual([{ ref: 'main', mode: 'local', localPath: '' }]);
    expect(draft.selectedProfileRefs).toEqual([]);
    draft.directories[0].localPath = '/receiver/code';
    draft.directories[0].mode = 'source';
    draft.directories[0].mode = 'local';
    expect(draft.directories[0].localPath).toBe('/receiver/code');
    expect(initialTransferDraft(preview).directories[0].localPath).toBe('');
  });
  it('D09 selects 0 → 2 → 1 → 0 and removes every unselected command', () => {
    let draft = initialTransferDraft(preview);
    draft = selectTransferProfiles(draft, preview, ['a', 'b']);
    expect(draft.selectedProfileRefs).toHaveLength(2);
    draft.executables[0].executable = null;
    draft = selectTransferProfiles(draft, preview, ['a']);
    expect(draft.executables).toEqual([{ ref: 'a', executable: null }]);
    draft = selectTransferProfiles(draft, preview, []);
    expect(draft.selectedProfileRefs).toEqual([]); expect(draft.executables).toEqual([]);
    draft = selectTransferProfiles(draft, preview, ['a']);
    expect(draft.executables[0].executable).toBe('/sender/claude');
  });
  it('D01/F07 rejects invalid names and extra client fields before committing', () => {
    const draft = initialTransferDraft(preview);
    expect(transferDraftSchema.safeParse({ ...draft, name: 'x'.repeat(101) }).success).toBe(false);
    expect(transferDraftSchema.safeParse({ ...draft, name: '  ' }).success).toBe(false);
    expect(transferDraftSchema.safeParse({ ...draft, credentials: {} }).success).toBe(false);
  });
  it('I02 distinguishes an error from a native picker cancellation', () => {
    expect(transferValue({ ok: true, value: null })).toBeNull();
    expect(() => transferValue({ ok: false, code: 'UNLOCK_FAILED', message: '口令不正确，或文件已经损坏' })).toThrow('口令不正确');
  });
});
