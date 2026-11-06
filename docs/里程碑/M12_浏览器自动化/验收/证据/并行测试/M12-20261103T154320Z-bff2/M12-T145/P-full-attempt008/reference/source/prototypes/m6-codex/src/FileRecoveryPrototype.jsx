import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { FileRecoveryView, recoveryItemKey } from './FileRecoveryView';
const item = { id: '11111111-1111-4111-8111-111111111111', projectKey: 'a'.repeat(64), relativePath: 'notes/review.txt', state: 'needs-inspection', sourceAvailable: true, createdAt: 1792310400000 };
const inspection = { item, state: 'unknown', readOnly: true, materials: ['current', 'displaced', 'draft', 'materialized'].map(kind => ({ kind, available: true, preview: kind === 'displaced' ? '保存前的文件内容\n' : '本地编辑后的内容\n', revision: { device: '1', inode: '2', size: 28, hash: (kind === 'displaced' ? 'b' : 'c').repeat(64), modifiedNs: '0', changedNs: '0' } })) };
export default function FileRecoveryPrototype({ onClose }) {
  const ref = useRef(null), [selected, select] = useState(recoveryItemKey(item));
  useEffect(() => { const previous = document.activeElement; ref.current?.querySelector('button')?.focus(); return () => previous?.isConnected && previous.focus(); }, []);
  return <div className="fw-modal-scrim" onClick={onClose}><section ref={ref} className="fw-dialog fw-recovery-dialog" style={{padding:0,width:'min(900px, calc(100vw - 32px))'}} role="dialog" aria-modal="true" aria-label="保存恢复材料" onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') { const controls = [...ref.current.querySelectorAll('button,summary,[tabindex="0"]')]; if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); } }
  }}><header className="fw-recovery-prototype-header"><h2>保存恢复材料</h2><button aria-label="关闭恢复材料" onClick={onClose}><X size={16}/></button></header><FileRecoveryView items={[item]} selected={selected} onSelect={value => select(recoveryItemKey(value))} inspection={inspection} loading={false} error="" onRetry={() => {}}/></section></div>;
}
