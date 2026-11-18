// 已确认 M14 原型 ModelPicker 的三栏布局；数据使用真实配置，扩展偏好由任务服务保存。
import { Check, ChevronDown, Lock, PlugZap, Search, Settings } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { navigation } from '@renderer/core/navigation';
import { AgentIcon } from '@renderer/features/agents/icons';
import './agent-model-picker.css';

export interface PickerProfile { profileId: string; name: string; kind: string; source: string; models: string[]; defaultModel?: string | null; available: boolean; extensionSupport?: string }
interface Props {
  profiles: PickerProfile[]; profileId: string; model?: string; locked?: boolean; busy?: boolean; disabled?: boolean;
  extensions?: Record<string, boolean>; carryExtensions?: boolean;
  effort?: string; defaultModel?: string; nativeModels?: { id: string; name: string; efforts: string[]; defaultEffort?: string }[];
  triggerRef?: Ref<HTMLButtonElement>;
  onPick(profileId: string, model: string | null): Promise<void | boolean> | void | boolean;
  onExtensions(profileId: string, enabled: boolean): Promise<void> | void;
  onEffort?(effort: string | null): void;
}
export function AgentModelPicker(p: Props) {
  const [open, setOpen] = useState(false), [rail, setRail] = useState(p.profileId), [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 20, bottom: 40 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => { const r = root.current?.getBoundingClientRect(); if (r) setPosition({ left: Math.max(20, Math.min(r.left, window.innerWidth - Math.min(560, window.innerWidth - 40) - 20)), bottom: Math.max(12, window.innerHeight - r.top + 10) }); };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const selected = p.profiles.find(x => x.profileId === p.profileId), target = p.profiles.find(x => x.profileId === rail) ?? selected;
  const native = target?.profileId === p.profileId ? p.nativeModels ?? [] : [];
  const modelIds = [...new Set([...(target?.models ?? []), ...native.map(m => m.id)])];
  const models = [{ id: '', name: target?.defaultModel ? `默认（${target.defaultModel}）` : '执行器默认' }, ...modelIds.map(id => ({ id, name: native.find(m => m.id === id)?.name ?? id }))].filter(m => m.name.toLowerCase().includes(query.toLowerCase()));
  const modelInfo = native.find(m => m.id === (p.model ?? p.defaultModel ?? target?.defaultModel));
  const pick = async (model: string) => { if (target) { const ok = await p.onPick(target.profileId, model || null); if (ok !== false) setOpen(false); } };
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node) && !popup.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) { const m = models[Number(e.key) - 1]; if (m) { e.preventDefault(); void pick(m.id); } }
    };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); };
  }, [open, models, target]); // a current model list is required for the keyboard shortcuts
  return <div className="agent-model-picker" ref={root}>
    <button type="button" disabled={p.disabled} ref={p.triggerRef} className="agent-model-pill" aria-label="选择智能体与模型" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setRail(p.profileId); setQuery(''); setOpen(v => !v); }}>
      <AgentIcon tool={selected?.kind ?? 'codex'} size={16} /><span className="agent-model-profile" title={selected?.name ?? p.profileId}>{selected?.name ?? p.profileId}</span><small title={p.model ?? '默认'}>{p.model ?? '默认'}</small><ChevronDown size={12} />
    </button>
    {open && target && createPortal(<div ref={popup} style={position} className="agent-picker" role="dialog" aria-label="选择智能体与模型">
      <div className="agent-picker-main">
        <div className="agent-picker-rail" aria-label="智能体">
          {p.profiles.map(profile => <button type="button" key={profile.profileId} title={p.locked && profile.profileId !== p.profileId ? `${profile.name}：清除目标后才能切换` : profile.name} disabled={!profile.available || (!!p.locked && profile.profileId !== p.profileId)} aria-label={profile.name} aria-pressed={rail === profile.profileId} className={rail === profile.profileId ? 'on' : ''} onClick={() => { setRail(profile.profileId); setQuery(''); }}><AgentIcon tool={profile.kind} size={20} /></button>)}
        </div>
        <div className="agent-picker-list">
          <div className="agent-picker-head"><b>{target.name}</b><small>{target.source === 'provider' ? 'WillYou 托管供应商' : '本机订阅／原生登录'}</small></div>
          {p.locked && <div className="agent-picker-note" role="note"><Lock size={12} />清除目标后才能切换；本执行器内换模型不受限</div>}
          <label className="agent-picker-search"><Search size={14} /><input autoFocus value={query} placeholder="搜索模型…" onChange={e => setQuery(e.target.value)} /></label>
          {target.source === 'provider' ? <div className="agent-extension-toggle"><Lock size={13} /><span>托管配置已隔离<small>不加载你的个人扩展</small></span></div>
            : <label className="agent-extension-toggle"><PlugZap size={13} /><span>沿用我的扩展<small>下一个新会话起生效，已有会话保留原配置</small></span><input type="checkbox" role="switch" checked={p.extensions?.[target.profileId] ?? (target.profileId === p.profileId ? p.carryExtensions !== false : true)} onChange={e => void p.onExtensions(target.profileId, e.target.checked)} /></label>}
          {target.source !== 'provider' && target.extensionSupport === 'partial' && <div className="agent-picker-note">Codex 部分支持：关闭个人 MCP；个人 hooks、Skill、插件仍可能加载。</div>}
          {models.map((m, i) => <button type="button" aria-label={m.name} className="agent-model-row" key={m.id} disabled={!target.available} onClick={() => void pick(m.id)}><AgentIcon tool={target.kind} size={16} /><span>{m.name}</span>{i < 9 && <kbd aria-hidden>⌘{i + 1}</kbd>}{target.profileId === p.profileId && (p.model ?? '') === m.id && <Check size={14} />}</button>)}
          {!models.length && <p className="agent-picker-note">没有匹配的模型</p>}
        </div>
        <div className="agent-picker-traits"><div className="agent-traits-head">推理强度</div>{modelInfo?.efforts.length && p.onEffort ? <>
          <button type="button" onClick={() => p.onEffort?.(null)}>默认{!p.effort && <Check size={14} />}</button>
          {modelInfo.efforts.map(e => <button type="button" key={e} onClick={() => p.onEffort?.(e)}>{e}{p.effort === e && <Check size={14} />}</button>)}</> : <p>执行器尚未公布可用选项</p>}</div>
      </div>
      <div className="agent-picker-foot"><span>{p.busy ? '本轮和已有排队输入结束后切换' : '切换后新建或恢复该执行器的会话'}</span><button type="button" onClick={() => navigation.openSettings('aiProfiles')}><Settings size={13} />管理智能体</button></div>
    </div>, document.body)}
  </div>;
}
