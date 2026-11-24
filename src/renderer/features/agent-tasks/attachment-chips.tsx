// 输入框附件卡片与准备逻辑（任务区与首页共用；无事件订阅等副作用）。
import type { ReactNode } from 'react';
import { RotateCw, X } from 'lucide-react';
import { rpc } from '@renderer/lib/ipc';
import { attachmentImageMime, type AttachmentImageSource } from '@shared/agent-attachment-image';
import { AttachmentThumbnail, useAttachmentGallery } from './attachment-images';
import { FileAttachmentRow } from './file-attachment-row';

export type PreparedAttachment = Awaited<ReturnType<typeof rpc.agentTasks.prepareAttachment>>;
export interface Chip {
  localId: string;
  name: string;
  status: 'preparing' | 'ready' | 'failed';
  error?: string;
  data?: PreparedAttachment;
  file?: File;
  previewBlob?: Blob;
  previewSource?: AttachmentImageSource;
}

/** 读取粘贴的文件：有本机路径的按路径准备（项目内引用、项目外复制），剪贴板图片等按内容准备。 */
export async function prepareChip(file: File, prepare: (f: { name: string; mime?: string; sourcePath?: string; dataBase64?: string }) => Promise<PreparedAttachment>): Promise<PreparedAttachment> {
  const path = window.electronAPI.pathForFile?.(file) ?? '';
  if (path) return prepare({ name: file.name || path.split('/').pop() || 'file', mime: file.type, sourcePath: path });
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return prepare({ name: file.name || `粘贴的图片.${(file.type.split('/')[1] || 'png')}`, mime: file.type, dataBase64: btoa(bin) });
}

export function AttachmentChips({ chips, taskId, onRemove, onRetry }: { chips: Chip[]; taskId?: string; onRemove: (id: string) => void; onRetry: (id: string) => void }) {
  const gallery = useAttachmentGallery(chips.map(chip => chip.localId));
  if (!chips.length) return null;
  const images: ReactNode[] = [], files: ReactNode[] = [];
  for (const chip of chips) {
    const mime = attachmentImageMime(chip.name, chip.data?.mime || chip.file?.type);
    const blob = chip.previewBlob ?? chip.file;
    const source = chip.previewSource ?? (chip.data && { kind: 'draft' as const, attachmentId: chip.data.id });
    const image = chip.status !== 'failed' && mime && (blob || taskId && source);
    const title = chip.error ?? (chip.data?.kind === 'path' ? `项目文件：${chip.data.relativePath}` : chip.name);
    const remove = <button type="button" className={image ? 'agent-chip-remove' : 'agent-file-attachment-action'} aria-label={'移除 ' + chip.name} title="移除" onClick={() => onRemove(chip.localId)}><X size={13} /></button>;
    if (image) {
      images.push(<div key={chip.localId} className="agent-chip agent-image-chip" title={title}>
        <AttachmentThumbnail id={chip.localId} name={chip.name} blob={blob} taskId={taskId} source={source}
          register={gallery.register} open={gallery.open} />
        {remove}
      </div>);
      continue;
    }
    files.push(<FileAttachmentRow key={chip.localId} name={chip.name} title={title} status={chip.status} copied={chip.data?.kind === 'file' && !chip.data.image}
      actions={<>
        {chip.status === 'failed' && <button type="button" className="agent-file-attachment-action" aria-label={'重试 ' + chip.name} title="重试" onClick={() => onRetry(chip.localId)}><RotateCw size={13} /></button>}
        {remove}
      </>} />);
  }
  return <div className="agent-chips">
    {images.length > 0 && <div className="agent-draft-pictures">{images}</div>}
    {files.length > 0 && <div className="agent-draft-files">{files}</div>}
    {gallery.dialog}
  </div>;
}

