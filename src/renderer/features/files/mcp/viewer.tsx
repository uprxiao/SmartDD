import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, SlidersHorizontal } from 'lucide-react';
import { selectFileViewer, viewerConfigurationSchema, type ViewerSession, type ViewerConfiguration, type ViewerStatus } from '@shared/file-viewer';
import { rpc } from '@renderer/lib/ipc';
import { DropdownMenuItem, DropdownMenuSeparator } from '@renderer/lib/ui/menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Button } from '@renderer/lib/ui/button';
import { bytesFromBase64, fileErrorMessage, type FileBuffer } from '../file-buffer';
import { McpAppFrame } from './apps';
const queryKey = ['files', 'viewer-configuration'];
const choices = new WeakMap<FileBuffer, string | null>();
let settingsOpen = false;
const setSettings = (open: boolean) => { settingsOpen = open; for (const listener of listeners) listener(); };
const listeners = new Set<() => void>();
const choose = (buffer: FileBuffer, id: string | null | undefined) => { if (id === undefined) choices.delete(buffer); else choices.set(buffer, id); for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function useChoice(buffer: FileBuffer | undefined) { return useSyncExternalStore(subscribe, () => buffer ? choices.get(buffer) : undefined); }
function useConfiguration() { return useQuery({ queryKey, queryFn: () => rpc.files.viewerConfiguration() }); }
export function McpViewerMenu({ buffer, source }: { buffer?: FileBuffer; source?: 'project-directory' | 'task-cwd' }) {
  const { data } = useConfiguration(), choice = useChoice(buffer);
  return <><DropdownMenuSeparator />
    {buffer && <><DropdownMenuItem disabled={buffer.dirty || buffer.saving} onClick={() => choose(buffer, undefined)}><SlidersHorizontal />自动选择查看器{choice === undefined && <Check />}</DropdownMenuItem><DropdownMenuItem disabled={buffer.dirty || buffer.saving} onClick={() => choose(buffer, null)}>内置文件查看器{choice === null && <Check />}</DropdownMenuItem>
      {data?.adapters.filter(a => a.enabled && source && a.sources.includes(source)).map(adapter => <DropdownMenuItem key={adapter.id} disabled={buffer.dirty || buffer.saving} onClick={() => choose(buffer, adapter.id)}>{adapter.name}{choice === adapter.id && <Check />}</DropdownMenuItem>)}</>}
    <DropdownMenuItem onClick={() => setSettings(true)}>管理扩展文件查看器…</DropdownMenuItem>
  </>;
}
export function McpViewerSettings() {
  const { data } = useConfiguration(), cache = useQueryClient();
  const settings = useSyncExternalStore(subscribe, () => settingsOpen);
  const [text, setText] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => { if (settings) { setText(JSON.stringify(data ?? { adapters: [], preferred: {} }, null, 2)); setError(''); } }, [settings]);
  const save = async () => { setSaving(true); try { const value = viewerConfigurationSchema.parse(JSON.parse(text)); await rpc.files.configureViewers(value); await cache.invalidateQueries({ queryKey }); setSettings(false); } catch (failure) { setError(fileErrorMessage(failure)); } finally { setSaving(false); } };
  return (
    <Dialog open={settings} onOpenChange={setSettings}><DialogContent><DialogHeader><DialogTitle>扩展文件查看器</DialogTitle></DialogHeader><DialogDescription className="px-6">登记本机适配器及匹配后缀。只有明确登记的服务才可打开当前文件；AI 配置中的 MCP 不会自动启用。stdio 运行资源 runtimePaths 是额外只读授权，请仅登记服务自身的运行文件。</DialogDescription><div className="px-6"><textarea aria-label="文件查看器适配清单" spellCheck={false} value={text} onChange={event => setText(event.target.value)} style={{ width: '100%', minHeight: 260, fontFamily: 'monospace', fontSize: 12 }} /><button type="button" onClick={() => setText(JSON.stringify({ adapters: [{ id: 'local-text', name: '本机文本资源', enabled: true, suffixes: ['.foo', '.bar.foo'], sources: ['project-directory', 'task-cwd'], provider: { kind: 'local-resource', writable: true } }], preferred: {} }, null, 2))}>填入本机资源示例</button>{error && <p role="alert">{error}</p>}</div><DialogFooter><Button variant="outline" onClick={() => setSettings(false)}>取消</Button><Button disabled={saving} onClick={() => void save()}>保存登记</Button></DialogFooter></DialogContent></Dialog>
  );
}

export function McpViewerSlot({ buffer, source, children }: { buffer: FileBuffer; source: 'project-directory' | 'task-cwd'; children: ReactNode }) {
  const { data, error: configError } = useConfiguration(), explicit = useChoice(buffer);
  const adapter = data ? selectFileViewer(data, buffer.file.name, source, explicit) : null;
  const configuration = adapter ? JSON.stringify(adapter) : '', documentVersion = adapter?.provider.kind === 'stdio' ? buffer.baseHash : '';
  const [session, setSession] = useState<ViewerSession>(), [error, setError] = useState(''), [status, setStatus] = useState<ViewerStatus>(), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const id = crypto.randomUUID(); setSession(undefined); setError(''); setStatus(undefined);
    if (!adapter) return;
    if (buffer.dirty || buffer.saving) { setError('请先保存当前修改，再切换扩展查看器'); return; }
    const poll = async () => {
      try { const value = await rpc.files.viewerStatus(id); if (alive) setStatus(value); }
      catch (failure) { if (alive) setError(fileErrorMessage(failure)); }
      if (alive) timer = setTimeout(poll, 1500);
    };
    void rpc.files.openViewer({ id, ref: buffer.file.ref, adapterId: adapter.id, baseHash: buffer.baseHash }).then(value => { if (alive) { setSession(value); void poll(); } }).catch(failure => { if (alive) setError(fileErrorMessage(failure)); });
    return () => { alive = false; clearTimeout(timer); void rpc.files.closeViewer(id).catch(() => undefined); };
  }, [buffer.instance, configuration, documentVersion, attempt]);
  if (!adapter) return <>{(configError || (explicit && data)) && <div className="fw-save-strip" role="status">{configError ? fileErrorMessage(configError) : '指定扩展查看器不可用，已显示内置查看器。'}</div>}{children}</>;
  const fallback = () => choose(buffer, null);
  if (error || status?.error) return <><div className="fw-save-strip" role="alert">{error || status?.error}<button onClick={() => setAttempt(v => v + 1)}>重试扩展</button><button onClick={fallback}>返回内置查看器</button></div>{children}</>;
  if (!session) return <div className="fw-empty" role="status"><Loader2 className="animate-spin" />正在连接 {adapter.name}…<button onClick={fallback}>返回内置查看器</button></div>;
  const readonly = () => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytesFromBase64(session.resource.base64)); } catch { return `此资源为二进制，共 ${session.resource.bytes} 字节。`; } };
  return <><div className="fw-save-strip" role="status"><span>{adapter.name}{session.writable && buffer.editor ? ' · 本机条件保存' : ' · 只读资源'}</span><button disabled={buffer.dirty || buffer.saving} onClick={fallback}>内置查看器</button>{status?.invalidated && <button disabled={buffer.dirty || buffer.saving} onClick={() => setAttempt(v => v + 1)}>资源已改变，重新读取</button>}{Boolean(status?.droppedNotifications) && <span>已合并过量资源通知：{status!.droppedNotifications}</span>}</div>
    {session.presentation === 'mcp-app' ? <McpAppFrame session={session} onRetry={() => setAttempt(v => v + 1)} /> : session.writable && buffer.editor ? children : <pre style={{ overflow: 'auto', flex: 1, whiteSpace: 'pre-wrap', padding: 16 }}>{readonly()}</pre>}
  </>;
}
