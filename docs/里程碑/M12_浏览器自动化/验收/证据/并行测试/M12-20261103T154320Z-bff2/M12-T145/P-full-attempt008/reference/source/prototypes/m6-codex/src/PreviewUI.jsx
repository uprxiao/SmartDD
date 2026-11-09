import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export function IconButton({ icon: Icon, label, onClick, className = '', ...props }) {
  return <button type="button" className={'icon-button ' + className} aria-label={label} title={label} onClick={onClick} {...props}><Icon size={17} strokeWidth={1.65} /></button>;
}
export function Dialog({ title, subtitle, children, onClose, className = '' }) {
  const ref = useRef(null);
  useEffect(() => { const d = ref.current; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={ref} className={'dialog ' + className} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
    <div className="dialog-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} label="关闭弹窗" onClick={onClose} /></div>{children}
  </dialog>;
}
export function Field({ label, name, children, ...props }) {
  return <label className="field">{label}{children || <input name={name} {...props} />}</label>;
}
export function PathField({ label, name, defaultValue = '', required = false, sample = '/workspace/example' }) {
  const [value, setValue] = useState(defaultValue);
  return <label className="field">{label}<span className="field-inline"><input name={name} required={required} pattern="/.*" title="请输入以 / 开头的完整路径" value={value} onChange={e => setValue(e.target.value)} placeholder="绝对路径" /><button type="button" className="button secondary" title="原型使用示例路径，不读取本机文件" onClick={() => setValue(sample)}>浏览</button></span></label>;
}
export function SecretField({ label, name, saved }) {
  const [mode, setMode] = useState(saved ? 'keep' : 'replace');
  return <div className="field"><span>{label}</span><input type="hidden" name={name + 'Mode'} value={mode} /><div className="field-inline">
    {mode === 'replace' ? <input aria-label={label + '（示例值）'} type="password" name={name} autoComplete="new-password" placeholder="仅填写示例，不输入真实凭据" /> : <span className="secret-state">{mode === 'clear' ? '保存时清除' : '•••••• 已保存（示例）'}</span>}
    {mode !== 'replace' && <button type="button" className="text-button" onClick={() => setMode('replace')}>替换</button>}
    {mode !== 'clear' && <button type="button" className="text-button" onClick={() => setMode('clear')}>清除</button>}
    {saved && mode !== 'keep' && <button type="button" className="text-button" onClick={() => setMode('keep')}>撤销</button>}
  </div></div>;
}
export function ConfirmDialog({ title, description, onClose, onConfirm, secrets = false }) {
  return <Dialog title={title} onClose={onClose}><p className="section-description">{description}</p><p className="section-description">仅影响本次原型数据，刷新可恢复。</p>{secrets && <label className="checkbox-line"><input type="checkbox" defaultChecked />同时清理关联凭据（示例）</label>}<div className="dialog-footer"><button className="button secondary" onClick={onClose}>取消</button><button className="button danger" onClick={onConfirm}>确认删除</button></div></Dialog>;
}
