// M13 插件图标：参照 Codex 目录中的全彩方块图标（渐变底＋白色实心图形、无边框）。
// 邮件、浏览器为 WillYou 自有设计（邮件用品牌青玉绿）；禅道为待替换的占位设计，正式版需使用来源可追溯的官方资源。
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
  zentao: { from: '#4b8bff', to: '#1f56d8', glyph: <>
    <path d="M11 11.5h14L12.5 24.5H25" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.5 18h5.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".85" />
  </> },
};
/** 插件名在示例卡中的品牌色（Codex 示例卡中 Gmail 用其品牌红）。 */
export const pluginAccent = id => ({ mail: '#0d8a80', browser: '#5b5df0', zentao: '#2a62e2' })[id] || '#6d46e0';
const FALLBACK = [['#f7b23b', '#ea7a12'], ['#a67cf5', '#6d46e0'], ['#f27a9b', '#d9456f'], ['#5cc6f2', '#2b8ad6'], ['#7fd18b', '#3a9f52']];
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** size：渲染像素；圆角为渲染像素（36→9，60→14，16→3.5，按 Codex 实测比例）。 */
export function PluginIcon({ id, name = '', size = 36 }) {
  const tile = TILES[id];
  const [from, to] = tile ? [tile.from, tile.to] : FALLBACK[hash(id || name) % FALLBACK.length];
  const r = size >= 56 ? 14 : size >= 30 ? 9 : size >= 20 ? 6 : 3.5;
  const gid = 'm13g-' + (id || 'x') + '-' + size;
  return <svg className="m13-icon" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{ borderRadius: r }}>
    <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient></defs>
    <rect width="36" height="36" rx={r * 36 / size} fill={`url(#${gid})`} />
    <rect x=".5" y=".5" width="35" height="35" rx={r * 36 / size - .5} fill="none" stroke="#fff" strokeOpacity=".18" />
    {tile ? tile.glyph : <text x="18" y="24.2" textAnchor="middle" fontSize="17" fontWeight="600" fill="#fff" fontFamily="-apple-system,system-ui,sans-serif">{(name || id || '?').trim().charAt(0).toUpperCase()}</text>}
  </svg>;
}
