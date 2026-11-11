// M13 插件图标：参照 Codex 目录中的全彩方块图标（渐变底＋白色实心图形、无边框）。
// 邮件、浏览器为 WillYou 自有设计（邮件用品牌青玉绿）。禅道使用官网公开 Logo（来源见 public/assets/m13-plugin-icons/SOURCE.md），
// 按 Codex 处理圆形品牌标志的方式（如 GitHub）：白底方块＋细边框，标志居中约占 72%。
// 未声明图标的插件按名称生成首字母方块作为回退（需求 3.2“缺失回退”）。浅深主题共用同一套方块图标。
import React from 'react';

const TILES = {
  mail: { from: '#2cc3b2', to: '#0d8a80', glyph: <>
    <rect x="8.5" y="11" width="19" height="14" rx="3" fill="#fff" />
    <path d="M9.6 12.6 18 19l8.4-6.4" fill="none" stroke="#0f978b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </> },
  browser: { from: '#6aa2ff', to: '#6a4ff0', glyph: <>
    <circle cx="18" cy="18" r="9.2" fill="none" stroke="#fff" strokeWidth="2" />
    <ellipse cx="18" cy="18" rx="4" ry="9.2" fill="none" stroke="#fff" strokeWidth="1.8" />
    <path d="M9 18h18M10.6 13.4h14.8M10.6 22.6h14.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
  </> },
};
/** 插件名在示例卡中的品牌色（Codex 示例卡中 Gmail 用其品牌红）。 */
export const pluginAccent = id => ({ mail: '#0d8a80', browser: '#5b5df0', zentao: '#1a8fff' })[id] || '#6d46e0';
/** 官方品牌图片（白底方块＋边框）；有图片时优先于 TILES。 */
const IMAGES = { zentao: '/assets/m13-plugin-icons/zentao.png' };
const FALLBACK = [['#f7b23b', '#ea7a12'], ['#a67cf5', '#6d46e0'], ['#f27a9b', '#d9456f'], ['#5cc6f2', '#2b8ad6'], ['#7fd18b', '#3a9f52']];
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** size：渲染像素；圆角为渲染像素（36→9，60→14，16→3.5，按 Codex 实测比例）。 */
export function PluginIcon({ id, name = '', size = 36 }) {
  const r = size >= 56 ? 14 : size >= 30 ? 9 : size >= 20 ? 6 : 3.5;
  if (IMAGES[id]) {
    const inset = size <= 16 ? 1 : 5;
    return <svg className="m13-icon image" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{ borderRadius: r }}>
      {size > 16 && <rect x=".5" y=".5" width="35" height="35" rx={r * 36 / size - .5} fill="#fff" stroke="#ededed" />}
      <image href={IMAGES[id]} x={inset} y={inset} width={36 - inset * 2} height={36 - inset * 2} preserveAspectRatio="xMidYMid meet" />
    </svg>;
  }
  const tile = TILES[id];
  const [from, to] = tile ? [tile.from, tile.to] : FALLBACK[hash(id || name) % FALLBACK.length];
  const gid = 'm13g-' + (id || 'x') + '-' + size;
  return <svg className="m13-icon" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{ borderRadius: r }}>
    <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient></defs>
    <rect width="36" height="36" rx={r * 36 / size} fill={`url(#${gid})`} />
    <rect x=".5" y=".5" width="35" height="35" rx={r * 36 / size - .5} fill="none" stroke="#fff" strokeOpacity=".18" />
    {tile ? tile.glyph : <text x="18" y="24.2" textAnchor="middle" fontSize="17" fontWeight="600" fill="#fff" fontFamily="-apple-system,system-ui,sans-serif">{(name || id || '?').trim().charAt(0).toUpperCase()}</text>}
  </svg>;
}

/** 供应商与工具图标（P0.12）：使用官方图标（来源与哈希见 public/assets/m13-agent-icons/SOURCE.md）。
 *  App 图标（Claude、Magpie）自带圆角底，裁掉 macOS 图标留白后铺满；网站图标放在白底方块中。
 *  Codex 暂无可追溯的专用图标，用 OpenAI 标志黑底白标，与 OpenAI 供应商的白底黑标区分。没有图标的用首字母方块。 */
const A = '/assets/m13-agent-icons/';
const PROVIDER_IMAGES = {
  'tool-claude': { href: A + 'claude.png', bleed: 1.22 }, 'tool-codex': { href: A + 'openai-white.svg', bg: '#0d0d0d', inset: 7 },
  anthropic: { href: A + 'anthropic.png', bleed: 1 }, openai: { href: A + 'openai.svg', bg: '#fff', inset: 7, border: true },
  deepseek: { href: A + 'deepseek.png', bg: '#fff', inset: 3, border: true },
  'agent-opencode': { href: A + 'opencode.png', bleed: 1 }, 'agent-pi': { href: A + 'pi.svg', bg: '#fff', inset: 2, border: true }, 'agent-zcode': { href: A + 'zcode.png', bleed: 1.22 }, 'agent-dsh': { href: A + 'dsh.png', bleed: 1.22 }, glm: { href: A + 'zhipu.png', bleed: 1.04 }, magpie: { href: A + 'magpie.png', bleed: 1.22 },
};
PROVIDER_IMAGES['native-claude'] = PROVIDER_IMAGES['tool-claude']; PROVIDER_IMAGES['native-codex'] = PROVIDER_IMAGES['tool-codex'];
const PROVIDER_TILES = { smg: ['#25b39e', '#12867a'], ultracloud: ['#ff9a3d', '#e86b13'] };
export function ProviderIcon({ catalog, name = '', size = 28 }) {
  const r = size >= 30 ? 9 : size >= 20 ? 6 : 4, rv = r * 36 / size, gid = 'm13p-' + (catalog || name || 'x').replace(/[^\w-]/g, '_') + '-' + size;
  const img = PROVIDER_IMAGES[catalog];
  if (img) {
    const w = img.bleed ? 36 * img.bleed : 36 - (img.inset || 0) * 2, o = (36 - w) / 2;
    return <svg className="m13-icon image" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{ borderRadius: r }}>
      <defs><clipPath id={gid}><rect width="36" height="36" rx={rv} /></clipPath></defs>
      <g clipPath={`url(#${gid})`}>{img.bg && <rect width="36" height="36" fill={img.bg} />}<image href={img.href} x={o} y={o} width={w} height={w} preserveAspectRatio="xMidYMid meet" /></g>
      {img.border && <rect x=".5" y=".5" width="35" height="35" rx={rv - .5} fill="none" stroke="#e3e3e3" />}
    </svg>;
  }
  const [from, to] = PROVIDER_TILES[catalog] || FALLBACK[hash(catalog || name) % FALLBACK.length];
  const letter = (name || catalog || '?').trim().charAt(0).toUpperCase();
  return <svg className="m13-icon" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{ borderRadius: r }}>
    <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient></defs>
    <rect width="36" height="36" rx={rv} fill={`url(#${gid})`} />
    <text x="18" y="24.2" textAnchor="middle" fontSize="17" fontWeight="600" fill="#fff" fontFamily="-apple-system,system-ui,sans-serif">{letter}</text>
  </svg>;
}
export const ToolIcon = ({ tool, size = 16 }) => <ProviderIcon catalog={'tool-' + tool} size={size} />;
