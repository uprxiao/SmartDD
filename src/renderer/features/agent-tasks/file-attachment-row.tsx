import type { ReactNode } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { FileTreeIcon } from '@renderer/features/files/file-icon';

export function FileAttachmentRow({ name, title = name, status, copied, onOpen, actions }: {
  name: string;
  title?: string;
  status?: 'preparing' | 'ready' | 'failed';
  copied?: boolean;
  onOpen?: () => void;
  actions?: ReactNode;
}) {
  const dot = name.lastIndexOf('.');
  const suffix = dot > 0 ? name.slice(dot) : '';
  const extension = /^\.[\w-]{1,12}$/.test(suffix) ? suffix : '';
  const identity = <>
    {status === 'preparing' ? <Loader2 size={16} className="spin" aria-hidden /> : <FileTreeIcon path={name} />}
    <span className="agent-file-attachment-name">
      <span className="agent-file-attachment-stem">{name.slice(0, name.length - extension.length)}</span>
      {extension && <span className="agent-file-attachment-extension">{extension}</span>}
    </span>
  </>;
  return <div className="agent-file-attachment" data-status={status} title={title}>
    {onOpen
      ? <button type="button" className="agent-file-attachment-main" aria-label={'预览附件 ' + name} onClick={onOpen}>
        {identity}<ChevronRight size={14} className="agent-file-attachment-arrow" aria-hidden />
      </button>
      : <span className="agent-file-attachment-main">{identity}</span>}
    {copied && <span className="agent-file-attachment-copy">副本</span>}
    {actions}
  </div>;
}
