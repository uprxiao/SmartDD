import { posix } from 'node:path';
import { FileError } from '@shared/files';
import type { OfficeKind } from '@shared/file-office';
import { OfficePackage } from './package';
import { OfficeXml, attribute, children } from './xml';

export const OPC_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const OPC_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const STRICT_REL = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
export interface OfficeRelationship { id: string; type: string; target: string; external: boolean; part?: string }
const invalid = (message: string): never => { throw new FileError('INVALID_INPUT', message); };
const key = (name: string) => decodeURIComponent(name).toLocaleLowerCase('en-US');
export const relationshipPart = (source: string) => source ? posix.join(posix.dirname(source), '_rels', `${posix.basename(source)}.rels`) : '_rels/.rels';
export const relationshipKind = (type: string, name: string) => type === `${OFFICE_REL}/${name}` || type === `${STRICT_REL}/${name}`;

/** Relationship graph never fetches external targets, extracts archives, or
 * resolves a target against the real filesystem. */
export class OfficeRelationships {
  readonly bySource = new Map<string, readonly OfficeRelationship[]>();
  readonly contentTypes = new Map<string, string>();
  readonly mainPart: string;
  readonly kind: OfficeKind;
  readonly signed: boolean;
  private readonly aliases: Map<string, string>;
  constructor(readonly packageData: OfficePackage) {
    const names = packageData.names(); this.aliases = new Map(names.map((name) => [key(name), name]));
    const types = new OfficeXml(packageData.read('[Content_Types].xml')).root;
    if (types.local !== 'Types' || types.uri !== OPC_TYPES) invalid('Office 内容类型根节点无效');
    const defaults = new Map<string, string>(), overrides = new Map<string, string>();
    for (const node of types.children) {
      const type = attribute(node, 'ContentType'); if (!type || node.uri !== OPC_TYPES) invalid('Office 内容类型声明无效');
      if (node.local === 'Default') {
        const ext = attribute(node, 'Extension')?.toLowerCase();
        if (!ext || /[\/\\.]/.test(ext) || defaults.has(ext)) invalid('Office 默认内容类型重复或无效');
        defaults.set(ext!, type!);
      } else if (node.local === 'Override') {
        const raw = attribute(node, 'PartName');
        if (!raw?.startsWith('/')) invalid('Office 部件内容类型路径无效');
        const part = this.resolve('', raw!);
        if (overrides.has(part)) invalid('Office 部件内容类型重复');
        overrides.set(part, type!);
      } else invalid('Office 内容类型声明无法识别');
    }
    for (const name of names) {
      if (name === '[Content_Types].xml') continue;
      // The package root relationship file is literally `.rels`; path.extname
      // treats it as a dotfile without an extension, unlike OPC content types.
      const type = overrides.get(name) ?? defaults.get(posix.basename(name).split('.').at(-1)!.toLowerCase());
      if (!type) invalid(`Office 部件缺少内容类型：${name}`);
      this.contentTypes.set(name, type!);
    }
    for (const name of names.filter((value) => value.endsWith('.rels'))) {
      let source: string;
      if (name === '_rels/.rels') source = '';
      else {
        const folder = posix.dirname(name);
        if (posix.basename(folder) !== '_rels') invalid('Office 关系部件路径无效');
        source = this.aliases.get(key(posix.join(posix.dirname(folder), posix.basename(name).slice(0, -5)))) ?? invalid('Office 关系部件没有所属文档');
      }
      const doc = new OfficeXml(packageData.read(name)), ids = new Set<string>(), rows: OfficeRelationship[] = [];
      if (doc.root.local !== 'Relationships' || doc.root.uri !== OPC_REL) invalid('Office 关系根节点无效');
      if (children(doc.root, 'Relationship').length !== doc.root.children.length) invalid('Office 关系中含未知节点');
      for (const node of doc.root.children) {
        const id = attribute(node, 'Id'), type = attribute(node, 'Type'), target = attribute(node, 'Target'), mode = attribute(node, 'TargetMode');
        if (!id || ids.has(id) || !type || !target || (mode && mode !== 'Internal' && mode !== 'External')) invalid('Office 关系编号或目标无效');
        ids.add(id!);
        rows.push({ id: id!, type: type!, target: target!, external: mode === 'External', ...(mode !== 'External' ? { part: this.resolve(source, target!) } : {}) });
      }
      this.bySource.set(source, rows);
    }
    const main = this.forPart('').filter((relation) => relationshipKind(relation.type, 'officeDocument'));
    if (main.length !== 1 || main[0].external || !main[0].part) invalid('Office 主文档关系无效');
    this.mainPart = main[0].part!;
    const kind = new Map<string, OfficeKind>([
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'xlsx'],
      ['application/vnd.ms-excel.sheet.macroEnabled.main+xml', 'xlsm'],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', 'docx'],
      ['application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', 'pptx'],
    ]).get(this.contentTypes.get(this.mainPart)!);
    if (!kind) throw new FileError('UNSUPPORTED', '此 Office 主文档类型尚未接入');
    this.kind = kind!;
    this.signed = names.some((name) => key(name).startsWith('_xmlsignatures/')) || [...this.bySource.values()].some((rows) => rows.some((row) => row.type.includes('/digital-signature/')));
  }
  resolve(source: string, target: string): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || /[\\\u0000-\u001f\u007f?]/.test(target)) invalid('Office 内部关系不能指向外部地址');
    const path = target.split('#', 1)[0];
    let decoded: string;
    try { decoded = decodeURIComponent(path); } catch { return invalid('Office 关系目标含无效转义'); }
    if (/%2f|%5c/i.test(path) || /[\\\u0000-\u001f\u007f:#?]/.test(decoded)) invalid('Office 关系路径无效');
    const segments = decoded.startsWith('/') ? [] : posix.dirname(decodeURIComponent(source)).split('/').filter((part) => part !== '.');
    if (!decoded && source) return source;
    for (const part of decoded.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') { if (!segments.length) invalid('Office 关系越出文件包'); segments.pop(); }
      else segments.push(part);
    }
    return this.aliases.get(segments.join('/').toLocaleLowerCase('en-US')) ?? invalid(`Office 关系目标缺失：${target}`);
  }
  forPart(source: string): readonly OfficeRelationship[] { return this.bySource.get(source) ?? []; }
  target(source: string, id: string): string {
    const value = this.forPart(source).find((relation) => relation.id === id);
    if (!value?.part || value.external) invalid('Office 对象关系不存在或为外部资源');
    return value!.part!;
  }
  reachable(seeds: readonly string[]): Set<string> {
    const result = new Set<string>(), queue = [...seeds];
    while (queue.length) {
      const name = queue.pop()!; if (result.has(name)) continue; result.add(name);
      const relations = relationshipPart(name); if (this.packageData.has(relations)) result.add(relations);
      for (const row of this.forPart(name)) if (!row.external && row.part && !result.has(row.part)) queue.push(row.part);
    }
    return result;
  }
}
