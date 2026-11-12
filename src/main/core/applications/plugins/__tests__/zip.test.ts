import {describe, expect, it} from 'vitest';
import {ZipFile} from 'yazl';
import {PLUGIN_LIMITS} from '@shared/plugins';
import {inspectPluginZip} from '../zip';
import {validatePluginBundle} from '../package';
import {fixture} from './fixture';

async function zip(entries: ReadonlyMap<string, Buffer>, options?: {mode?: number; duplicate?: boolean}): Promise<Buffer> {
  const archive = new ZipFile();
  for (const [path, bytes] of entries) archive.addBuffer(bytes, path, {compress: false, mode: options?.mode ?? 0o100600});
  if (options?.duplicate) archive.addBuffer(Buffer.from('duplicate'), 'runtime/main.mjs', {compress: false});
  archive.end(); const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
describe('bounded plugin ZIP inspection without extraction', () => {
  it('matches the complete directory package digest', async () => {
    const files = fixture().bundle();
    expect((await inspectPluginZip(await zip(files))).hash).toBe(validatePluginBundle(files).hash);
  });
  it('rejects symlinks and duplicate files', async () => {
    const files = fixture().bundle();
    await expect(inspectPluginZip(await zip(files, {mode: 0o120777}))).rejects.toThrow('链接');
    await expect(inspectPluginZip(await zip(files, {duplicate: true}))).rejects.toThrow('重名');
  });
  it('rejects paths escaping the archive root before writing anything', async () => {
    const files = fixture().bundle(); files.set('xx/escape', Buffer.from('never extracted'));
    const data = await zip(files);
    // Mutate same-length local and central names; yazl itself correctly refuses to create traversal paths.
    for (let index = 0; (index = data.indexOf('xx/escape', index)) !== -1; index += 9) data.write('../escape', index);
    await expect(inspectPluginZip(data)).rejects.toThrow();
  });
  it('rejects corrupt CRC and advertised expansion bombs', async () => {
    const data = await zip(fixture().bundle());
    const crcBad = Buffer.from(data), position = crcBad.indexOf('Synthetic plugin'); crcBad[position] ^= 1;
    await expect(inspectPluginZip(crcBad)).rejects.toThrow('CRC');
    const bomb = Buffer.from(data), central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(PLUGIN_LIMITS.fileBytes + 1, central + 24);
    await expect(inspectPluginZip(bomb)).rejects.toThrow();
  });
  it('supports cancellation without install side effects', async () => {
    const signal = AbortSignal.abort();
    await expect(inspectPluginZip(await zip(fixture().bundle()), signal)).rejects.toMatchObject({code: 'CANCELED'});
  });
});
