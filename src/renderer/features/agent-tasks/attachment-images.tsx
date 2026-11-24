import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ImageIcon, Loader2 } from 'lucide-react';
import { rpc } from '@renderer/lib/ipc';
import type { AttachmentImageSource } from '@shared/agent-attachment-image';
import { RoutedImageGallery as ImageGallery } from '../../../../prototypes/m6-codex/src/ImageGalleryRoute.jsx';

interface Picture {
  id: string;
  name: string;
  alt: string;
  src: string;
}

export function useAttachmentGallery(ids: string[]) {
  const sources = useRef(new Map<string, Picture>());
  const [gallery, setGallery] = useState<{ picture: Picture; pictures: Picture[] } | null>(null);
  const register = useCallback((id: string, picture?: Picture) => {
    if (picture) sources.current.set(id, picture);
    else sources.current.delete(id);
  }, []);
  const open = (id: string) => {
    const picture = sources.current.get(id);
    if (picture) setGallery({ picture, pictures: ids.flatMap(key => sources.current.get(key) ?? []) });
  };
  return {
    register, open,
    dialog: gallery && createPortal(
      <ImageGallery initial={gallery} overlay={false} download={false} onClose={() => setGallery(null)} />,
      document.body,
    ),
  };
}

function imageBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), value => value.charCodeAt(0));
}

export function attachmentImageBlob(base64: string, mime: string) {
  return new Blob([imageBytes(base64)], { type: mime });
}

async function readImage(taskId: string, source: AttachmentImageSource, signal: AbortSignal) {
  let offset = 0;
  let revision: string | undefined;
  let mime = '';
  const parts: BlobPart[] = [];
  for (;;) {
    signal.throwIfAborted();
    const chunk = await rpc.agentTasks.attachmentImage(taskId, source, offset, revision);
    signal.throwIfAborted();
    const bytes = imageBytes(chunk.base64);
    if (!bytes.length || chunk.next !== offset + bytes.length || chunk.next > chunk.totalBytes) throw new Error('图片分块不完整');
    parts.push(bytes);
    offset = chunk.next;
    revision = chunk.revision;
    mime = chunk.mime;
    if (offset === chunk.totalBytes) return new Blob(parts, { type: mime });
  }
}

export function AttachmentThumbnail({ id, name, taskId, source, blob, register, open }: {
  id: string;
  name: string;
  taskId?: string;
  source?: AttachmentImageSource;
  blob?: Blob;
  register: ReturnType<typeof useAttachmentGallery>['register'];
  open: ReturnType<typeof useAttachmentGallery>['open'];
}) {
  const tile = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(!taskId || Boolean(blob));
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sourceKey = source?.kind === 'message' ? source.turnId + '/' + source.index : source?.attachmentId;

  useEffect(() => {
    if (visible) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '140px' });
    if (tile.current) observer.observe(tile.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    let url: string | undefined;
    const load = async () => {
      try {
        const image = blob ?? (taskId && source ? await readImage(taskId, source, abort.signal) : undefined);
        abort.signal.throwIfAborted();
        if (!image) throw new Error('图片副本不可用');
        url = URL.createObjectURL(image);
        setSrc(url);
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      }
    };
    setSrc('');
    setFailed(false);
    void load();
    return () => {
      abort.abort();
      register(id);
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, visible, blob, taskId, source?.kind, sourceKey, attempt, register]);

  const label = failed ? '重试加载图片' : '预览图片';
  return <button ref={tile} type="button" className="agent-attachment-thumbnail" aria-label={label + ' ' + name} title={name}
    aria-busy={!src && !failed} aria-disabled={!src && !failed} onClick={() => failed ? setAttempt(value => value + 1) : open(id)}>
    {src && !failed
      ? <img src={src} alt={name} decoding="async" draggable={false}
        onLoad={() => register(id, { id, src, name, alt: name })}
        onError={() => { register(id); setFailed(true); }} />
      : <span className="agent-attachment-placeholder">
        {failed ? <ImageIcon size={16} aria-hidden/> : <Loader2 size={16} aria-hidden className="spin"/>}
        <span>{name}</span>
      </span>}
  </button>;
}

interface MessageAttachment {
  kind: 'file' | 'path';
  name: string;
  image?: boolean;
  relativePath?: string;
}

export function MessageWithAttachments({ attachments, taskId, turnId, children }: {
  attachments: MessageAttachment[];
  taskId: string;
  turnId?: string | null;
  children: ReactNode;
}) {
  const gallery = useAttachmentGallery(attachments.map((_, index) => String(index)));
  return <>
    <div className="agent-message-pictures">
      {attachments.map((attachment, index) => attachment.image && turnId
        ? <AttachmentThumbnail key={index} id={String(index)} name={attachment.name} taskId={taskId}
          source={{ kind: 'message', turnId, index }} register={gallery.register} open={gallery.open}/>
        : null)}
    </div>
    {children}
    <div className="agent-user-attachments">
      {attachments.map((attachment, index) => !attachment.image || !turnId
        ? <span key={index} className="agent-message-file" title={attachment.relativePath ?? attachment.name}>
          {attachment.relativePath ?? attachment.name}
        </span> : null)}
    </div>
    {gallery.dialog}
  </>;
}
