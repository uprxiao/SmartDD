// 已确认 M14 原型 ModelPicker 的三栏布局；数据使用真实配置，扩展偏好由任务服务保存。
import { Check, ChevronDown, Lock, PlugZap, Search, Settings } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { navigation } from '@renderer/core/navigation';
import { AgentIcon } from '@renderer/features/agents/icons';
import { rpc } from '@renderer/lib/ipc';
import {
  CLAUDE_LOGIN_EFFORT, CLAUDE_LOGIN_FALLBACK, CLAUDE_LOGIN_UNAVAILABLE, CODEX_LOGIN_EFFORT, CODEX_LOGIN_MODEL,
  claudeSubscriptionDefault, findAgentModel, modelEffortKey, offersCodexLoginDefault, resolveModelEffort,
  type AgentModelCatalog, type AgentModelChoice, type AgentModelOption, type AgentModelScope,
} from '@shared/agent-model-choice';
import './agent-model-picker.css';

export interface PickerProfile { profileId: string; name: string; kind: string; source: string; models: string[]; defaultModel?: string | null; available: boolean; codexSubscription?: boolean; claudeSubscription?: boolean; extensionSupport?: string; provider?: { name: string; catalog: string | null }; modelOptions?: AgentModelOption[] }
export function modelCatalogQuery(scope: AgentModelScope | undefined, profileId: string) {
  return queryOptions({
    queryKey: ['agent-model-catalog', scope, profileId] as const,
    queryFn: (): Promise<AgentModelCatalog> => scope ? rpc.agentTasks.modelCatalog(scope, profileId) : Promise.resolve({status:'ready',models:[]}),
    staleTime: 0, retry: false, refetchIntervalInBackground: true,
    refetchInterval: query => {
      const state = query.state.data?.status;
      return state === 'loading' || state === 'refreshing' ? 180 : false;
    },
  });
}
const effortLabels = new Map([['low', '低'], ['medium', '中等'], ['high', '高'], ['xhigh', '更高'], ['max', '最高']]);
const effortLabel = (value: string) => effortLabels.get(value) ?? value;
const modelLabel = (value: string) => value === CODEX_LOGIN_MODEL ? 'GPT-6.2-Sol' : value;
const toolLabel = (kind: string) => kind === 'codex' ? 'Codex' : kind === 'claude' ? 'Claude Code' : kind === 'antigravity' ? 'Antigravity' : kind;
function profileLabel(profile: PickerProfile) {
  if (!profile.provider) return profile.name;
  return [profile.name, toolLabel(profile.kind), profile.provider.name].filter((part, i) => i === 0 || !profile.name.includes(part)).join(' · ');
}
function modelOption(profile: PickerProfile | undefined, native: AgentModelOption[], model: string | undefined) {
  const option = findAgentModel(native, model);
  const configured = profile?.modelOptions?.find(m => m.id === model);
  if (profile?.kind === 'claude' && profile.source === 'provider') return configured;
  return option?.efforts.length ? option : configured ?? option;
}
interface Props {
  profiles: PickerProfile[]; profileId: string; model?: string; locked?: boolean; busy?: boolean; disabled?: boolean;
  extensions?: Record<string, boolean>; carryExtensions?: boolean;
  effort?: string; defaultModel?: string; nativeModels?: AgentModelOption[]; scope?: AgentModelScope;
  profileChoices?: Record<string, AgentModelChoice>;
  modelEfforts?: Record<string, string>;
  pendingSwitch?: AgentModelChoice & { profileId: string };
  defaultPending?: boolean; defaultNotice?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  onPick(profileId: string, model: string | null, effort?: string | null): Promise<void | boolean> | void | boolean;
  onExtensions(profileId: string, enabled: boolean): Promise<void> | void;
}
export function AgentModelPicker(p: Props) {
  const [open, setOpen] = useState(false), [rail, setRail] = useState(p.profileId), [query, setQuery] = useState('');
  const [choice, setChoice] = useState<{ profileId: string; model: string; effort?: string | null }>();
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 20, bottom: 40 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = root.current?.getBoundingClientRect();
      const width = popup.current?.getBoundingClientRect().width;
      if (r && width) setPosition({ left: Math.max(20, Math.min(r.right - width, window.innerWidth - width - 20)), bottom: Math.max(12, window.innerHeight - r.top + 10) });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const selected = p.profiles.find(x => x.profileId === p.profileId), target = p.profiles.find(x => x.profileId === rail) ?? selected;
  const targetId = target?.profileId;
  const selectedNative = targetId === p.profileId ? p.nativeModels : undefined;
  const canProbe = !!p.scope && !!target?.available && (target.kind === 'codex' && target.source === 'login' ||
    target.claudeSubscription || target.kind === 'antigravity' && target.source === 'provider');
  const client = useQueryClient();
  const options = modelCatalogQuery(p.scope, targetId ?? '');
  const catalog = useQuery({ ...options, enabled: open && canProbe });
  const selectedCatalog = useQuery({
    ...modelCatalogQuery(p.scope, p.profileId),
    enabled: p.scope?.kind === 'task' && selected?.claudeSubscription === true && selected.available && !p.nativeModels?.length,
  });
  const status = canProbe ? (catalog.isError ? 'unavailable' : catalog.data?.status ?? 'loading') : undefined;
  const rows = canProbe ? catalog.data?.models : undefined;
  const native = (status === 'ready' || rows?.length ? rows : selectedNative) ?? [];
  const retry = () => {
    if (!p.scope || !targetId) return;
    void client.fetchQuery({ ...options, staleTime: 0, queryFn: () => rpc.agentTasks.modelCatalog(p.scope!, targetId, 'retry') }).catch(() => {});
  };
  const modelIds = [...new Set([...(target?.models ?? []), ...native.filter(m => target?.kind !== 'claude' || m.id !== 'default').map(m => m.id)])];
  const models = [{ id: '', name: target?.defaultModel ? `默认（${target.defaultModel}）` : '执行器默认' }, ...modelIds.map(id => ({
    id, name: findAgentModel(native, id)?.name ?? modelLabel(id),
  }))].filter(m => m.name.toLowerCase().includes(query.toLowerCase()));
  const localChoice = choice && choice.profileId === targetId ? choice : undefined;
  const currentChoice = targetId === p.profileId ? { model: p.model, effort: p.effort } : undefined;
  const pendingChoice = p.pendingSwitch?.profileId === targetId ? p.pendingSwitch : undefined;
  const rememberedChoice = targetId ? p.profileChoices?.[targetId] : undefined;
  const claudeDefault = target?.claudeSubscription && status !== 'unavailable' ? claudeSubscriptionDefault(native) : undefined;
  const claudeFallback = target?.claudeSubscription && !claudeDefault && !localChoice && !currentChoice && !pendingChoice && !rememberedChoice
    ? status === 'ready' ? CLAUDE_LOGIN_FALLBACK : status === 'unavailable' ? CLAUDE_LOGIN_UNAVAILABLE : undefined
    : undefined;
  const suggestedChoice: AgentModelChoice | undefined = target?.codexSubscription && offersCodexLoginDefault(native)
    ? { model: CODEX_LOGIN_MODEL, effort: CODEX_LOGIN_EFFORT }
    : claudeDefault ? { model: claudeDefault.id, effort: CLAUDE_LOGIN_EFFORT }
    : claudeFallback ? { model: null } : undefined;
  const applied = localChoice ?? currentChoice ?? pendingChoice ?? rememberedChoice ?? suggestedChoice;
  const appliedModel = applied?.model ?? '';
  const highlightedModel = findAgentModel(native, appliedModel)?.id ?? appliedModel;
  const defaultModel = (targetId === p.profileId ? p.defaultModel : undefined) ?? target?.defaultModel
    ?? (target?.kind === 'claude' ? undefined : native.find(m => m.isDefault)?.id);
  const effectiveModel = appliedModel || defaultModel;
  const modelInfo = modelOption(target, native, effectiveModel);
  const rememberedEffort = (model?: string) => targetId ? p.modelEfforts?.[modelEffortKey(targetId, model)] : undefined;
  const preferredEffort = localChoice?.effort === null || pendingChoice?.effort === null
    ? undefined
    : localChoice?.effort ?? pendingChoice?.effort ??
      (p.modelEfforts ? rememberedEffort(effectiveModel) ?? (applied === suggestedChoice ? suggestedChoice?.effort : undefined) : applied?.effort);
  const appliedEffort = preferredEffort && modelInfo?.efforts.includes(preferredEffort) ? preferredEffort : undefined;
  const defaultEffort = resolveModelEffort(modelInfo, undefined, target?.kind === 'codex');
  const pick = async (model: string, effort?: string | null, keep = false) => {
    if (!targetId || saving) return;
    if (p.scope?.kind === 'task' && targetId !== p.profileId) setOpen(false);
    setSaving(true);
    try {
      const ok = await p.onPick(targetId, model || null, effort);
      if (ok !== false) {
        setChoice({ profileId: targetId, model, effort });
        if (!keep) setOpen(false);
      }
    } finally { setSaving(false); }
  };
  const pickModel = (model: string) => {
    const info = modelOption(target, native, model || defaultModel);
    const suggested = !currentChoice && !pendingChoice && !rememberedChoice && model === suggestedChoice?.model ? suggestedChoice.effort : undefined;
    void pick(model, suggested, !!info?.efforts.length);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node) && !popup.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
      if (target?.available && !saving && (e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) { const m = models[Number(e.key) - 1]; if (m) { e.preventDefault(); pickModel(m.id); } }
    };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); };
  }, [open, models, target, saving]); // a current model list is required for the keyboard shortcuts
  const triggerModel = p.model || p.defaultModel || selected?.defaultModel || undefined;
  const triggerModels = selected?.claudeSubscription
    ? p.nativeModels?.length ? p.nativeModels : selectedCatalog.data?.models
    : selected?.kind === 'antigravity' ? selectedCatalog.data?.models ?? p.nativeModels : p.nativeModels;
  const triggerOption = modelOption(selected, triggerModels ?? [], triggerModel);
  const claudeLoginLabel = selected?.kind === 'claude' && selected.source === 'login' ? triggerOption?.name : undefined;
  const label = p.defaultPending ? '正在读取模型' : p.model
    ? claudeLoginLabel ?? p.nativeModels?.find(m => m.id === p.model)?.name ?? modelLabel(p.model)
    : selected?.source === 'provider' && triggerModel ? modelLabel(triggerModel) : '执行器默认';
  const triggerEffort = resolveModelEffort(triggerOption, p.modelEfforts ? p.modelEfforts[modelEffortKey(p.profileId, triggerModel)] : p.effort, selected?.kind === 'codex');
  const caption = [selected?.name ?? p.profileId, label];
  if (triggerEffort) caption.push(effortLabel(triggerEffort));
  return <div className="agent-model-picker" ref={root}>
    <button type="button" disabled={p.disabled} ref={p.triggerRef} className="agent-model-pill" title={caption.join(' · ')} aria-label="选择智能体与模型" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setRail(p.profileId); setQuery(''); setChoice(undefined); setOpen(v => !v); }}>
      <AgentIcon tool={selected?.kind ?? 'codex'} provider={selected?.provider} size={16} />
      <span className="agent-model-caption">{caption.map((part, index) => <span key={index} className={index === 1 ? 'agent-model-name' : 'agent-model-detail'}>
        {index > 0 && <span className="agent-model-separator"> · </span>}{part}
      </span>)}</span>
      <ChevronDown size={12} />
    </button>
    {open && target && createPortal(<div ref={popup} style={position} className="agent-picker" role="dialog" aria-label="选择智能体与模型">
      <div className="agent-picker-main">
        <div className="agent-picker-rail" aria-label="智能体">
          {p.profiles.map(profile => <button type="button" key={profile.profileId} title={p.locked && profile.profileId !== p.profileId ? `${profileLabel(profile)}：清除目标后才能切换` : profileLabel(profile)} disabled={!profile.available || (!!p.locked && profile.profileId !== p.profileId)} aria-label={profileLabel(profile)} aria-pressed={rail === profile.profileId} className={rail === profile.profileId ? 'on' : ''} onClick={() => { setRail(profile.profileId); setQuery(''); }}><AgentIcon tool={profile.kind} provider={profile.provider} size={20} /></button>)}
        </div>
        <div className="agent-picker-list">
          <div className="agent-picker-head"><b>{profileLabel(target)}</b><small>{target.source === 'provider' ? 'WillYou 托管供应商' : '本机订阅／原生登录'}</small></div>
          {p.locked && <div className="agent-picker-note" role="note"><Lock size={12} />清除目标后才能切换；本执行器内换模型不受限</div>}
          <label className="agent-picker-search"><Search size={14} /><input autoFocus value={query} placeholder="搜索模型…" onChange={e => setQuery(e.target.value)} /></label>
          {target.source === 'provider' ? <div className="agent-extension-toggle"><Lock size={13} /><span>托管配置已隔离<small>不加载你的个人扩展</small></span></div>
            : <label className="agent-extension-toggle"><PlugZap size={13} /><span>沿用我的扩展<small>下一个新会话起生效，已有会话保留原配置</small></span><input type="checkbox" role="switch" checked={p.extensions?.[target.profileId] ?? (target.profileId === p.profileId ? p.carryExtensions !== false : true)} onChange={e => void p.onExtensions(target.profileId, e.target.checked)} /></label>}
          {target.source !== 'provider' && target.extensionSupport === 'partial' && <div className="agent-picker-note">Codex 部分支持：关闭个人 MCP；个人 hooks、Skill、插件仍可能加载。</div>}
          {p.defaultNotice && target.profileId === p.profileId && <div className="agent-picker-note" role="status">{p.defaultNotice}</div>}
          {claudeFallback && <div className="agent-picker-note" role="status">{claudeFallback}</div>}
          {(status === 'loading' || status === 'refreshing') && <div className="agent-picker-note" role="status">{native.length ? '正在刷新模型目录…' : '正在读取模型目录…'}</div>}
          {status === 'unavailable' && <div className="agent-picker-note" role="status">{native.length ? '暂时无法刷新，显示上次读取的模型。' : '暂时无法读取模型目录。'}<button type="button" className="agent-catalog-retry" onClick={retry}>重新读取</button></div>}
          {models.map((m, i) => <button type="button" aria-label={m.name} aria-pressed={!!applied && highlightedModel === m.id} className="agent-model-row" key={m.id} disabled={!target.available || saving} onClick={() => pickModel(m.id)}><AgentIcon tool={target.kind} size={16} /><span title={m.name}>{m.name}</span>{i < 9 && <kbd aria-hidden>⌘{i + 1}</kbd>}{applied && highlightedModel === m.id && <Check size={14} />}</button>)}
          {!models.length && <p className="agent-picker-note">没有匹配的模型</p>}
        </div>
        <div className="agent-picker-traits"><div className="agent-traits-head">推理强度</div>{!!modelInfo?.efforts.length ? <>
          <button type="button" aria-pressed={!!applied && !appliedEffort} disabled={saving || !target.available} onClick={() => void pick(appliedModel, null, true)}>{target.source === 'provider' && defaultEffort ? `默认（${effortLabel(defaultEffort)}）` : '默认'}{applied && !appliedEffort && <Check size={14} />}</button>
          {modelInfo.efforts.map(e => <button type="button" key={e} aria-pressed={appliedEffort === e} disabled={saving || !target.available} onClick={() => void pick(appliedModel, e, true)}>{effortLabel(e)}{appliedEffort === e && <Check size={14} />}</button>)}</> : (!status || status === 'ready') && <p>{target.source === 'provider' ? '由供应商决定' : native.some(m => m.efforts.length) ? '选择模型后查看推理强度' : '执行器尚未公布可用选项'}</p>}</div>
      </div>
      <div className="agent-picker-foot"><span>{p.busy ? '本轮和已有排队输入结束后切换' : '切换后新建或恢复该执行器的会话'}</span><button type="button" onClick={() => navigation.openSettings('aiProfiles')}><Settings size={13} />管理智能体</button></div>
    </div>, document.body)}
  </div>;
}
