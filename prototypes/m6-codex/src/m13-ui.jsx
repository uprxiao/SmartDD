// M13 原型共用界面组件（从 M13Workspace.jsx 拆出，供各页面复用）。
import React, { useEffect, useRef } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { PluginIcon } from './m13-icons.jsx';

export function Mark({ id, name, size = 36, large = false }) {
  const px = large ? 60 : size;
  return <span className={'m10-appmark m13-mark tile' + (large ? ' large' : '')} style={{ width: px, height: px, flexBasis: px }} aria-hidden="true"><PluginIcon id={id} name={name} size={px} /></span>;
}
export const Btn = ({ icon: Icon, label, onClick, ...rest }) => <button type="button" className="m10-icon" aria-label={label} title={label} onClick={onClick} {...rest}><Icon size={16} /></button>;
export function Dialog({ title, sub, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  useEffect(() => { const prev = document.activeElement; ref.current?.querySelector('button, input, select, textarea')?.focus(); const key = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); prev?.focus?.(); }; }, []);
  return <div className="m13-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={'m13-dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
    <div className="m13-dialog-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><Btn icon={X} label="关闭" onClick={onClose} /></div>
    <div className="m13-dialog-body">{children}</div>{footer && <div className="m13-dialog-foot">{footer}</div>}</div></div>;
}
export const Pill = ({ tone = 'muted', children }) => <span className={'m13-pill ' + tone}>{children}</span>;
export function Menu({ open, onToggle, label, items }) {
  return <div className="m10-menu-wrap"><Btn icon={MoreHorizontal} label={label} aria-expanded={open} onClick={onToggle} />{open && <div className="m10-menu" role="menu">{items.filter(Boolean).map(([text, fn, danger]) => <button key={text} role="menuitem" className={danger ? 'm13-danger' : ''} onClick={fn}>{text}</button>)}</div>}</div>;
}

