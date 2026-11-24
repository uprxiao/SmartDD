import { useEffect, useReducer, useState } from 'react';
import { File, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { rpc } from '@renderer/lib/ipc';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { FileBuffer } from '@renderer/features/files/file-buffer';
import { FileContent } from '@renderer/features/files/workspace-panel';
import type { MessageAttachmentSelection } from './workspace-panels-store';

const outsideAttachment = '附件预览仅显示当前文件的内容';
const noRelativeImage = async () => { throw new Error(outsideAttachment); };

export function MessageAttachmentPreview({ taskId, attachment }: { taskId: string; attachment: MessageAttachmentSelection }) {
  const { turnId, index } = attachment;
  const [buffer, setBuffer] = useState<FileBuffer | null>(null);
  const [error, setError] = useState('');
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    let active = true;
    let current: FileBuffer | undefined;
    setBuffer(null);
    setError('');
    void rpc.files.openAgentAttachment({ taskId, turnId, index }).then(async file => {
      if (!active) {
        await rpc.files.closeDocument(file.ref).catch(() => undefined);
        return;
      }
      current = new FileBuffer(file, rpc.files, redraw);
      setBuffer(current);
      await current.load();
    }).catch(error => {
      if (active) setError(rpcErrorMessage(error));
    });
    return () => {
      active = false;
      current?.dispose();
    };
  }, [taskId, turnId, index, attempt]);

  const loadError = error || buffer?.loadError;
  const unsupported = buffer && ['archive', 'binary', 'unsupported'].includes(buffer.content.kind);
  const openLink = (href: string) => {
    if (/^https?:\/\//i.test(href)) void rpc.files.openWebLink(href).catch(error => toast.error(rpcErrorMessage(error)));
    else toast.message(outsideAttachment);
  };
  return <div className="file-workspace fw-production agent-attachment-preview" data-testid="agent-attachment-preview" role="tabpanel" aria-label={attachment.name}>
    {loadError ? <div className="fw-empty" role="alert"><span>{loadError}</span><button type="button" onClick={retry}>重新读取</button></div>
      : unsupported ? <div className="fw-empty" role="status"><File size={24} /><span>此附件类型暂不支持内置预览</span></div>
      : buffer ? <div className="fw-content">
        <FileContent buffer={buffer} wrap blame={false} imageContext={false} metadataRevision={0} onLink={openLink} onOpenImage={noRelativeImage} />
      </div>
      : <div className="fw-empty" role="status"><Loader2 size={18} className="spin" />正在读取附件…</div>}
  </div>;
}
