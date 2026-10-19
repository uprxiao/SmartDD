import { useEffect, useState, type ReactElement } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Check, ChevronDown, ChevronRight, Copy, Download, ExternalLink, FolderOpen, Loader2, RotateCcw, Terminal } from 'lucide-react';
import type { FileActionTarget, FileApplication, FileApplications, PathRequest } from '@shared/files';
import { encodeFileText } from '@shared/file-text';
import { rpc } from '@renderer/lib/ipc';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import { bytesFromBase64, bytesToBase64, type FileBuffer } from './file-buffer';
import { gitFileLink, type GitRepositoryInfo } from '@shared/file-git';
import { useFileTerminalContext } from './terminal-context/context';

type RunAction = (run: () => Promise<unknown>) => void;
function useApplications(target: FileActionTarget, enabled: boolean) {
  const key = JSON.stringify(target), [attempt, setAttempt] = useState(0), [result, setResult] = useState<{ key: string; data: FileApplications | null; error: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true; setResult(null);
    void rpc.files.applications(target).then((data) => { if (alive) setResult({ key, data, error: '' }); }).catch((failure) => { if (alive) setResult({ key, data: null, error: failure instanceof Error ? failure.message : String(failure) }); });
    return () => { alive = false; };
  }, [key, enabled, attempt]);
  return { data: result?.key === key ? result.data : null, error: result?.key === key ? result.error : '', reload: () => setAttempt((value) => value + 1) };
}
function AppIcon({ app }: { app?: FileApplication }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    setUrl(''); if (!app?.icon) return;
    const value = URL.createObjectURL(new Blob([bytesFromBase64(app.icon)], { type: 'image/png' }));
    setUrl(value); return () => URL.revokeObjectURL(value);
  }, [app?.icon]);
  return url ? <img className="fw-app-icon" src={url} alt="" onError={() => setUrl('')} /> : <ExternalLink size={14} />;
}
type AppState = ReturnType<typeof useApplications>;
function ApplicationChoices({ state, run }: { state: AppState; run: RunAction }) {
  const [remember, setRemember] = useState(false), data = state.data;
  return <>
    {!data && !state.error && <DropdownMenuItem disabled><Loader2 className="animate-spin" />正在读取可用应用…</DropdownMenuItem>}
    {state.error && <><div className="fw-menu-message" role="alert">无法读取可用应用：{state.error}</div><DropdownMenuItem onClick={state.reload} closeOnClick={false}><RotateCcw />重新读取应用列表</DropdownMenuItem></>}
    {data?.preferredUnavailable && <div className="fw-menu-message" role="status">首选应用当前不可用，请选择其它应用。</div>}
    {data && !data.apps.length && <DropdownMenuItem disabled>未找到可打开此文件的应用</DropdownMenuItem>}
    {data?.apps.map((app) => <DropdownMenuItem key={app.id} onClick={() => run(() => rpc.files.openExternal({ listId: data.id, appId: app.id, remember }))}><AppIcon app={app} /><span className="fw-menu-name">{app.name}{app.systemDefault ? '（系统默认）' : ''}</span>{data.preferredId === app.id && <Check size={14} />}</DropdownMenuItem>)}
    {data && data.apps.length > 0 && <><DropdownMenuSeparator /><Menu.CheckboxItem className="fw-menu-checkbox" checked={remember} onCheckedChange={setRemember} closeOnClick={false}><span className="fw-menu-check">{remember && <Check size={12} />}</span>记住选择的应用</Menu.CheckboxItem></>}
  </>;
}
export function FileOpenButton({ target, run }: { target: FileActionTarget; run: RunAction }) {
  const state = useApplications(target, true), data = state.data, preferred = data?.apps.find((app) => app.id === data.preferredId);
  return <div className="fw-open-button"><button type="button" aria-label={preferred ? `使用 ${preferred.name} 打开` : '打开文件'} title={state.error || (data?.preferredUnavailable ? '首选应用不可用，请选择打开方式' : !data ? '正在读取可用应用…' : preferred ? `使用 ${preferred.name} 打开` : '请选择打开方式')} disabled={!preferred} onClick={() => preferred && data && run(() => rpc.files.openExternal({ listId: data.id, appId: preferred.id, remember: false }))}>{!data && !state.error ? <Loader2 size={14} className="animate-spin" /> : <AppIcon app={preferred} />}<span>打开</span></button>
    <DropdownMenu onOpenChange={(open) => { if (open) state.reload(); }}><DropdownMenuTrigger aria-label="打开方式" title="打开方式"><ChevronDown size={12} /></DropdownMenuTrigger><DropdownMenuContent align="end" className="fw-file-menu"><ApplicationChoices state={state} run={run} /></DropdownMenuContent></DropdownMenu>
  </div>;
}

export async function saveFileCopy(target: FileActionTarget, buffer?: FileBuffer) {
  // This snapshot is a copy payload, never an acknowledgement of saving the
  // source document. Cancelling the native dialog changes no buffer state.
  const draftBase64 = buffer?.editor && buffer.dirty ? bytesToBase64(encodeFileText(buffer.raw, buffer.bom, 'checkpoint')) : undefined;
  return rpc.files.saveCopy({ target, ...(draftBase64 === undefined ? {} : { draftBase64 }) });
}
export interface FileMenuProps { target: FileActionTarget; absolutePath: string; relativePath: string; sourceRelativePath?: string; referencePath?: PathRequest; origin: 'tree' | 'breadcrumb'; buffer?: FileBuffer; run: RunAction; children: ReactElement; repository?: GitRepositoryInfo }
export function FileContextActions({ target, absolutePath, relativePath, sourceRelativePath = relativePath, referencePath, origin, buffer, run, children, repository }: FileMenuProps) {
  const terminal = useFileTerminalContext();
  const [enabled, setEnabled] = useState(false), state = useApplications(target, enabled), data = state.data;
  const directory = target.kind === 'path' && target.directory, preferred = data?.apps.find((app) => app.id === data.preferredId);
  const web = repository ? gitFileLink(repository, sourceRelativePath, directory) : null;
  return <ContextMenu onOpenChange={(open) => { if (open) { setEnabled(true); if (enabled) state.reload(); } }}><ContextMenuTrigger render={children} onMouseEnter={() => setEnabled(true)} />
    <ContextMenuContent className="fw-file-menu">
      <DropdownMenuItem disabled={!preferred} title={state.error || (!data ? '正在读取可用应用…' : '')} onClick={() => data && preferred && run(() => rpc.files.openExternal({ listId: data.id, appId: preferred.id, remember: false }))}><AppIcon app={preferred} />{preferred ? `使用 ${preferred.name} 打开` : state.error ? '读取应用失败' : data ? '首选应用不可用' : '正在读取可用应用…'}</DropdownMenuItem>
      <Menu.SubmenuRoot><Menu.SubmenuTrigger className="fw-menu-submenu"><ExternalLink size={14} /><span>打开方式</span><ChevronRight size={14} /></Menu.SubmenuTrigger><DropdownMenuContent side="right" align="start" className="fw-file-menu"><ApplicationChoices state={state} run={run} /></DropdownMenuContent></Menu.SubmenuRoot>
      <DropdownMenuSeparator />
      {!directory && <DropdownMenuItem onClick={() => run(() => saveFileCopy(target, buffer))}><Download />另存副本…</DropdownMenuItem>}
      <DropdownMenuItem onClick={() => run(() => navigator.clipboard.writeText(absolutePath))}><Copy />复制完整路径</DropdownMenuItem>
      <DropdownMenuItem onClick={() => run(() => navigator.clipboard.writeText(relativePath))}><Copy />复制相对路径</DropdownMenuItem>
      {!directory && terminal && <DropdownMenuItem onClick={() => void terminal.add(referencePath ?? (target.kind === 'path' ? target.path : { lease: target.ref.lease, generation: target.ref.generation, relativePath: sourceRelativePath }), buffer?.file.revision)}><Terminal />添加到终端引用</DropdownMenuItem>}
      {origin === 'breadcrumb' && <>
        {!directory && buffer?.editor && <DropdownMenuItem onClick={() => run(() => navigator.clipboard.writeText(buffer.raw))}><Copy />复制文件内容</DropdownMenuItem>}
        <DropdownMenuItem onClick={() => run(() => rpc.files.reveal(target))}><FolderOpen />在 Finder 中显示</DropdownMenuItem>
        {web && <DropdownMenuItem onClick={() => run(() => rpc.files.openWebLink(web))}><ExternalLink />在 GitHub 中打开</DropdownMenuItem>}
      </>}
    </ContextMenuContent>
  </ContextMenu>;
}
