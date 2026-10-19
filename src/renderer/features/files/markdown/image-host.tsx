import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from '../file-buffer';
import { useFileTerminalContext } from '../terminal-context/context';
import { ImageGallery } from '../../../../../prototypes/m6-codex/src/ImageGallery.jsx';
import { imageMenuActions } from '@shared/image-menu-policy.mjs';
import { loadMarkdownImage, withMarkdownImage, type MarkdownImageSource } from './images';
import './image-host.css';

interface Picture extends MarkdownImageSource {
  id: number; element: HTMLImageElement; owner: AbortSignal; resource: AbortController;
  ready: boolean; reload(): Promise<void>;
}
interface Gallery { picture: Picture; pictures: Picture[] }
interface MenuState { picture: Picture; x: number; y: number }
const idleSubscribe = () => () => {}, idleSnapshot = () => 0;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Owns only embedded Markdown images, never the ordinary tree image route.
 * Source capabilities close after reads/actions; URLs belong to widget lifetime. */
export function useMarkdownImages(buffer: FileBuffer, enabled: boolean, hasContext: boolean, onOpen?: (href: string) => Promise<void>) {
  const terminal = useFileTerminalContext();
  useSyncExternalStore(terminal?.subscribe ?? idleSubscribe, terminal?.snapshot ?? idleSnapshot);
  const settings = useRef({ hasContext, onOpen }); settings.current = { hasContext: hasContext || Boolean(terminal?.target), onOpen };
  const records = useRef(new Map<HTMLImageElement, Picture>()), serial = useRef(0), origin = useRef<HTMLImageElement | null>(null);
  const [gallery, setGallery] = useState<Gallery | null>(null), [menu, setMenu] = useState<MenuState | null>(null), [notice, setNotice] = useState('');
  useEffect(() => { if (!enabled) { setGallery(null); setMenu(null); } else if (!settings.current.hasContext) setMenu(null); }, [enabled, hasContext, terminal?.target]);
  const restore = () => { if (origin.current?.isConnected) origin.current.focus({ preventScroll: true }); };
  useEffect(() => () => { for (const p of records.current.values()) p.resource.abort(); records.current.clear(); }, [buffer, enabled]);
  const load = useCallback(async (element: HTMLImageElement, href: string, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    const p: Picture = { id: ++serial.current, element, href, src: '', alt: element.alt || '图片', name: '', path: '', hash: '', mime: '', animated: false, owner: signal, resource: new AbortController(), ready: false, reload: async () => {} };
    records.current.set(element, p);
    const current = () => !signal.aborted && records.current.get(element) === p;
    const open = () => {
      if (!current()) return;
      const root = element.closest('.fw-codemirror');
      const pictures = [...(root?.querySelectorAll<HTMLImageElement>('img[data-md-src]') ?? [element])].map(e => records.current.get(e)).filter((x): x is Picture => Boolean(x && x.element.isConnected && !x.owner.aborted));
      origin.current = element; setMenu(null); setNotice(''); setGallery({ picture: p, pictures: pictures.includes(p) ? pictures : [p] });
    };
    const click = (e: MouseEvent) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); open(); } };
    const down = (e: MouseEvent) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); } };
    const key = (e: KeyboardEvent) => { if (e.isComposing || e.keyCode === 229 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) open(); } };
    const context = (e: MouseEvent) => { if (!current()) return; e.stopPropagation(); if (!settings.current.hasContext) return; e.preventDefault(); origin.current = element; setGallery(null); setNotice(''); setMenu({ picture: p, x: e.clientX, y: e.clientY }); };
    element.tabIndex = 0; element.setAttribute('role', 'button'); element.setAttribute('aria-label', '预览图片 ' + p.alt);
    element.addEventListener('click', click); element.addEventListener('mousedown', down); element.addEventListener('keydown', key); element.addEventListener('contextmenu', context);
    signal.addEventListener('abort', () => {
      p.resource.abort(); if (records.current.get(element) === p) records.current.delete(element);
      element.removeEventListener('click', click); element.removeEventListener('mousedown', down); element.removeEventListener('keydown', key); element.removeEventListener('contextmenu', context);
      setGallery(old => old?.pictures.includes(p) ? null : old); setMenu(old => old?.picture === p ? null : old);
    }, { once: true });
    p.reload = async () => {
      if (!current()) throw new Error('图片来源已关闭');
      p.resource.abort(); p.resource = new AbortController(); p.ready = false;
      try {
        const source = await loadMarkdownImage(buffer, element, href, p.resource.signal);
        if (!current()) { p.resource.abort(); return; }
        Object.assign(p, source); p.ready = true; delete element.dataset.imageUnavailable; element.classList.remove('fw-md-image-error'); element.title = '打开嵌入图片';
        setGallery(old => old?.pictures.includes(p) ? { ...old } : old);
        setMenu(old => old?.picture === p ? { ...old } : old);
      } catch (error) { if (current()) { const text = message(error); element.title = text; element.dataset.imageUnavailable = text; setNotice(text); } throw error; }
    };
    await p.reload();
  }, [buffer]);
  const act = async (id: string, p: Picture, value?: string) => {
    setMenu(null); restore();
    try {
      if (p.owner.aborted || !enabled) throw new Error('图片来源已关闭');
      if (!p.ready) throw new Error(p.element.dataset.imageUnavailable || '图片尚未加载，请重试');
      if (id === 'reference') throw new Error('当前任务尚未接入图片输入 provider；图片未加入输入，也未发送消息');
      if (id === 'address') { if (!value || !/^https?:\/\//i.test(value)) throw new Error('此图片没有可复制的 HTTP(S) 地址'); await navigator.clipboard.writeText(value); return; }
      await withMarkdownImage(buffer, p, p.owner, async file => {
        if (id === 'open') { if (!settings.current.onOpen) throw new Error('图片新标签入口不可用'); await settings.current.onOpen(p.href); }
        else if (id === 'download') { const receipt = await rpc.files.saveCopy({ target: { kind: 'document', ref: file.ref }, baseHash: p.hash }); setNotice(receipt.state === 'cancelled' ? '已取消保存图片副本' : '图片副本已保存'); }
        else if (id === 'reveal') await rpc.files.reveal({ kind: 'document', ref: file.ref });
        else if (id === 'copy') {
          if (p.animated) throw new Error('动画图片不支持复制为静态图片');
          const image = new Image(); image.src = p.src; await image.decode(); p.owner.throwIfAborted();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          try {
            const context = canvas.getContext('2d'); if (!context) throw new Error('图片转换不可用'); context.drawImage(image, 0, 0);
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(x => x ? resolve(x) : reject(new Error('图片转换失败')), 'image/png'));
            p.owner.throwIfAborted(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setNotice('图片已复制为 PNG');
          } finally { canvas.width = canvas.height = 0; }
        }
      });
    } catch (error) { if (!p.owner.aborted) setNotice(message(error)); }
  };
  const actions = menu ? imageMenuActions({ src: menu.picture.href, displaySrc: menu.picture.src, localPath: menu.picture.path, animated: menu.picture.animated, canSelect: true, canCopy: true, clipboard: typeof ClipboardItem !== 'undefined' && Boolean(navigator.clipboard?.write) }) : [];
  const ui = <>
    {enabled && notice && <div role="status" className="fw-save-strip fw-image-notice">{notice}</div>}
    {enabled && gallery && createPortal(<ImageGallery initial={gallery} overlay={false} download onClose={() => { setGallery(null); restore(); }} onDownload={p => void act('download', p)} onRetry={p => p.reload()} />, document.body)}
    {enabled && menu && settings.current.hasContext && createPortal(<MarkdownImageMenu state={menu} actions={actions} onClose={() => { setMenu(null); restore(); }} onAction={(id, value) => void act(id, menu.picture, value)} />, document.body)}
  </>;
  return { load, ui };
}

function MarkdownImageMenu({ state, actions, onClose, onAction }: { state: MenuState; actions: { id: string; label: string; value?: string }[]; onClose(): void; onAction(id: string, value?: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const e = ref.current!; const r = e.getBoundingClientRect(); e.style.left = Math.max(8, Math.min(state.x, innerWidth - r.width - 8)) + 'px'; e.style.top = Math.max(8, Math.min(state.y, innerHeight - r.height - 8)) + 'px'; e.querySelector('button')?.focus({ preventScroll: true }); }, [state]);
  return <><div className="fw-image-menu-dismiss" onMouseDown={onClose} /><div ref={ref} role="menu" aria-label="嵌入图片操作" className="fw-embedded-image-menu" onKeyDown={e => {
    e.stopPropagation(); if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) { e.preventDefault(); const all = [...ref.current!.querySelectorAll('button')], i = all.indexOf(document.activeElement as HTMLButtonElement); all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowUp' || e.key === 'Tab' && e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus(); }
  }}>{actions.map(a => <button type="button" role="menuitem" key={a.id} onClick={() => onAction(a.id, a.value)}>{a.label}</button>)}</div></>;
}
