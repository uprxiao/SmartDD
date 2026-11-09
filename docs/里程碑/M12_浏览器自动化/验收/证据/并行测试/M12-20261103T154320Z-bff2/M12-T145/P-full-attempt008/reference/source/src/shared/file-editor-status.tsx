import { Info, Undo2 } from 'lucide-react';
import './file-editor-status.css';

export function FileEditorStatus({ canUndo, canRedo, disabled = false, saving = false, error = '', vimMode, onUndo, onRedo }: {
  canUndo: boolean;
  canRedo: boolean;
  disabled?: boolean;
  saving?: boolean;
  error?: string;
  /** Read-only label from an actually enabled host. This does not enable Vim. */
  vimMode?: string | null;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const mode = typeof vimMode === 'string' && vimMode.trim() ? vimMode : null;
  if (!canUndo && !canRedo && !saving && !error && !mode) return null;
  return <div className="fw-editor-status" role="toolbar" aria-label="保存与编辑历史">
    <button type="button" className="fw-icon" title="撤销" aria-label="撤销" disabled={disabled || !canUndo} onMouseDown={event => event.preventDefault()} onClick={onUndo}><Undo2 size={17} strokeWidth={1.65} /></button>
    <button type="button" className="fw-icon fw-editor-status-redo" title="重做" aria-label="重做" disabled={disabled || !canRedo} onMouseDown={event => event.preventDefault()} onClick={onRedo}><Undo2 size={17} strokeWidth={1.65} /></button>
    {mode && <span className="fw-editor-status-mode" role="status" aria-label="Vim 模式">{mode}</span>}
    {saving && <span className="fw-editor-status-saving" role="status"><span className="fw-loading" aria-hidden="true" />正在保存…</span>}
    {!saving && error && <span className="fw-editor-status-error" role="alert" title={error}><Info size={14} strokeWidth={1.65} aria-hidden="true" /><span>保存失败</span></span>}
  </div>;
}
