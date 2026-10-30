import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Braces, Loader2, X } from 'lucide-react';
import { languageConfigurationSchema, LSP_LIMITS, type LanguageConfiguration, type LanguageServerConfiguration } from '@shared/file-lsp';
import { rpc } from '@renderer/lib/ipc';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Button } from '@renderer/lib/ui/button';
import type { FileWorkspaceStore } from '../workspace-store';
import { LANGUAGE_LABELS, LanguageWorkspace } from './workspace';
import './style.css';
const Context = createContext<LanguageWorkspace | null>(null);
export const useFileLanguage = () => useContext(Context);
const emptySubscribe = () => () => undefined;
function useLanguageState() { const value = useFileLanguage(); useSyncExternalStore(value?.subscribe ?? emptySubscribe, value?.snapshot ?? (() => 0)); return value; }
export function FileLanguageProvider({ workspace, children }: { workspace: FileWorkspaceStore; children: ReactNode }) {
  const value = useMemo(() => new LanguageWorkspace(workspace), [workspace]);
  useEffect(() => () => value.dispose(), [value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function LanguageSettingsMenu() { const value = useLanguageState(); return value && <DropdownMenuItem onClick={() => value.setSettings(true)}><Braces />语言服务设置…</DropdownMenuItem>; }
export function LanguageEditorTools() {
  const value = useLanguageState(); if (!value) return null;
  const current = value.current, state = current?.error ? '连接失败' : current?.session?.state === 'ready' ? current.session.server : current?.session?.state === 'unavailable' ? current.session.reason : '正在连接语言服务…';
  return <><button type="button" className="fw-icon" aria-label="语义导航后退" title="语义导航后退（Alt+←）" disabled={!value.history.canBack} onClick={() => void value.travel(-1)}><ArrowLeft size={16}/></button><button type="button" className="fw-icon" aria-label="语义导航前进" title="语义导航前进（Alt+→）" disabled={!value.history.canForward} onClick={() => void value.travel(1)}><ArrowRight size={16}/></button>
    <DropdownMenu><DropdownMenuTrigger className="fw-icon" aria-label="代码语义导航" title={state}><Braces size={16}/></DropdownMenuTrigger><DropdownMenuContent className="fw-file-menu" align="start">{Object.entries(LANGUAGE_LABELS).map(([kind,label])=><DropdownMenuItem key={kind} disabled={!current?.supports(kind as keyof typeof LANGUAGE_LABELS)} onClick={() => void value.request(kind as keyof typeof LANGUAGE_LABELS)}>{kind === 'references' ? '查找' : '转到'}{label}</DropdownMenuItem>)}<DropdownMenuSeparator/><DropdownMenuItem onClick={() => value.setSettings(true)}>语言服务设置…</DropdownMenuItem><DropdownMenuItem disabled={!current} onClick={() => value.retry()}>重新连接语言服务</DropdownMenuItem><div className="fw-language-menu-status" role="status">{state}</div></DropdownMenuContent></DropdownMenu>
  </>;
}
export function LanguageResults() {
  const value = useLanguageState(), [visibleCount, setVisibleCount] = useState<number>(LSP_LIMITS.pageSize), results = value?.results;
  useEffect(() => setVisibleCount(LSP_LIMITS.pageSize), [results]);
  if (!value) return null;
  const error = value.current?.error;
  return <>{(error || value.message || value.busy) && <div className="fw-save-strip" role={error ? 'alert' : 'status'}>{value.busy && <Loader2 size={14} className="animate-spin"/>}<span>{error || value.message || '正在查询语义位置…'}</span>{error && <button onClick={() => value.retry()}>重新连接语言服务</button>}</div>}
    {results && results.locations.length > 0 && <div className="fw-symbol-panel fw-language-results" role="region" aria-label={`${LANGUAGE_LABELS[results.kind]}结果`}><div className="fw-language-heading"><strong>{LANGUAGE_LABELS[results.kind]} · {results.locations.length} 个位置</strong><button className="fw-icon" aria-label="关闭符号结果" onClick={() => value.closeResults()}><X size={15}/></button></div><div className="fw-language-list">{results.locations.slice(0, visibleCount).map((location,index)=><button key={index} disabled={location.outsideRoot} title={location.outsideRoot ? '已授权目录外；仅显示位置' : location.displayPath} onClick={() => void value.select(location)}>{location.displayPath}:{location.range.start.line+1}:{location.range.start.character+1}{location.outsideRoot?' · 根外只读位置':''}</button>)}</div>{visibleCount<results.locations.length&&<div className="fw-language-pages"><button onClick={()=>setVisibleCount(count=>count+LSP_LIMITS.pageSize)}>加载更多</button></div>}</div>}
    {value.hover && createPortal(<div className="fw-language-hover" role="tooltip" style={{left:Math.min(value.hover.x,Math.max(8,window.innerWidth-420)),top:Math.min(value.hover.y,Math.max(8,window.innerHeight-200))}}>{value.hover.text}</div>,document.body)}
    <LanguageSettings/>
  </>;
}
function LanguageSettings() {
  const value = useLanguageState(); const [configuration,setConfiguration] = useState<LanguageConfiguration>({enabled:true,servers:[]}), [found,setFound] = useState<{name:string;command:string;languages:string[];args:string[]}[]>([]), [projectId,setProjectId] = useState<string|null>(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const open = value?.settings ?? false;
  useEffect(()=>{ if(!open||!value)return; let current=true; setError(''); setBusy(true); Promise.all([rpc.files.languageConfiguration(),rpc.files.languageDiscover(),value.current?rpc.files.languageContext(value.current.buffer.file.ref):Promise.resolve(null)]).then(([config,detected,context])=>{if(current){setConfiguration(config);setFound(detected);setProjectId(context?.projectId??null)}}).catch(error=>{if(current)setError(String(error))}).finally(()=>{if(current)setBusy(false)});return()=>{current=false}},[open]);
  if(!value)return null;
  const update = (id:string, change:Partial<LanguageServerConfiguration>) => setConfiguration(previous=>({...previous,servers:previous.servers.map(server=>server.id===id?{...server,...change}:server)}));
  const add = (server?:typeof found[number]) => setConfiguration(previous=>({...previous,servers:[...previous.servers,{id:crypto.randomUUID(),name:server?.name??'本机语言服务',enabled:true,command:server?.command??'',args:server?.args??[],languages:server?.languages??['plaintext'],projectId:null}]}));
  const save=async()=>{setBusy(true);try{await rpc.files.configureLanguages(languageConfigurationSchema.parse(configuration));value.setSettings(false);value.retry()}catch(error){setError(String(error instanceof Error?error.message:error))}finally{setBusy(false)}};
  return <Dialog open={open} onOpenChange={open=>value.setSettings(open)}><DialogContent><DialogHeader><DialogTitle>本机语言服务</DialogTitle></DialogHeader><DialogDescription className="px-6">选择本机已有服务，或登记你信任的可执行文件。保存后在匹配文件中运行；服务可访问本机文件，不会自动安装。</DialogDescription><div className="fw-language-settings"><label><input type="checkbox" checked={configuration.enabled} onChange={event=>setConfiguration({...configuration,enabled:event.target.checked})}/>启用代码语义导航和悬浮类型</label><div className="fw-language-detected">{found.map(server=><button key={server.command} disabled={busy} onClick={()=>add(server)}>添加 {server.name}</button>)}<button disabled={busy} onClick={()=>add()}>手动登记服务</button></div>{configuration.servers.map(server=><fieldset key={server.id}><legend>{server.name}</legend><label><input type="checkbox" checked={server.enabled} onChange={event=>update(server.id,{enabled:event.target.checked})}/>启用此服务</label><label>名称<input aria-label="语言服务名称" value={server.name} onChange={event=>update(server.id,{name:event.target.value})}/></label><label>可执行文件<input aria-label="语言服务可执行文件" value={server.command} onChange={event=>update(server.id,{command:event.target.value})} placeholder="绝对路径"/></label><label>启动参数（每行一个）<textarea aria-label="语言服务启动参数" value={server.args.join('\n')} onChange={event=>update(server.id,{args:event.target.value?event.target.value.split('\n'):[]})}/></label><label>语言 ID（逗号分隔）<input aria-label="语言服务语言" value={server.languages.join(', ')} onChange={event=>update(server.id,{languages:event.target.value.split(',').map(item=>item.trim())})}/></label><label>适用范围<select aria-label="语言服务项目范围" value={server.projectId??'*'} onChange={event=>update(server.id,{projectId:event.target.value==='*'?null:event.target.value})}><option value="*">所有项目</option>{projectId&&<option value={projectId}>当前项目</option>}{server.projectId&&server.projectId!==projectId&&<option value={server.projectId}>已登记的其他项目</option>}</select></label><button onClick={()=>setConfiguration({...configuration,servers:configuration.servers.filter(item=>item.id!==server.id)})}>移除服务</button></fieldset>)}{!configuration.servers.length&&<p>尚未登记语言服务。源码浏览、编辑和基础高亮仍可用。</p>}{error&&<p role="alert">{error}</p>}</div><DialogFooter><Button variant="outline" onClick={()=>value.setSettings(false)}>取消</Button><Button disabled={busy} onClick={()=>void save()}>保存配置</Button></DialogFooter></DialogContent></Dialog>;
}
