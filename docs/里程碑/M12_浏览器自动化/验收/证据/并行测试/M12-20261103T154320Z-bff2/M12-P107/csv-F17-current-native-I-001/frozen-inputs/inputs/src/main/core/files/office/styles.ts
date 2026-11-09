import { format } from 'ssf';
import { FileError } from '@shared/files';
import type { OfficeCell, OfficeCellStyle } from '@shared/file-office';
import type { OfficeMeasureFont } from '@shared/office-measure';
import type { OfficePackage } from './package';
import { OfficeRelationships, relationshipKind } from './relationships';
import { OfficeXml, attribute, children, descendants, type OfficeXmlNode } from './xml';

const indexed = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966','003300','333300','993300','993366','333399','333333'];
const enabled = (node?: OfficeXmlNode) => !!node && !['0', 'false'].includes(attribute(node, 'val') ?? '1');
const first = (node: OfficeXmlNode, name: string) => children(node, name)[0];
const value = (node: OfficeXmlNode, name: string) => { const child = first(node, name); return child ? attribute(child, 'val') : undefined; };
const number = (raw: string | undefined, fallback: number, min = 0, max = 65535) => { if (raw === undefined) return fallback; const result = Number(raw); if (!Number.isFinite(result) || result < min || result > max) throw new FileError('INVALID_INPUT', '工作簿样式数值无效'); return result; };
function tint(rgb: string, amount: number): string {
  if (!amount) return `#${rgb}`;
  const values = [0, 2, 4].map((offset) => parseInt(rgb.slice(offset, offset + 2), 16) / 255), high = Math.max(...values), low = Math.min(...values);
  let light = (high + low) / 2, hue = 0, saturation = 0;
  if (high !== low) { const delta = high - low; saturation = light > .5 ? delta / (2 - high - low) : delta / (high + low); hue = (high === values[0] ? (values[1] - values[2]) / delta + (values[1] < values[2] ? 6 : 0) : high === values[1] ? (values[2] - values[0]) / delta + 2 : (values[0] - values[1]) / delta + 4) / 6; }
  light = amount < 0 ? light * (1 + amount) : light * (1 - amount) + amount;
  const q = light < .5 ? light * (1 + saturation) : light + saturation - light * saturation, p = 2 * light - q;
  const channel = (position: number) => { position = (position + 1) % 1; return !saturation ? light : position < 1 / 6 ? p + (q - p) * 6 * position : position < .5 ? q : position < 2 / 3 ? p + (q - p) * (2 / 3 - position) * 6 : p; };
  return `#${[hue + 1 / 3, hue, hue - 1 / 3].map((part) => Math.round(channel(part) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Styles are a bounded display projection. Original styles/theme/rich runs stay
 * byte-identical in the package; displaying a value never rewrites its storage. */
export class OfficeStyles {
  readonly normalFont:OfficeMeasureFont;
  private readonly styles: OfficeCellStyle[] = [];
  private readonly differentialFills:(string|undefined)[]=[];
  private projectColor:(node?:OfficeXmlNode)=>string|undefined=()=>undefined;
  constructor(file: OfficePackage, graph: OfficeRelationships) {
    const relations = graph.forPart(graph.mainPart), style = relations.filter((entry) => relationshipKind(entry.type, 'styles')), theme = relations.filter((entry) => relationshipKind(entry.type, 'theme'));
    if (style.length > 1 || theme.length > 1 || [...style, ...theme].some((entry) => entry.external)) throw new FileError('INVALID_INPUT', '工作簿样式或主题关系无效');
    let themeColors: (string | undefined)[] = [], majorFont = '', minorFont = '';
    if (theme[0]?.part) {
      const xml = new OfficeXml(file.read(theme[0].part)), scheme = descendants(xml.root, 'clrScheme')[0], fontScheme = descendants(xml.root, 'fontScheme')[0];
      if (scheme) themeColors = ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'].map((name) => { const item = first(scheme, name)?.children[0]; return item ? attribute(item, item.local === 'sysClr' ? 'lastClr' : 'val') : undefined; });
      if (fontScheme) { const major = first(fontScheme, 'majorFont'), minor = first(fontScheme, 'minorFont'); majorFont = major ? attribute(first(major, 'latin') ?? major, 'typeface') ?? '' : ''; minorFont = minor ? attribute(first(minor, 'latin') ?? minor, 'typeface') ?? '' : ''; }
    }
    const color = (node?: OfficeXmlNode): string | undefined => {
      if (!node) return undefined;
      const rgb = attribute(node, 'rgb')?.slice(-6) ?? (attribute(node, 'theme') !== undefined ? themeColors[number(attribute(node, 'theme'), 0, 0, 11)] : undefined) ?? indexed[number(attribute(node, 'indexed'), 64, 0, 65)];
      return rgb && /^[a-f0-9]{6}$/i.test(rgb) ? tint(rgb, number(attribute(node, 'tint'), 0, -1, 1)) : undefined;
    };
    this.projectColor=color;
    this.normalFont={family:minorFont || 'Calibri',points:11,bold:false,italic:false};
    if (!style[0]?.part) { this.styles.push({ numberFormat: 0,font:this.normalFont }); return; }
    const xml = new OfficeXml(file.read(style[0].part));
    if (xml.root.local !== 'styleSheet') throw new FileError('INVALID_INPUT', '工作簿样式根节点无效');
    const root = xml.root, formats = new Map<number, string>();
    const dxfs=children(first(root,'dxfs') ?? root,'dxf');if(dxfs.length>65536)throw new FileError('TOO_LARGE','工作簿差异格式超过 65536 项');
    for(const dxf of dxfs){
      const fill=first(dxf,'fill'),pattern=fill && first(fill,'patternFill');
      const only=(node:OfficeXmlNode,names:string[])=>Object.values(node.attributes).every(a=>a.name==='xmlns' || a.prefix==='xmlns' || !a.uri && names.includes(a.local));
      const supported=dxf.children.length===1 && !!fill && fill.children.length===1 && !!pattern && attribute(pattern,'patternType')==='solid' && pattern.children.every(child=>child.uri===root.uri && ['fgColor','bgColor'].includes(child.local) && only(child,['rgb','indexed','theme','tint','auto'])) && children(pattern,'fgColor').length===1 && children(pattern,'bgColor').length<=1 && only(dxf,[]) && only(fill,[]) && only(pattern,['patternType']);
      this.differentialFills.push(supported ? color(first(pattern!,'fgColor')) : undefined);
    }
    for (const entry of children(first(root, 'numFmts') ?? root, 'numFmt')) {
      const id = number(attribute(entry, 'numFmtId'), -1), code = attribute(entry, 'formatCode');
      if (id < 0 || formats.has(id) || code === undefined || code.length > 4096) throw new FileError('INVALID_INPUT', '工作簿数字格式无效'); formats.set(id, code);
    }
    const fonts = children(first(root, 'fonts') ?? root, 'font').map((node): OfficeCellStyle['font'] => ({ family: (value(node, 'name') ?? (value(node, 'scheme') === 'major' ? majorFont : minorFont)).slice(0, 256) || undefined, points: number(value(node, 'sz'), 11, 1, 409), bold: enabled(first(node, 'b')), italic: enabled(first(node, 'i')), underline: enabled(first(node, 'u')) && value(node, 'u') !== 'none', strike: enabled(first(node, 'strike')), color: color(first(node, 'color')) }));
    const fills = children(first(root, 'fills') ?? root, 'fill').map((node) => { const pattern = first(node, 'patternFill'); return pattern && attribute(pattern, 'patternType') === 'solid' ? color(first(pattern, 'fgColor')) : undefined; });
    const borders = children(first(root, 'borders') ?? root, 'border').map((node) => {
      const output: NonNullable<OfficeCellStyle['borders']> = {};
      for (const edge of ['left','right','top','bottom'] as const) { const item = first(node, edge); if (item && attribute(item, 'style')) output[edge] = { style: attribute(item, 'style')!, color: color(first(item, 'color')) ?? '#000000' }; }
      return output;
    });
    const base = children(first(root, 'cellStyleXfs') ?? root, 'xf');
    const normal=children(first(root,'cellStyles') ?? root,'cellStyle').find(node=>attribute(node,'builtinId')==='0'),normalXf=base[number(normal ? attribute(normal,'xfId') : undefined,0)];
    const normalFont=fonts[number(normalXf ? attribute(normalXf,'fontId') : undefined,0)];
    if(normalFont)this.normalFont={family:normalFont.family || this.normalFont.family,points:normalFont.points ?? 11,bold:!!normalFont.bold,italic:!!normalFont.italic};
    const cellFormats = children(first(root, 'cellXfs') ?? root, 'xf');
    if (cellFormats.length > 65536) throw new FileError('TOO_LARGE', '工作簿样式超过 65536 项');
    for (const item of cellFormats) {
      const parent = base[number(attribute(item, 'xfId'), 0)], inherited = (key: string,flag:string) => !['0','false'].includes(attribute(item,flag) ?? '') ? attribute(item,key) ?? (parent ? attribute(parent,key) : undefined) : parent ? attribute(parent,key) : undefined;
      const formatId = number(inherited('numFmtId','applyNumberFormat'), 0), align = !['0','false'].includes(attribute(item,'applyAlignment') ?? '') ? first(item,'alignment') ?? (parent ? first(parent,'alignment') : undefined) : parent ? first(parent,'alignment') : undefined;
      const fontId = number(inherited('fontId','applyFont'), 0), fillId = number(inherited('fillId','applyFill'), 0), borderId = number(inherited('borderId','applyBorder'), 0);
      if ((fonts.length && fontId >= fonts.length) || (fills.length && fillId >= fills.length) || (borders.length && borderId >= borders.length)) throw new FileError('INVALID_INPUT', '工作簿样式资源索引无效');
      const horizontal = align && attribute(align, 'horizontal'), vertical = align && attribute(align, 'vertical');
      this.styles.push({ font: fonts[fontId], fill: fills[fillId], borders: borders[borderId], numberFormat: formats.get(formatId) ?? formatId,
        ...(align ? { alignment: { horizontal: ['left','center','right','justify'].includes(horizontal!) ? horizontal as 'left' : undefined, vertical: ['top','center','bottom'].includes(vertical!) ? vertical as 'top' : undefined, wrap: ['1','true'].includes(attribute(align, 'wrapText') ?? ''), indent: number(attribute(align, 'indent'), 0, 0, 250), rotation: number(attribute(align, 'textRotation'), 0, 0, 255), shrink: ['1','true'].includes(attribute(align, 'shrinkToFit') ?? '') } } : {}) });
    }
    if (!this.styles.length) this.styles.push({ numberFormat: 0 });
  }
  richFont(node:OfficeXmlNode):OfficeCellStyle['font'] {
    const result:NonNullable<OfficeCellStyle['font']>={};
    const family=value(node,'rFont');if(family !== undefined)result.family=family.slice(0,256);
    const size=value(node,'sz');if(size !== undefined)result.points=number(size,11,1,409);
    for(const [field,name] of [['bold','b'],['italic','i'],['underline','u'],['strike','strike']] as const){const child=first(node,name);if(child)result[field]=enabled(child) && !(name==='u' && attribute(child,'val')==='none');}
    if(first(node,'color'))result.color=this.projectColor(first(node,'color'));
    return result;
  }
  get(index: number): OfficeCellStyle {
    const value = this.styles[index]; if (!value) throw new FileError('INVALID_INPUT', '单元格样式索引不存在'); return structuredClone(value);
  }
  differentialFill(index:number):string|undefined {
    if(!Number.isInteger(index) || index<0 || index>=this.differentialFills.length)throw new FileError('INVALID_INPUT','条件格式的差异样式索引无效');
    return this.differentialFills[index];
  }
  display(cell: OfficeCell, date1904: boolean): string {
    const style = this.get(cell.style);
    if (cell.type !== 'number') return cell.value;
    // Do not round a long lexical integer through JavaScript's Number. Such
    // files retain/display the stored value even if an external editor rounds it.
    if (/^[+-]?\d+$/.test(cell.value) && !Number.isSafeInteger(Number(cell.value))) return cell.value;
    const numeric = Number(cell.value); if (!Number.isFinite(numeric)) return cell.value;
    try { return format(style.numberFormat, numeric, { date1904 }); } catch { return cell.value; }
  }
}
