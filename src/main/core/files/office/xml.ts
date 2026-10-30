import { SaxesParser, type SaxesAttributeNS } from 'saxes';
import { FileError } from '@shared/files';
import { OFFICE_LIMITS } from '@shared/file-office';

export interface OfficeXmlNode {
  name: string; local: string; uri: string; attributes: Record<string, SaxesAttributeNS>;
  start: number; openEnd: number; closeStart: number; end: number; selfClosing: boolean;
  children: OfficeXmlNode[]; text: string;
}
export interface XmlEdit { start: number; end: number; value: string }
export const xmlEscape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

/** SAX validates names/namespaces/entities. Source offsets allow local patches
 * without serialising unrelated prefixes, whitespace, comments or extensions. */
export class OfficeXml {
  readonly root: OfficeXmlNode;
  readonly source: string;
  private readonly encoding: 'utf8' | 'utf16le' | 'utf16be';
  private readonly bom: Buffer;
  constructor(bytes: Uint8Array, limits: { nodes: number; depth: number } = { nodes: OFFICE_LIMITS.xmlNodes, depth: OFFICE_LIMITS.xmlDepth }) {
    if (bytes.byteLength > OFFICE_LIMITS.partBytes) throw new FileError('TOO_LARGE', 'Office XML 部件超过预算');
    const raw = Buffer.from(bytes);
    const big = raw[0] === 0xfe && raw[1] === 0xff, little = raw[0] === 0xff && raw[1] === 0xfe;
    this.encoding = big ? 'utf16be' : little ? 'utf16le' : 'utf8';
    const bomLength = big || little ? 2 : raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
    this.bom = raw.subarray(0, bomLength);
    try { this.source = new TextDecoder(big ? 'utf-16be' : little ? 'utf-16le' : 'utf-8', { fatal: true, ignoreBOM: true }).decode(raw.subarray(bomLength)); }
    catch { throw new FileError('INVALID_INPUT', 'Office XML 编码无效'); }
    const stack: OfficeXmlNode[] = []; let root: OfficeXmlNode | undefined, count = 0;
    const parser = new SaxesParser({ xmlns: true });
    parser.on('doctype', () => { throw new FileError('UNSUPPORTED', 'Office XML 不允许 DTD 或外部实体'); });
    parser.on('error', () => { throw new FileError('INVALID_INPUT', 'Office XML 结构无效'); });
    parser.on('opentag', (tag) => {
      if (++count > limits.nodes || stack.length >= limits.depth) throw new FileError('TOO_LARGE', 'Office XML 节点或嵌套超过预算');
      const end = parser.position, start = this.source.lastIndexOf('<', end - 1);
      const node: OfficeXmlNode = { name: tag.name, local: tag.local, uri: tag.uri, attributes: tag.attributes, start, openEnd: end, closeStart: end, end, selfClosing: tag.isSelfClosing, children: [], text: '' };
      if (stack.length) stack.at(-1)!.children.push(node); else root = node;
      stack.push(node);
    });
    const text = (value: string) => { if (stack.length) stack.at(-1)!.text += value; };
    parser.on('text', text); parser.on('cdata', text);
    parser.on('closetag', () => {
      const node = stack.pop()!; node.end = parser.position;
      if (!node.selfClosing) node.closeStart = this.source.lastIndexOf('</', node.end - 1);
    });
    parser.write(this.source).close();
    if (!root) throw new FileError('INVALID_INPUT', 'Office XML 没有根节点');
    this.root = root;
  }
  slice(node: OfficeXmlNode): string { return this.source.slice(node.start, node.end); }
  edit(edits: readonly XmlEdit[]): Buffer {
    const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end); let end = 0, output = '';
    for (const edit of sorted) {
      if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) || edit.start < end || edit.end < edit.start || edit.end > this.source.length) throw new FileError('INVALID_INPUT', 'Office XML 补丁范围重叠或越界');
      output += this.source.slice(end, edit.start) + edit.value; end = edit.end;
    }
    output += this.source.slice(end);
    const bytes = Buffer.from(output, this.encoding === 'utf8' ? 'utf8' : 'utf16le');
    if (this.encoding === 'utf16be') bytes.swap16();
    if (bytes.length + this.bom.length > OFFICE_LIMITS.partBytes) throw new FileError('TOO_LARGE', 'Office XML 候选超过预算');
    const result = Buffer.concat([this.bom, bytes]); new OfficeXml(result); return result;
  }
  /** Replace only an existing node's contents; caller owns semantic validation. */
  replaceContent(node: OfficeXmlNode, value: string): XmlEdit {
    if (!node.selfClosing) return { start: node.openEnd, end: node.closeStart, value };
    return { start: node.start, end: node.end, value: `${this.source.slice(node.start, node.openEnd).replace(/\/\s*>$/, '>')}${value}</${node.name}>` };
  }
  setAttribute(node: OfficeXmlNode, name: string, value: string | null): XmlEdit {
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) throw new FileError('INVALID_INPUT', 'Office XML 属性名称无效');
    const open = this.source.slice(node.start, node.openEnd);
    const pattern = /(\s+)([^\s=<>/]+)(\s*=\s*)(["'])([\s\S]*?)\4/g;
    for (const match of open.matchAll(pattern)) {
      if (match[2] !== name) continue;
      const start = node.start + match.index!;
      return value === null ? { start, end: start + match[0].length, value: '' } : { start: start + match[1].length + name.length + match[3].length + 1, end: start + match[0].length - 1, value: xmlEscape(value) };
    }
    const at = node.openEnd - (node.selfClosing ? 2 : 1);
    return { start: at, end: at, value: value === null ? '' : ` ${name}="${xmlEscape(value)}"` };
  }
}
export const attribute = (node: OfficeXmlNode, local: string, uri = '') => Object.values(node.attributes).find((attr) => attr.local === local && attr.uri === uri)?.value;
export const children = (node: OfficeXmlNode, local: string, uri = node.uri) => node.children.filter((child) => child.local === local && child.uri === uri);
export function descendants(node: OfficeXmlNode, local: string, uri = node.uri): OfficeXmlNode[] {
  const result: OfficeXmlNode[] = [], stack = [...node.children].reverse();
  while (stack.length) { const next = stack.pop()!; if (next.local === local && next.uri === uri) result.push(next); stack.push(...[...next.children].reverse()); }
  return result;
}

/** A standalone copy retains namespace bindings declared on its ancestors. */
export function copyOfficeNode(doc:OfficeXml,node:OfficeXmlNode):string {
  const namespaces=new Map<string,string>();let current:OfficeXmlNode|undefined=doc.root;
  while(current) {
    for(const value of Object.values(current.attributes))if(value.name === 'xmlns' || value.prefix === 'xmlns')namespaces.set(value.name,value.value);
    if(current === node)break;current=current.children.find(child=>child.start<=node.start && child.end>=node.end);
  }
  const raw=doc.slice(node),at=node.openEnd-node.start-(node.selfClosing ? 2 : 1);
  const extra=[...namespaces].filter(([name])=>!node.attributes[name]).map(([name,value])=>` ${name}="${xmlEscape(value)}"`).join('');
  return raw.slice(0,at)+extra+raw.slice(at);
}
