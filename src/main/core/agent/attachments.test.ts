import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachmentNote, prepareAttachment, verifyAttachments } from './attachments';

// M14-A75 附件粘贴与路径引用（主进程层）。
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function env() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-att-'))); dirs.push(root);
  const cwd = join(root, 'work'), userData = join(root, 'ud'), outside = join(root, 'outside');
  for (const d of [cwd, userData, outside]) mkdirSync(d);
  writeFileSync(join(cwd, 'a.ts'), 'x'); writeFileSync(join(outside, 'secret.txt'), 'outside'); writeFileSync(join(outside, 'shot.png'), Buffer.from([137, 80, 78, 71]));
  return { root, cwd, userData, outside };
}
describe('附件', () => {
  it('项目内文件按路径引用，不复制', () => {
    const e = env();
    const a = prepareAttachment({ cwd: e.cwd, userData: e.userData, name: 'a.ts', sourcePath: join(e.cwd, 'a.ts') });
    expect(a).toMatchObject({ kind: 'path', relativePath: 'a.ts', image: false, size: 1 });
    expect(a.storedPath).toBeUndefined();
  });
  it('项目外文件复制到 WillYou 私有目录并注明是副本；图片识别为图片', () => {
    const e = env();
    const f = prepareAttachment({ cwd: e.cwd, userData: e.userData, name: 'secret.txt', sourcePath: join(e.outside, 'secret.txt') });
    expect(f.kind).toBe('file');
    expect(f.storedPath!.startsWith(join(e.userData, 'agent-attachments'))).toBe(true);
    expect(readFileSync(f.storedPath!, 'utf8')).toBe('outside');
    const img = prepareAttachment({ cwd: e.cwd, userData: e.userData, name: 'shot.png', sourcePath: join(e.outside, 'shot.png') });
    expect(img).toMatchObject({ kind: 'file', image: true, mime: 'image/png' });
    expect(attachmentNote([f, img])).toBe(`\n\n附件：\n- 附件：secret.txt（项目外文件的副本：${f.storedPath}）\n- 图片：shot.png（已附上）`);
  });
  it('指向项目外的符号链接按项目外处理；剪贴板内容按字节保存', () => {
    const e = env();
    symlinkSync(join(e.outside, 'secret.txt'), join(e.cwd, 'link.txt'));
    expect(prepareAttachment({ cwd: e.cwd, userData: e.userData, name: 'link.txt', sourcePath: join(e.cwd, 'link.txt') }).kind).toBe('file');
    const p = prepareAttachment({ cwd: e.cwd, userData: e.userData, name: '../../evil.png', mime: 'image/png', dataBase64: Buffer.from('png').toString('base64') });
    expect(p).toMatchObject({ kind: 'file', name: 'evil.png', image: true, size: 3 });
    expect(() => prepareAttachment({ cwd: e.cwd, userData: e.userData, name: 'x', dataBase64: '' })).toThrow('附件内容为空');
  });
  it('提交时重新核对：伪造路径、越界或副本丢失一律拒绝', () => {
    const e = env();
    const ok = prepareAttachment({ cwd: e.cwd, userData: e.userData, name: 'a.ts', sourcePath: join(e.cwd, 'a.ts') });
    const copy = prepareAttachment({ cwd: e.cwd, userData: e.userData, name: 'secret.txt', sourcePath: join(e.outside, 'secret.txt') });
    expect(verifyAttachments([ok, copy], e.cwd, e.userData).map(a => a.kind)).toEqual(['path', 'file']);
    expect(() => verifyAttachments([{ ...ok, relativePath: '../outside/secret.txt' }], e.cwd, e.userData)).toThrow('附件已不在项目内');
    expect(() => verifyAttachments([{ ...copy, storedPath: join(e.outside, 'secret.txt') }], e.cwd, e.userData)).toThrow('附件副本已丢失');
    rmSync(copy.storedPath!);
    expect(() => verifyAttachments([copy], e.cwd, e.userData)).toThrow('附件副本已丢失');
    expect(verifyAttachments(undefined, e.cwd, e.userData)).toEqual([]);
  });
});
