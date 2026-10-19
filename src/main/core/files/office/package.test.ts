import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { describe, expect, it } from 'vitest';
import { OFFICE_LIMITS } from '@shared/file-office';
import { OfficePackage, officePartName } from './package';
import { OfficeRelationships, OPC_REL, OPC_TYPES, OFFICE_REL } from './relationships';
import { OfficeXml } from './xml';

const types = `<Types xmlns="${OPC_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
const rootRels = `<Relationships xmlns="${OPC_REL}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const base = { '[Content_Types].xml': types, '_rels/.rels': rootRels, 'xl/workbook.xml': '<workbook xmlns="urn:test"><sheet name="原文"/></workbook>', 'custom/unknown.bin': 'UNEDITED_PRIVATE_EXTENSION_123456' };
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
async function zipBytes(parts: Record<string, string | Uint8Array>, compress = true): Promise<Buffer> {
  const zip = new ZipFile(); for (const [name, value] of Object.entries(parts)) zip.addBuffer(Buffer.from(value), name, { compress }); zip.end();
  const chunks = []; for await (const chunk of zip.outputStream as Readable) chunks.push(chunk); return Buffer.concat(chunks);
}

describe('Office original package fidelity and boundaries', () => {
  it('changes only the declared XML, preserving every unrelated part and the input buffer', async () => {
    const input = await zipBytes(base), inputHash = sha(input), original = await OfficePackage.read(input);
    const changed = Buffer.from('<workbook xmlns="urn:test"><sheet name="修改后"/></workbook>');
    const candidate = original.patch(new Map([['xl/workbook.xml', changed]]), { changed: ['xl/workbook.xml'], added: [], removed: [] });
    const reopened = await OfficePackage.read(await candidate.bytes());
    for (const name of original.names().filter((name) => name !== 'xl/workbook.xml')) expect(reopened.read(name)).toEqual(original.read(name));
    expect(reopened.read('xl/workbook.xml')).toEqual(changed); expect(sha(input)).toBe(inputHash);
    expect(original.read('xl/workbook.xml').toString()).toContain('原文');
    const leaked = original.read('custom/unknown.bin'); leaked.fill(0); expect(original.read('custom/unknown.bin').toString()).toContain('UNEDITED');
    changed.fill(0); expect(candidate.read('xl/workbook.xml').toString()).toContain('修改后');
  });
  it('rejects undeclared losses/additions, false plans and duplicate part identities', async () => {
    const file = await OfficePackage.read(await zipBytes(base));
    expect(() => file.patch(new Map([['custom/unknown.bin', null]]), { changed: [], added: [], removed: [] })).toThrow('未声明');
    expect(() => file.patch(new Map(), { changed: ['xl/workbook.xml'], added: [], removed: [] })).toThrow('缺少');
    expect(() => file.patch(new Map([['XL/workbook.xml', Buffer.from('x')]]), { changed: [], added: ['XL/workbook.xml'], removed: [] })).toThrow('重名');
    expect(() => file.patch(new Map([['_rels/.rels', null]]), { changed: [], added: [], removed: ['_rels/.rels'] })).toThrow('不能删除');
  });
  it('checks actual CRC as well as advertised sizes', async () => {
    const input = await zipBytes(base, false), at = input.indexOf('UNEDITED_PRIVATE_EXTENSION_123456');
    expect(at).toBeGreaterThan(0); input[at] = 88;
    await expect(OfficePackage.read(input)).rejects.toThrow('CRC');
  });
  it('enforces input, expanded, individual-part, entry-count and output budgets independently', async () => {
    const input = await zipBytes({ ...base, 'large.xml': '<large>' + 'x'.repeat(16384) + '</large>' });
    await expect(OfficePackage.read(input, undefined, { ...OFFICE_LIMITS, inputBytes: input.length - 1 })).rejects.toThrow('读取上限');
    await expect(OfficePackage.read(input, undefined, { ...OFFICE_LIMITS, expandedBytes: 10000 })).rejects.toThrow('解压');
    await expect(OfficePackage.read(input, undefined, { ...OFFICE_LIMITS, partBytes: 10000 })).rejects.toThrow('解压');
    await expect(OfficePackage.read(input, undefined, { ...OFFICE_LIMITS, parts: 4 })).rejects.toThrow('部件');
    const limited = await OfficePackage.read(input, undefined, { ...OFFICE_LIMITS, outputBytes: 100 });
    await expect(limited.bytes()).rejects.toThrow('保存候选');
  });
  it('rejects truncated containers, duplicate names, disguised directory traversal and cancellation', async () => {
    const good = await zipBytes(base);
    await expect(OfficePackage.read(good.subarray(0, good.length - 18))).rejects.toThrow();
    await expect(OfficePackage.read(await zipBytes({ ...base, 'XL/WORKBOOK.XML': 'duplicate' }))).rejects.toThrow('重名');
    for (const value of ['../x', '/x', 'a\\b', 'a/%2e%2e/b', 'a/%2fb', 'a//b', 'a:stream', 'a\u0000b']) expect(() => officePartName(value)).toThrow();
    const abort = new AbortController(); abort.abort(); await expect(OfficePackage.read(good, abort.signal)).rejects.toThrow('取消');
    const file = await OfficePackage.read(good); await expect(file.bytes(abort.signal)).rejects.toThrow('取消');
  });
  it.each([
    ['final/rich-source.xlsx', 'xlsx'],
    ['final/rich-delete-final.xlsx', 'xlsx'],
    ['final/rich-edited.pptx', 'pptx'],
    ['checkbox/checkbox-precise-unchecked.xlsx', 'xlsx'],
  ])('reads and round-trips reviewed real OOXML fixture %s without part loss', async (name, kind) => {
    const bytes = await readFile(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office', name));
    const original = await OfficePackage.read(bytes), graph = new OfficeRelationships(original);
    expect(graph.kind).toBe(kind); expect(graph.reachable(['']).has(graph.mainPart)).toBe(true);
    const next = await OfficePackage.read(await original.bytes());
    expect(next.hashes()).toEqual(original.hashes());
    expect(new OfficeRelationships(next).mainPart).toBe(graph.mainPart);
    for (const part of next.names().filter((value) => value.endsWith('.xml'))) expect(() => new OfficeXml(next.read(part))).not.toThrow();
  });
});

describe('Office package relationships', () => {
  it('resolves internal relationships and keeps external URLs inert metadata', async () => {
    const parts = { ...base, 'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${OPC_REL}"><Relationship Id="out" Type="${OFFICE_REL}/hyperlink" Target="https://example.invalid/private" TargetMode="External"/><Relationship Id="in" Type="urn:test" Target="../custom/unknown.bin"/></Relationships>` };
    const graph = new OfficeRelationships(await OfficePackage.read(await zipBytes(parts)));
    expect(graph.target('xl/workbook.xml', 'in')).toBe('custom/unknown.bin');
    expect(graph.forPart('xl/workbook.xml')[0]).toEqual({ id: 'out', type: `${OFFICE_REL}/hyperlink`, target: 'https://example.invalid/private', external: true });
    expect(() => graph.target('xl/workbook.xml', 'out')).toThrow('外部');
    for (const target of ['../../outside', 'file:///private/tmp/test', 'https://example.invalid/', '../missing.bin']) expect(() => graph.resolve('xl/workbook.xml', target)).toThrow();
  });
  it('refuses missing internal relationships and duplicated IDs instead of silently dropping objects', async () => {
    for (const relation of [
      `<Relationship Id="r1" Type="urn:test" Target="missing.xml"/>`,
      `<Relationship Id="r1" Type="urn:test" Target="../custom/unknown.bin"/><Relationship Id="r1" Type="urn:test" Target="../custom/unknown.bin"/>`,
    ]) {
      const parts = { ...base, 'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${OPC_REL}">${relation}</Relationships>` };
      const file = await OfficePackage.read(await zipBytes(parts)); expect(() => new OfficeRelationships(file)).toThrow();
    }
  });
});
