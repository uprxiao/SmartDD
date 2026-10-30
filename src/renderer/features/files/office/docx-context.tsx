import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FileBuffer } from '../file-buffer';
import { useFileTerminalContext } from '../terminal-context/context';
import { textFingerprint, type VisibleTerminal } from '../terminal-context/store';
import './docx-context.css';

const subscribeNone = () => () => undefined, snapshotNone = () => 0;
interface Paragraph { text: string; page: number }
interface CapturedParagraph extends Paragraph { identity: string; target: VisibleTerminal }

/** Paragraph requests use the approved reference tray, with the same explicit
 * insertion and no DOCX write/CLI submission path. */
export function useDocxRequests(buffer: FileBuffer, admitted: boolean) {
  const terminal = useFileTerminalContext();
  useSyncExternalStore(terminal?.subscribe ?? subscribeNone, terminal?.snapshot ?? snapshotNone);
  const identity = `${buffer.instance}/${buffer.file.ref.id}/${buffer.baseHash}`;
  const latest = useRef(identity), alive = useRef(true), selection = useRef<Paragraph | null>(null), busy = useRef(false), operation = useRef(0);
  latest.current = identity;
  const [open, setOpen] = useState(false), [anchor, setAnchor] = useState<CapturedParagraph | null>(null);
  const [draft, setDraft] = useState(''), [notice, setNotice] = useState(''), [adding, setAdding] = useState(false);
  const enabled = Boolean(admitted && terminal?.target && terminal.root?.lease === buffer.file.ref.lease && terminal.root.generation === buffer.file.ref.generation);
  useEffect(() => {
    alive.current = true; operation.current++; busy.current = false; selection.current = null;
    setOpen(false); setAnchor(null); setDraft(''); setNotice(''); setAdding(false);
    return () => { alive.current = false; operation.current++; };
  }, [identity]);
  const capture = (value: Paragraph): CapturedParagraph | null => terminal?.target ? { ...value, identity, target: terminal.target } : null;
  const selected = (value: Paragraph | null) => {
    selection.current = value;
    // Moving focus to the instruction field may collapse the live selection;
    // the displayed paragraph remains an explicit source snapshot.
    if (value && open && !draft.trim() && !busy.current) setAnchor(capture(value));
  };
  const request = () => {
    if (!enabled || busy.current) return;
    if (open && draft.trim()) { setNotice('请先添加或取消评论草稿。'); return; }
    if (!open) { setAnchor(selection.current ? capture(selection.current) : null); setNotice(''); }
    setOpen(value => !value);
  };
  const add = async () => {
    const captured = anchor, file = buffer.file, version = buffer.version, instance = buffer.instance;
    const current = () => alive.current && latest.current === captured?.identity && terminal?.target === captured?.target;
    if (!enabled || !terminal || busy.current || !captured || !draft.trim()) return;
    if (!current()) { setNotice('文件或终端已改变，请重新选择段落。'); return; }
    busy.current = true; setAdding(true); const own = ++operation.current;
    try {
      const accepted = await terminal.addDocx(file, { docx: { page: captured.page }, text: captured.text, comment: draft.trim(),
        version, instance, selectedTextHash: textFingerprint(captured.text), current });
      if (!alive.current || own !== operation.current) return;
      if (accepted) { setDraft(''); setAnchor(null); setOpen(false); setNotice('段落与指令已加入终端引用；预览后可插入，不会自动回车。'); }
      else setNotice(terminal.notice || '未能加入终端引用，草稿已保留。');
    } catch (error) {
      if (alive.current && own === operation.current) setNotice(`未能加入终端引用，草稿已保留：${error instanceof Error ? error.message : String(error)}`);
    } finally { if (alive.current && own === operation.current) { busy.current = false; setAdding(false); } }
  };
  return { onSelectionChange: selected, onRequestEdits: enabled ? request : undefined, commentDraft: draft,
    panel: <>{open && <aside className="fw-docx-review" aria-label="DOCX 评论上下文">
      <strong>请求修改</strong>
      {anchor ? <><small>第 {anchor.page} 页</small><blockquote>{anchor.text}</blockquote></> : <p>请在正文中选择要交接的段落。</p>}
      <textarea aria-label="DOCX 修改指令" placeholder="针对选中段落记录修改请求" value={draft} maxLength={8000} disabled={adding} onChange={event => setDraft(event.target.value)} />
      {!enabled && <p role="status">当前没有可用的任务终端；草稿已保留。</p>}
      <div><button disabled={adding} onClick={() => { setDraft(''); setAnchor(null); setOpen(false); setNotice(''); }}>取消</button><button disabled={!enabled || !anchor || !draft.trim() || adding} onClick={() => void add()}>{adding ? '正在加入…' : '加入终端引用'}</button></div>
      <small>仅插入当前终端输入，由你检查并自行提交。</small>
    </aside>}{notice && <p className="fw-docx-context-notice" role="status">{notice}</p>}</> };
}
