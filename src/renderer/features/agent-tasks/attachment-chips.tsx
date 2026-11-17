// 输入框附件卡片与准备逻辑（任务区与首页共用；无事件订阅等副作用）。
import { FileText, Loader2, RotateCw, X } from 'lucide-react';
import { rpc } from '@renderer/lib/ipc';

export type PreparedAttachment = Awaited<ReturnType<typeof rpc.agentTasks.prepareAttachment>>;
export interface Chip { localId: string; name: string; status: 'preparing' | 'ready' | 'failed'; error?: string; preview?: string; data?: PreparedAttachment; file?: File }

/** 读取粘贴的文件：有本机路径的按路径准备（项目内引用、项目外复制），剪贴板图片等按内容准备。 */
export async function prepareChip(file: File, prepare: (f: { name: string; mime?: string; sourcePath?: string; dataBase64?: string }) => Promise<PreparedAttachment>): Promise<PreparedAttachment> {
  const path = window.electronAPI.pathForFile?.(file) ?? '';
  if (path) return prepare({ name: file.name || path.split('/').pop() || 'file', mime: file.type, sourcePath: path });
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return prepare({ name: file.name || `粘贴的图片.${(file.type.split('/')[1] || 'png')}`, mime: file.type, dataBase64: btoa(bin) });
}

/** 附件卡片（照 Codex：图片缩略图／“预览＋文件名”，悬停出现移除）。 */
export function AttachmentChips({ chips, onRemove, onRetry }: { chips: Chip[]; onRemove: (id: string) => void; onRetry: (id: string) => void }) {
  if (!chips.length) return null;
  return <div className="agent-chips">{chips.map(c => <div key={c.localId} className={`agent-chip ${c.status}`} title={c.error ?? (c.data?.kind === 'path' ? `项目文件：${c.data.relativePath}` : c.data?.kind === 'file' ? '项目外文件，已复制为附件' : c.name)}>
    {c.preview ? <img src={c.preview} alt="" /> : <span className="agent-chip-icon">{c.status === 'preparing' ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}</span>}
    <span className="agent-chip-name">{c.name}{c.data?.kind === 'file' && !c.data.image ? ' · 副本' : ''}</span>
    {c.status === 'failed' && <button type="button" title="重试" onClick={() => onRetry(c.localId)}><RotateCw size={12} /></button>}
    <button type="button" className="agent-chip-remove" title="移除" onClick={() => onRemove(c.localId)}><X size={12} /></button>
  </div>)}</div>;
}

