import { describe, expect, it } from 'vitest';
import { githubRepository, parseGitBlame, parseGitStatus } from './git-metadata';
import { gitFileLink } from '@shared/file-git';
const base64 = (value: string) => Buffer.from(value).toString('base64');
describe('Git metadata parser and safe location links', () => {
  it('limits web locations to credential-free GitHub repository mappings', () => {
    expect(githubRepository('git@github.com:fixture/example.git')).toBe('https://github.com/fixture/example');
    expect(githubRepository('https://github.com/fixture/example.git')).toBe('https://github.com/fixture/example');
    for (const remote of ['https://user:secret@github.com/fixture/example', 'https://github.com/fixture/example?token=secret', 'https://github.com.evil.invalid/fixture/example', 'file:///tmp/repo', 'ext::sh bad', 'https://github.com/fixture/%2e%2e', 'https://github.com/fixture/example/extra']) expect(githubRepository(remote)).toBeNull();
    expect(gitFileLink({ id: 'repo', head: 'a'.repeat(40), prefix: 'nested/', webBase: 'https://github.com/fixture/example' }, '空 格#?.ts', false, 3)).toBe(`https://github.com/fixture/example/blob/${'a'.repeat(40)}/nested/%E7%A9%BA%20%E6%A0%BC%23%3F.ts#L3`);
  });
  it('preserves NUL-delimited rename paths, Unicode and unknown generated attributes', () => {
    const result = parseGitStatus({ prefix: 'nested/', statusBase64: base64('R  nested/new\n中文.txt\0nested/old name.txt\0?? nested/unknown.txt\0!! nested/ignored/\0'), attributesBase64: base64('nested/new\n中文.txt\0linguist-generated\0true\0nested/unknown.txt\0linguist-generated\0unspecified\0'), attributesAvailable: true });
    expect(result).toEqual([
      { relativePath: 'new\n中文.txt', previousPath: 'old name.txt', status: 'renamed', generated: true, directory: false },
      { relativePath: 'unknown.txt', status: 'untracked', generated: null, directory: false },
      { relativePath: 'ignored', status: 'ignored', generated: null, directory: true },
    ]);
    expect(() => parseGitStatus({ prefix: 'nested/', statusBase64: base64(' M outside.txt\0') })).toThrow('当前来源');
  });
  it('does not invent missing author metadata and rejects stale or uncommitted line mappings', () => {
    const header = `${'a'.repeat(40)} 1 8 1\nsummary example\n\tline\n`;
    expect(parseGitBlame(base64(header), 8, 8)).toEqual([{ line: 8, commitId: 'a'.repeat(40), author: '', at: null, summary: 'example' }]);
    expect(() => parseGitBlame(base64(header), 9, 9)).toThrow('行号不匹配');
    expect(() => parseGitBlame(base64(header.replace('a'.repeat(40), '0'.repeat(40))), 8, 8)).toThrow('行号不匹配');
  });
});
