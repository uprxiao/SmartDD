import { describe, expect, it, vi } from 'vitest';
import { gitAuthorLink, gitBlameDetailsSchema, gitPullRequestLink, type GitBlameLine } from '@shared/file-git';
import { addGitBlameDetails, type GitBlameDetailsAdapter } from './git-blame-details';

const repository = { id: 'owned-public-fixture', head: 'a'.repeat(40), webBase: 'https://github.com/willyou-m9-fixture/location-links', prefix: '' };
const line: GitBlameLine = { line: 1, commitId: 'a'.repeat(40), author: 'Display <public@example.invalid>', at: null, summary: 'Mention @someone and PR #42 literally' };
describe('S04 explicitly supplied local optional metadata', () => {
  it('does not infer identities/PRs from display text or modify the five native fields without an adapter', () => {
    const lines = [line]; expect(addGitBlameDetails(lines, repository)).toBe(lines);
    expect(lines).toEqual([line]); expect(gitAuthorLink(undefined)).toBeNull(); expect(gitPullRequestLink(repository.webBase, undefined)).toBeNull();
  });
  it('accepts declared local metadata once per original commit without changing source/native fields', () => {
    const read = vi.fn(() => ({ authorLogin: 'public-fixture', pullRequest: { number: 42, title: '<b>Literal PR title</b>' } }));
    const second = { ...line, line: 2 }, source = [line, second];
    const result = addGitBlameDetails(source, repository, { source: 'trusted-local', read });
    expect(read).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith(repository, line.commitId);
    expect(source).toEqual([line, second]);
    expect(result).toEqual(source.map(value => ({ ...value, authorLogin: 'public-fixture', pullRequest: { number: 42, title: '<b>Literal PR title</b>' } })));
    expect(gitAuthorLink(result[0].authorLogin)).toBe('https://github.com/public-fixture');
    expect(gitPullRequestLink(repository.webBase, result[0].pullRequest)).toBe('https://github.com/willyou-m9-fixture/location-links/pull/42');
  });
  it.each([null, { authorLogin: '../secret' }, { authorLogin: 'public\nuser' }, { authorLogin: 'https://evil.invalid' }, { pullRequest: { number: 0 } }, { pullRequest: { number: 1.5 } }, { pullRequest: { number: Number.MAX_SAFE_INTEGER + 1 } }, { pullRequest: { number: 42, url: 'javascript:alert(1)' } }, { author: 'replacement' }, Promise.resolve({ authorLogin: 'unawaited' })])('keeps original native data when optional metadata is invalid (%j)', raw => {
    const result = addGitBlameDetails([line], repository, { source: 'trusted-local', read: () => raw });
    expect(result).toEqual([line]); expect(gitBlameDetailsSchema.safeParse(raw).success).toBe(false);
  });
  it('does not call undeclared adapters or attach data to an uncommitted line', () => {
    const read = vi.fn(() => ({ authorLogin: 'public-fixture' }));
    expect(addGitBlameDetails([line], repository, { source: 'renderer', read } as unknown as GitBlameDetailsAdapter)).toEqual([line]);
    const uncommitted = { ...line, commitId: '0'.repeat(40) };
    expect(addGitBlameDetails([uncommitted], repository, { source: 'trusted-local', read })).toEqual([uncommitted]); expect(read).not.toHaveBeenCalled();
  });
  it('falls back on optional adapter failure and never follows an arbitrary supplied URL', () => {
    expect(addGitBlameDetails([line], repository, { source: 'trusted-local', read: () => { throw Error('Local optional provider unavailable'); } })).toEqual([line]);
    for (const base of ['https://github.com.evil.invalid/owner/repo', 'https://user:public@github.com/owner/repo', 'file:///tmp/repo']) expect(gitPullRequestLink(base, { number: 42 })).toBeNull();
    expect(gitAuthorLink('javascript:alert(1)')).toBeNull();
  });
});
