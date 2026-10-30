import { useState, type ReactElement } from 'react';
import type { EditorView } from '@codemirror/view';
import { Copy, Terminal } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenuItem, DropdownMenuSeparator } from '@renderer/lib/ui/menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Button } from '@renderer/lib/ui/button';
import type { FileBuffer } from '../file-buffer';
import { useFileTerminalContext } from './context';
import { textFingerprint, type SelectionContext } from './store';

export function FileSelectionActions({ buffer, editor, children }: { buffer: FileBuffer; editor: () => EditorView | null; children: ReactElement }) {
  const context = useFileTerminalContext(), [selection, setSelection] = useState<SelectionContext | null>(null), [dialog, setDialog] = useState(false), [instruction, setInstruction] = useState(''), [error, setError] = useState('');
  if (!context) return children;
  const path = { lease: buffer.file.ref.lease, generation: buffer.file.ref.generation, relativePath: buffer.file.relativePath };
  const capture = () => {
    const view = editor(), range = view?.state.selection.main;
    if (!view || !range || range.empty || view.composing || !buffer.inputSettled) { setSelection(null); return; }
    const { from, to } = range, text = view.state.sliceDoc(from, to), version = buffer.version, instance = buffer.instance;
    // The menu/dialog owns this range snapshot. Native menu focus may collapse
    // the live caret after capture; that does not change the displayed source.
    // Still reject replacement views, edits, interrupted input, or changed text.
    setSelection({ text, version, instance, selectedTextHash: textFingerprint(text), range: { startLine: view.state.doc.lineAt(from).number, endLine: view.state.doc.lineAt(Math.max(from, to - 1)).number }, current: () => editor() === view && buffer.instance === instance && buffer.version === version && buffer.inputSettled && to <= view.state.doc.length && view.state.sliceDoc(from, to) === text && !view.composing });
  };
  const add = async (comment?: string) => {
    if (!selection || !selection.current()) { setError('选区内容已改变，请重新选择'); return; }
    await context.add(path, buffer.file.revision, { ...selection, comment }); setDialog(false);
  };
  return <><ContextMenu onOpenChange={open => { if (open) capture(); }}><ContextMenuTrigger render={children} />
    <ContextMenuContent className="fw-file-menu"><DropdownMenuItem disabled={!selection} onClick={() => selection && void navigator.clipboard.writeText(selection.text)}><Copy />复制选中内容</DropdownMenuItem><DropdownMenuSeparator />
      <DropdownMenuItem disabled={!selection} onClick={() => void add()}><Terminal />添加所选内容到终端引用</DropdownMenuItem>
      <DropdownMenuItem disabled={!selection} onClick={() => { setInstruction(''); setError(''); setDialog(true); }}><Terminal />让 CLI 修改所选代码…</DropdownMenuItem>
    </ContextMenuContent></ContextMenu>
    <Dialog open={dialog} onOpenChange={setDialog}><DialogContent><DialogHeader><DialogTitle>为所选代码添加指令</DialogTitle></DialogHeader><DialogDescription className="px-6">选区与指令将加入终端引用；由你确认插入并手动提交。</DialogDescription><div className="px-6"><pre className="fw-ai-selection">{selection?.text}</pre><textarea className="fw-ai-prompt" aria-label="所选代码的 CLI 指令" value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={8000} />{error && <div role="alert">{error}</div>}</div><DialogFooter><Button variant="outline" onClick={() => setDialog(false)}>取消</Button><Button disabled={!instruction.trim()} onClick={() => void add(instruction)}>加入终端引用</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
